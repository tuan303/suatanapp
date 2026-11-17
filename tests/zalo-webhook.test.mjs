// Offline only. All HTTP requests use an ephemeral loopback server and a fake service.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
let createZaloWebhookHandler, createZaloApiApp, ZaloWithdrawalError;
test.before(async () => {
  const result = await build({ stdin: {
    contents: `export {createZaloWebhookHandler} from './api/zalo-webhook.ts'; export {createZaloApiApp} from './deploy/zalo-api/server.ts'; export {ZaloWithdrawalError} from './miniapp/server/zalo-withdrawal.mjs';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts',
  }, bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  ({ createZaloWebhookHandler, createZaloApiApp, ZaloWithdrawalError } = module.exports);
});

const privateInput = 'TEST_ONLY_PRIVATE_INPUT_MUST_NOT_APPEAR';
const signature = 'a'.repeat(64);
const body = { event: 'user.revoke.consent', appId: '3378419117469948059',
  userId: '1234567890123456789', timestamp: 1793853000000 };
const env = { DKAN_ZALO_ENABLED: 'true', ZALO_MINI_APP_API_KEY: 'TEST_ONLY_OPEN_API_KEY' };

async function invoke(options = {}) {
  let calls = 0, received;
  const handler = createZaloWebhookHandler({ env: options.env ?? env,
    getService: () => ({ async handle(...args) {
      calls++;
      received = args;
      if (options.serviceError) throw options.serviceError;
      return { received: true };
    } }),
  });
  const response = { headers: {}, statusCode: 0, payload: undefined,
    setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.payload = value; },
  };
  await handler({ method: options.method ?? 'POST', headers: {
    'content-type': 'application/json', 'x-zevent-signature': signature, ...options.headers,
  }, body: Object.hasOwn(options, 'body') ? options.body : body }, response);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined);
  assert.ok(!JSON.stringify(response.payload).includes(privateInput));
  return { ...response, calls, received };
}

test('webhook fails closed before service when disabled or API key is absent', async () => {
  for (const configuration of [{}, { ...env, DKAN_ZALO_ENABLED: 'false' },
    { ...env, ZALO_MINI_APP_API_KEY: '' }]) {
    const result = await invoke({ env: configuration });
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, 'not_configured');
    assert.equal(result.calls, 0);
  }
});

test('provider callback is POST-only, including preflight, and does not use a bearer session', async () => {
  for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE']) {
    const result = await invoke({ method });
    assert.equal(result.statusCode, 405);
    assert.equal(result.headers.Allow, 'POST');
    assert.equal(result.calls, 0);
  }
  const success = await invoke();
  assert.equal(success.statusCode, 200);
  assert.equal(success.calls, 1);
  assert.deepEqual(success.received, [body, signature]);
  assert.deepEqual(success.payload, { received: true });
});

test('missing, malformed and multi-valued signatures are rejected before service', async () => {
  for (const value of [undefined, '', 'a'.repeat(63), 'g'.repeat(64), `${signature}\n`,
    [signature], `sha256=${signature}`, privateInput]) {
    const result = await invoke({ headers: { 'x-zevent-signature': value } });
    assert.equal(result.statusCode, 401);
    assert.equal(result.payload.error.code, 'invalid_signature');
    assert.equal(result.calls, 0);
  }
});

test('non-JSON callback content is rejected without echoing values', async () => {
  for (const value of [undefined, '', 'text/plain', 'application/jsonp', ['application/json']]) {
    const result = await invoke({ headers: { 'content-type': value } });
    assert.equal(result.statusCode, 415);
    assert.equal(result.calls, 0);
  }
  assert.equal((await invoke({ headers: { 'content-type': 'application/json; charset=utf-8' } })).statusCode, 200);
});

test('invalid and oversized callback bodies never reach the service', async () => {
  for (const value of [undefined, null, [], true, 'null', `["${privateInput}"]`,
    `{"${privateInput}":`, new Date(), Object.create({ event: privateInput })]) {
    const result = await invoke({ body: value });
    assert.equal(result.statusCode, 400);
    assert.equal(result.calls, 0);
  }
  const oversized = await invoke({ body: { ...body, private: privateInput + 'x'.repeat(8192) } });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.calls, 0);
  const encoded = await invoke({ body: JSON.stringify(body) });
  assert.deepEqual(encoded.received, [body, signature]);
});

test('unexpected service failures return retryable fixed errors without provider or key data', async () => {
  const result = await invoke({ serviceError: new Error(privateInput) });
  assert.equal(result.statusCode, 503);
  assert.equal(result.payload.error.code, 'service_unavailable');
  assert.equal(result.calls, 1);
});

test('verified service rejection preserves its fixed status and code', async () => {
  for (const [status, code] of [[401, 'invalid_signature'], [400, 'invalid_request'], [503, 'not_configured']]) {
    const result = await invoke({ serviceError: new ZaloWithdrawalError(status, code) });
    assert.equal(result.statusCode, status);
    assert.equal(result.payload.error.code, code);
    assert.equal(result.calls, 1);
  }
});

test('standalone exposes only exact webhook route and enforces JSON parser limits', async () => {
  let rpcCalls = 0, webhookCalls = 0;
  const app = createZaloApiApp({
    handler: (_request, response) => { rpcCalls++; response.json({ rpc: true }); },
    webhookHandler: (request, response) => { webhookCalls++; response.json({ received: request.body }); },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const headers = { 'Content-Type': 'application/json' };
    const success = await fetch(`${base}/api/zalo-webhook`, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { received: body });
    assert.equal(success.headers.get('x-powered-by'), null);
    assert.equal(webhookCalls, 1);
    assert.equal(rpcCalls, 0);
    for (const route of ['/api/zalo-webhook/', '/API/zalo-webhook', '/api/zalo-webhook/extra']) {
      assert.equal((await fetch(`${base}${route}`, { method: 'POST', headers, body: '{}' })).status, 404);
    }
    for (const [status, requestHeaders, value] of [
      [400, headers, `{"${privateInput}":`],
      [413, headers, JSON.stringify({ value: privateInput + 'x'.repeat(8192) })],
      [415, { ...headers, 'Content-Encoding': 'gzip' }, privateInput],
    ]) {
      const response = await fetch(`${base}/api/zalo-webhook`, { method: 'POST', headers: requestHeaders, body: value });
      assert.equal(response.status, status);
      const payload = await response.text();
      assert.equal(JSON.parse(payload).error.code, 'invalid_request');
      assert.ok(!payload.includes(privateInput));
    }
    assert.equal(webhookCalls, 1);
    assert.equal(rpcCalls, 0);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
