// Offline only. Requests stay on an ephemeral loopback server with a fake service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let createZaloApiApp, readZaloApiListenConfig, createZaloHandler;
test.before(async () => {
  const result = await build({ stdin: {
    contents: `export {createZaloApiApp,readZaloApiListenConfig} from './deploy/zalo-api/server.ts'; export {createZaloHandler} from './api/zalo.ts';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  ({ createZaloApiApp, readZaloApiListenConfig, createZaloHandler } = module.exports);
});

async function withServer(handler, fn) {
  const server = createZaloApiApp({ handler }).listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try { await fn(`http://127.0.0.1:${server.address().port}`); }
  finally { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}

const secret = 'TEST_ONLY_PRIVATE_INPUT_MUST_NOT_APPEAR';

test('listen configuration is loopback by default and rejects malformed or out-of-range settings', () => {
  assert.deepEqual(readZaloApiListenConfig({}), { host: '127.0.0.1', port: 3031 });
  assert.deepEqual(readZaloApiListenConfig({ HOST: '::1', PORT: '4444' }), { host: '::1', port: 4444 });
  for (const port of ['', '0', '03031', '-1', '65536', 'NaN', '3031\n', '1.5'])
    assert.throws(() => readZaloApiListenConfig({ PORT: port }), /Invalid API listen configuration/);
  for (const host of ['', secret, 'localhost', '127.0.0.1\n', 'https://example.com'])
    assert.throws(() => readZaloApiListenConfig({ HOST: host }), /Invalid API listen configuration/);
});

test('only exact API and liveness paths exist; unrelated application endpoints stay inaccessible', async () => {
  let calls = 0;
  await withServer((_req, res) => { calls++; res.json({ handled: true }); }, async base => {
    for (const route of ['/', '/api/send-email', '/api/gas', '/api/meal-alerts', '/api/zalo/', '/API/zalo', '/api/zalo/extra']) {
      const response = await fetch(`${base}${route}`, { method: 'POST' });
      assert.equal(response.status, 404);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-powered-by'), null);
      assert.deepEqual(await response.json(), { error: { code: 'not_found', message: 'Không tìm thấy địa chỉ API.' } });
    }
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });
    assert.equal(calls, 0);
  });
});

test('malformed, oversized and compressed JSON are rejected before the handler without echoing input', async () => {
  let calls = 0;
  await withServer((_req, res) => { calls++; res.json({ handled: true }); }, async base => {
    const cases = [
      [400, { 'Content-Type': 'application/json' }, `{"${secret}":`],
      [413, { 'Content-Type': 'application/json' }, JSON.stringify({ value: `${secret}${'x'.repeat(8192)}` })],
      [415, { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, secret],
    ];
    for (const [status, headers, body] of cases) {
      const response = await fetch(`${base}/api/zalo`, { method: 'POST', headers, body });
      assert.equal(response.status, status);
      const text = await response.text();
      assert.ok(!text.includes(secret));
      assert.equal(JSON.parse(text).error.code, 'invalid_request');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal(calls, 0);
  });
});

test('the existing API retains method, CORS and bearer checks when hosted as a standalone process', async () => {
  let calls = 0;
  const handler = createZaloHandler({ env: { NODE_ENV: 'production', DKAN_ZALO_ENABLED: 'true' },
    getService: () => ({ async run(action, fields, bearer) {
      calls++;
      assert.equal(action, 'mini.login');
      assert.deepEqual(fields, {});
      assert.equal(bearer, 'TEST_ONLY_ACCESS_TOKEN');
      return { linked: false };
    } }),
  });
  await withServer(handler, async base => {
    const endpoint = `${base}/api/zalo`;
    assert.equal((await fetch(endpoint)).status, 405);
    const options = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://h5.zdn.vn' } });
    assert.equal(options.status, 204);
    assert.equal(options.headers.get('access-control-allow-origin'), 'https://h5.zdn.vn');
    const body = JSON.stringify({ action: 'mini.login' });
    const headers = { 'Content-Type': 'application/json', Origin: 'https://h5.zdn.vn' };
    assert.equal((await fetch(endpoint, { method: 'POST', headers, body })).status, 401);
    const denied = await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example',
      Authorization: 'Bearer TEST_ONLY_ACCESS_TOKEN' }, body });
    assert.equal(denied.status, 403);
    assert.equal(calls, 0);
    const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, Authorization: 'Bearer TEST_ONLY_ACCESS_TOKEN' }, body });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { linked: false });
    assert.equal(calls, 1);
  });
});

test('unexpected handler failures produce a fixed JSON error rather than Express HTML or private text', async () => {
  await withServer(async () => { throw new Error(secret); }, async base => {
    const response = await fetch(`${base}/api/zalo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('Error:'));
    assert.equal(JSON.parse(text).error.code, 'service_unavailable');
  });
});
