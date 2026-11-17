// Offline checks that the update guides shipped with the VPS package agree with
// each other and with the code. Text only: no network, no secrets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async name => (await readFile(new URL(`../${name}`, import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const section = (text, heading) => {
  const start = text.indexOf(`\n## ${heading}`);
  assert.ok(start >= 0, heading);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end < 0 ? undefined : end);
};

test('the packaged webhook guide sends the LIVE-20261117.1 update through the MS_GRAPH_* step', async () => {
  const guide = await read('docs/ZALO_WEBHOOK_SETUP.md');
  for (const heading of ['0. VPS đang chạy', '1. Cập nhật `server.cjs`']) {
    const text = section(guide, heading);
    assert.match(text, /LIVE-20261117\.1[^\n]*bốn dòng `MS_GRAPH_\*`/, heading);
    assert.match(text, /Cập nhật LIVE-20261117\.1 → 3\. VPS/, heading);
    assert.doesNotMatch(text, /chỉ thay `server\.cjs`|giữ nguyên `\.env`/, heading);
  }
  assert.match(section(guide, '0. VPS đang chạy'), /thay `server\.cjs` và `Install-ApiStartup\.ps1`/);
  // The guide it points to really has that step.
  assert.match(section(await read('docs/ZALO_VIETNAM_API.md'), 'Cập nhật LIVE-20261117.1'),
    /### 3\. VPS[^\n]*\n[\s\S]*thêm bốn dòng `MS_GRAPH_\*`/);
});

test('the deploy guides check every published and Testing build before the exemption API replaces server.cjs', async () => {
  for (const name of ['docs/ZALO_VIETNAM_API.md', 'docs/MEAL_CHECKIN_EXEMPTIONS.md']) {
    assert.match(await read(name), /\*\*(?:Kiểm tra trước khi|Trước khi) thay `server\.cjs`:\*\*[^\n]*bản đang phát hành[^\n]*bản Testing[^\n]*`LIVE-20261106\.1` trở lên/, name);
  }
  const legacy = await read('miniapp/test/legacy-client-compat.test.mjs');
  assert.doesNotMatch(legacy, /Mini App is deployed before the API/);
});

test('the log limits in the update guide match the installer and the throttled reporter', async () => {
  const installer = await read('deploy/zalo-api/Install-ApiStartup.ps1');
  const diagnostics = await read('api/_lib/zalo-diagnostics.mjs');
  assert.match(installer, /^\$logRotateBytes = 20MB$/m);
  assert.match(installer, /^\$logArchivesKept = 5$/m);
  assert.match(diagnostics, /^const LINES_PER_WINDOW = 20;$/m);
  assert.match(diagnostics, /^const WINDOW_MS = 60_000;$/m);
  const guide = await read('docs/ZALO_VIETNAM_API.md');
  assert.match(guide, /tối đa 20 dòng mỗi phút[^\n]*_SUPPRESSED \{"count":n\}/);
  assert.match(guide, /`logs\\api\.log` lớn hơn 20 MB thành `api-yyyyMMdd-HHmmss\.log` và chỉ giữ 5 tệp/);
  assert.doesNotMatch(guide, /nên tăng chậm/);
});

test('the device test does not compare exemptions with the website page of this repository', async () => {
  const row = (await read('docs/ZALO_DEVICE_TEST.md')).split('\n').find(line => line.startsWith('| 19 | Miễn chấm ăn |'));
  assert.ok(row);
  assert.match(row, /website DKAN/);
  assert.match(row, /`\/cham-an` của `suatanapp\.vercel\.app` chưa áp dụng miễn chấm/);
  // The website page here still evaluates meals without the exemption list.
  const myMeals = await read('src/pages/MyMeals.tsx');
  assert.doesNotMatch(myMeals, /checkinExemption/);
});
