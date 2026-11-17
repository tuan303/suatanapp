// Offline only: fake clock, captured lines, synthetic errors and a temporary log folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createDiagnosticThrottle } from '../api/_lib/zalo-diagnostics.mjs';
import { reportZaloVerificationFailure, createZaloEmailLinkOptions } from '../api/_lib/zalo-runtime.mjs';
import { reportZaloMailFailure, ZaloMailError } from '../api/_lib/zalo-mail.mjs';
import { ZaloIdentityError } from '../miniapp/server/verify-zalo-identity.mjs';

const installer = new URL('../deploy/zalo-api/Install-ApiStartup.ps1', import.meta.url);

test('each diagnostic code writes at most 20 lines a minute and then one count of what it dropped', () => {
  const lines = [];
  let now = 1_000_000;
  const report = createDiagnosticThrottle(line => lines.push(line), { now: () => now });
  const verify = 'DKAN_ZALO_VERIFY_FAILED {"stage":"token-input"}', mail = 'DKAN_ZALO_MAIL_FAILED {"code":"send_failed","httpStatus":403}';
  for (let index = 0; index < 25; index++) report(verify);
  // A flood of one code never hides another.
  report(mail);
  assert.deepEqual(lines, [...Array(20).fill(verify), mail]);
  now += 59_999;
  report(verify);
  assert.equal(lines.length, 21);
  now += 1;
  report(verify);
  assert.deepEqual(lines.slice(21), ['DKAN_ZALO_VERIFY_FAILED_SUPPRESSED {"count":6}', verify]);
  // A window without drops adds no count line; a clock moved back starts a new window.
  now += 60_000; report(mail);
  now -= 120_000; for (let index = 0; index < 20; index++) report(verify);
  assert.deepEqual(lines.slice(23), [mail, ...Array(20).fill(verify)]);
});

test('the default verification, mail and mail-settings reporters are throttled', () => {
  const lines = [], original = console.warn;
  console.warn = line => lines.push(line);
  try {
    const secret = 'TEST_ONLY_PRIVATE_TOKEN_MUST_NOT_APPEAR';
    for (let index = 0; index < 30; index++) {
      reportZaloVerificationFailure(new ZaloIdentityError('invalid_token', { stage: 'provider', providerCode: -124, message: secret }));
      reportZaloMailFailure(new ZaloMailError('send_failed', 403));
      createZaloEmailLinkOptions({ env: {}, appSecret: 'TEST_ONLY_APP_SECRET_0123456789abcdef' });
    }
    for (const code of ['DKAN_ZALO_VERIFY_FAILED ', 'DKAN_ZALO_MAIL_FAILED ', 'DKAN_ZALO_MAIL_UNAVAILABLE ']) {
      assert.equal(lines.filter(line => line.startsWith(code)).length, 20, code);
    }
    assert.equal(lines.length, 60);
    assert.ok(!lines.join('\n').includes(secret));
  } finally { console.warn = original; }
});

test('the installer rotates a large log while the API is stopped, before registering the task', async () => {
  const source = (await readFile(installer, 'utf8')).replace(/\r\n/g, '\n');
  assert.match(source, /^\$logRotateBytes = 20MB$/m);
  assert.match(source, /^\$logArchivesKept = 5$/m);
  const call = source.indexOf('\nLimit-ApiLog -Directory $logDirectory -Path $logFile -MaxBytes $logRotateBytes -Keep $logArchivesKept\n');
  assert.ok(call > 0);
  for (const before of ['\nStop-ManagedApi -Task $existing\n\nNew-Item -ItemType Directory -Path $logDirectory', "Rename-Item -LiteralPath $logFile -NewName $oldLog"]) {
    assert.ok(source.indexOf(before) > 0 && source.indexOf(before) < call, before);
  }
  for (const after of ['\nGrant-LocalServiceAccess -Path $logDirectory', '\nRegister-ScheduledTask ', '\nStart-ScheduledTask ']) {
    assert.ok(source.indexOf(after) > call, after);
  }
});

test('Limit-ApiLog renames an oversized api.log and keeps the five newest archives', { skip: process.platform !== 'win32' && 'needs Windows PowerShell' }, async () => {
  const source = (await readFile(installer, 'utf8')).replace(/\r\n/g, '\n');
  const fn = /^function Limit-ApiLog \{[\s\S]*?^\}$/m.exec(source)?.[0];
  assert.ok(fn, 'Limit-ApiLog must be a top-level function');
  const folder = await mkdtemp(path.join(tmpdir(), 'dkan-api-log-'));
  try {
    const archives = Array.from({ length: 6 }, (_, index) => `api-2026110${index + 1}-080000.log`);
    for (const name of [...archives, 'api.utf16-20261101-080000.log', 'other.log']) await writeFile(path.join(folder, name), 'x');
    await writeFile(path.join(folder, 'api.log'), 'y'.repeat(2048));
    const script = path.join(folder, 'run.ps1');
    const run = () => promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { windowsHide: true, timeout: 60_000 });
    await writeFile(script, `$ErrorActionPreference = 'Stop'\r\n${fn.replace(/\n/g, '\r\n')}\r\n`
      + `Limit-ApiLog -Directory '${folder}' -Path '${path.join(folder, 'api.log')}' -MaxBytes 1024 -Keep 5\r\n`);
    await run();
    const names = (await readdir(folder)).filter(name => name !== 'run.ps1').sort();
    const rotated = names.filter(name => /^api-\d{8}-\d{6}\.log$/.test(name) && !archives.includes(name));
    assert.equal(rotated.length, 1, names.join(', '));
    assert.equal(await readFile(path.join(folder, rotated[0]), 'utf8'), 'y'.repeat(2048));
    // The new archive and the four newest old ones stay; the UTF-16 copy and other files are not touched.
    assert.deepEqual(names, [...archives.slice(2), rotated[0], 'api.utf16-20261101-080000.log', 'other.log'].sort());
    // A small log stays in place.
    await writeFile(path.join(folder, 'api.log'), 'z');
    await run();
    assert.equal(await readFile(path.join(folder, 'api.log'), 'utf8'), 'z');
    assert.equal((await readdir(folder)).filter(name => /^api-\d{8}-\d{6}\.log$/.test(name)).length, 5);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
