// Offline only: fake fetch responses; no Firebase, Zalo, credentials or email.
import test from 'node:test';
import assert from 'node:assert/strict';
import { getZaloUpstreamService } from '../api/_lib/zalo-upstream.mjs';
import { AccountLinkError } from '../miniapp/server/account-links.mjs';

const URL = 'https://api-suatan.nshm.vn/api/zalo';
const PRIVATE = 'TEST_ONLY_PRIVATE_TOKEN_AND_PROVIDER_MESSAGE';
const env = { DKAN_ZALO_API_UPSTREAM_URL: URL };
const json = (value, status = 200) => Response.json(value, { status });
const service = (fetchImpl, options = {}) => getZaloUpstreamService(env, { fetchImpl, ...options });
const publicError = (status = 503, code = 'service_unavailable') => error => {
  assert.ok(error instanceof AccountLinkError);
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  assert.ok(!`${error.message}\n${error.stack}\n${JSON.stringify(error)}`.includes(PRIVATE));
  assert.equal(error.cause, undefined);
  return true;
};

test('upstream is opt-in and only the exact school-owned HTTPS endpoint is accepted', () => {
  assert.equal(getZaloUpstreamService({}), null);
  assert.equal(getZaloUpstreamService({ DKAN_ZALO_API_UPSTREAM_URL: '' }), null);
  for (const value of [null, 1, {}, ' ', `${URL}/`, `${URL}?token=${PRIVATE}`, `${URL}#fragment`,
    'http://api-suatan.nshm.vn/api/zalo', 'https://api-suatan.nshm.vn.evil.example/api/zalo',
    'https://user:password@api-suatan.nshm.vn/api/zalo', 'https://127.0.0.1/api/zalo',
    'https://suatanapp.vercel.app/api/zalo', 'https://api-suatan.nshm.vn/other']) {
    assert.throws(() => getZaloUpstreamService({ DKAN_ZALO_API_UPSTREAM_URL: value }), publicError());
  }
  for (const options of [{ fetchImpl: null }, { timeoutMs: 0 }, { timeoutMs: 15_001 }, { timeoutMs: '15' }, { timeoutMs: NaN }])
    assert.throws(() => getZaloUpstreamService(env, options), publicError());
});

test('forwards only the validated RPC and bearer to the fixed HTTPS endpoint without redirects or cookies', async () => {
  let calls = 0;
  const upstream = service(async (url, options) => {
    calls++;
    assert.equal(url, URL);
    assert.ok(!url.includes(PRIVATE));
    assert.equal(options.method, 'POST');
    assert.deepEqual(options.headers, { accept: 'application/json', 'content-type': 'application/json',
      authorization: `Bearer ${PRIVATE}`, origin: 'https://suatanapp.vercel.app' });
    assert.equal(options.body, JSON.stringify({ action: 'mini.claim', code: 'TEST_ONLY_CODE' }));
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    return json({ claimToken: 'TEST_ONLY_CLAIM', expiresAt: 12345 });
  });
  assert.deepEqual(await upstream.run('mini.claim', { code: 'TEST_ONLY_CODE' }, PRIVATE),
    { claimToken: 'TEST_ONLY_CLAIM', expiresAt: 12345 });
  assert.equal(calls, 1);
});

test('rejects adapter misuse without a network request or local-verification fallback', async () => {
  let calls = 0;
  const upstream = service(async () => { calls++; return json({ linked: false }); });
  for (const [action, body, bearer] of [['admin.list', {}, PRIVATE], ['mini.login', { uid: 'forged' }, PRIVATE],
    ['mini.login', null, PRIVATE], ['mini.login', [], PRIVATE], ['mini.login', {}, `${PRIVATE}\n`],
    ['mini.login', {}, ''], ['mini.claim', { code: 'x'.repeat(8193) }, PRIVATE]])
    await assert.rejects(upstream.run(action, body, bearer), publicError());
  assert.equal(calls, 0);
});

test('successful RPC objects preserve approval, session and personal-profile fields', async () => {
  for (const value of [{ linked: false }, { linked: true, sessionToken: 'TEST_ONLY_SESSION', expiresAt: 1234,
    profile: { fullName: 'Nhân viên mẫu', employeeId: '100001', department: 'CNTT', email: 'test@example.com' } },
    { state: 'pending', expiresAt: 1234 }, { loggedOut: true }, { linked: false, revoked: true }])
    assert.deepEqual(await service(async () => json(value)).run('mini.login', {}, PRIVATE), value);
});

test('only known upstream error codes with their expected HTTP status become fixed public errors', async () => {
  for (const [status, code, expected] of [[401, 'unauthenticated', 'unauthenticated'], [401, 'auth_required', 'unauthenticated'],
    [409, 'link_conflict', 'link_conflict'], [403, 'recent_auth_required', 'recent_auth_required'],
    [429, 'rate_limited', 'rate_limited'], [503, 'not_configured', 'service_unavailable']]) {
    await assert.rejects(service(async () => json({ error: { code, message: PRIVATE, details: PRIVATE } }, status))
      .run('mini.login', {}, PRIVATE), publicError(status, expected));
  }
  for (const [status, body] of [[500, { error: { code: PRIVATE, message: PRIVATE } }],
    [403, { error: { code: 'unauthenticated', message: PRIVATE } }], [401, { error: PRIVATE }],
    [200, { error: { code: 'unauthenticated', message: PRIVATE } }]])
    await assert.rejects(service(async () => json(body, status)).run('mini.login', {}, PRIVATE), publicError());
});

test('network, parser, redirect and transport-forged public errors never expose provider details', async () => {
  const forged = new AccountLinkError(401, 'unauthenticated');
  forged.message = PRIVATE;
  for (const fetchImpl of [async () => { throw new Error(PRIVATE); }, async () => { throw forged; },
    async () => new Response(PRIVATE, { status: 502, headers: { 'content-type': 'text/html' } }),
    async () => new Response(PRIVATE, { status: 200, headers: { 'content-type': 'application/json' } }),
    async () => new Response(null, { status: 302, headers: { location: `https://evil.example/${PRIVATE}` } }),
    async () => json({ linked: false }, 201), async () => undefined])
    await assert.rejects(service(fetchImpl).run('mini.login', {}, PRIVATE), publicError());
});

test('response bodies must be plain JSON objects and bounded by actual streamed bytes', async () => {
  for (const value of [null, [], 'text', 1, true, { text: 'x'.repeat(16_384) }])
    await assert.rejects(service(async () => json(value)).run('mini.login', {}, PRIVATE), publicError());
  await assert.rejects(service(async () => new Response('{"linked":false}', {
    headers: { 'content-type': 'application/json', 'content-length': '16385' },
  })).run('mini.login', {}, PRIVATE), publicError());
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(`{"text":"${'x'.repeat(16_384)}`));
    controller.close();
  } });
  await assert.rejects(service(async () => new Response(stream, {
    headers: { 'content-type': 'application/json', 'content-length': '1' },
  })).run('mini.login', {}, PRIVATE), publicError());
});

test('deadline aborts transport and also bounds response parsing when a stream ignores the signal', async () => {
  let signal;
  await assert.rejects(service(async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  }, { timeoutMs: 5 }).run('mini.login', {}, PRIVATE), publicError());
  assert.equal(signal.aborted, true);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
  await assert.rejects(service(async (_url, options) => {
    signal = options.signal;
    return new Response(stream, { headers: { 'content-type': 'application/json' } });
  }, { timeoutMs: 5 }).run('mini.login', {}, PRIVATE), publicError());
  assert.equal(signal.aborted, true);
});
