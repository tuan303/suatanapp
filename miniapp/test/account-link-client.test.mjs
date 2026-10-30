// Entirely offline: explicit fake fetch + fake SDK provider, no real tokens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../src/lib/accountLink.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent',
});
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
const { createAccountLinkClient, resolveAccountApiOrigin, AccountLinkError, accountLinkMessage } = module.exports;
const privateToken = 'TEST_ONLY_private_token_12345';
const privateProviderError = 'TEST_ONLY_provider_error_must_not_appear';
const origin = 'https://dkan.nshm.vn';
const now = 1_800_000_000_000;
const expiry = now + 300_000;
const profile = { fullName: 'Nhân viên kiểm thử', employeeId: 'TEST-001', department: 'Bộ phận mẫu', email: 'mau@hoangmaistarschool.edu.vn' };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const client = (fetchImpl, extra = {}) => createAccountLinkClient({ origin, fetchImpl, now: () => now, ...extra });
const safeFailure = expected => error => {
  assert.ok(error instanceof AccountLinkError);
  assert.equal(error.code, expected);
  const visible = `${error.message} ${error.stack} ${JSON.stringify(error)} ${accountLinkMessage(error)}`;
  assert.ok(!visible.includes(privateToken));
  assert.ok(!visible.includes(privateProviderError));
  assert.equal(error.cause, undefined);
  return true;
};

test('blank origin is unconfigured and never calls fetch or SDK', async () => {
  let calls = 0;
  const inactive = createAccountLinkClient({ origin: '', fetchImpl: async () => { calls++; }, tokenProvider: async () => { calls++; return privateToken; } });
  assert.equal(inactive.configured, false);
  await assert.rejects(inactive.getZaloToken(), safeFailure('not_configured'));
  await assert.rejects(inactive.login(privateToken), safeFailure('not_configured'));
  assert.equal(calls, 0);
});

test('production accepts only the exact HTTPS school origin', () => {
  assert.equal(resolveAccountApiOrigin(' https://dkan.nshm.vn/ '), origin);
  assert.equal(resolveAccountApiOrigin('https://dkan.nshm.vn:443'), origin);
  for (const value of ['http://dkan.nshm.vn', 'https://dkan.nshm.vn.evil.test', 'https://evil.test', 'https://dkan.nshm.vn/path', 'https://dkan.nshm.vn/?secret=x', 'https://dkan.nshm.vn/#x', 'https://u:p@dkan.nshm.vn', 'https://dkan.nshm.vn:444', 'http://localhost:4930', '//dkan.nshm.vn', 123]) {
    assert.throws(() => resolveAccountApiOrigin(value), safeFailure('invalid_origin'));
  }
});

test('localhost origins are available only with the explicit development flag', () => {
  for (const value of ['http://localhost:4930', 'http://127.0.0.1:4930', 'https://[::1]:4930']) {
    assert.equal(resolveAccountApiOrigin(value, true), value);
    assert.throws(() => resolveAccountApiOrigin(value, false), safeFailure('invalid_origin'));
  }
  assert.throws(() => resolveAccountApiOrigin('http://other.local:4930', true), safeFailure('invalid_origin'));
});

test('client creation is inert; SDK access happens only on explicit getZaloToken', async () => {
  let sdkCalls = 0, networkCalls = 0;
  const api = client(async () => { networkCalls++; return response({ linked: false }); }, { tokenProvider: async () => { sdkCalls++; return privateToken; } });
  assert.equal(sdkCalls, 0);
  assert.equal(networkCalls, 0);
  assert.equal(await api.getZaloToken(), privateToken);
  assert.equal(sdkCalls, 1);
  assert.equal(networkCalls, 0);
  await api.login(privateToken);
  assert.equal(sdkCalls, 1);
});

test('login uses the fixed endpoint, token header, JSON action and no cookies or redirect', async () => {
  const api = client(async (url, options) => {
    assert.equal(url, `${origin}/api/zalo`);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.mode, 'cors');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.headers.Authorization, `Bearer ${privateToken}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Accept, 'application/json');
    assert.deepEqual(JSON.parse(options.body), { action: 'mini.login' });
    assert.ok(!options.body.includes(privateToken));
    assert.ok(options.signal instanceof AbortSignal);
    return response({ linked: false, sessionToken: 'must-not-grant', profile });
  });
  assert.deepEqual(await api.login(privateToken), { linked: false });
});

test('only a validated linked login response grants a personal session', async () => {
  const result = await client(async () => response({ linked: true, sessionToken: privateToken, expiresAt: expiry, profile, admin: true })).login(privateToken);
  assert.deepEqual(result, { linked: true, sessionToken: privateToken, expiresAt: expiry, profile });
  for (const data of [null, [], {}, { linked: 'true' }, { linked: true, sessionToken: '', expiresAt: expiry, profile },
    { linked: true, sessionToken: privateToken, expiresAt: now, profile },
    { linked: true, sessionToken: privateToken, expiresAt: now + 86400001, profile },
    { linked: true, sessionToken: privateToken, expiresAt: expiry, profile: { ...profile, fullName: '' } },
    { linked: true, sessionToken: privateToken, expiresAt: expiry, profile: { ...profile, employeeId: {} } }]) {
    await assert.rejects(client(async () => response(data)).login(privateToken), safeFailure('invalid_response'));
  }
});

test('claim sends only the entered code, without fake account identifiers or profile fields', async () => {
  const api = client(async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { action: 'mini.claim', code: 'AbCD-1234' });
    return response({ claimToken: privateToken, expiresAt: expiry, sessionToken: 'not-yet-a-session' });
  });
  assert.deepEqual(await api.claim(privateToken, '  AbCD-1234  '), { claimToken: privateToken, expiresAt: expiry });
});

test('invalid claim codes fail before any request', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return response({}); });
  for (const code of ['', '123', 'A'.repeat(81), 'mã-liên-kết', 'ABC DEF', '<script>']) {
    await assert.rejects(api.claim(privateToken, code), safeFailure('invalid_code'));
  }
  assert.equal(calls, 0);
});

test('claim status never exposes session tokens and accepts only the specified state field', async () => {
  for (const state of ['pending', 'approved', 'expired']) {
    const data = { state, expiresAt: expiry };
    const result = await client(async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { action: 'mini.claimStatus' });
      return response({ ...data, sessionToken: 'must-not-be-used' });
    }).claimStatus(privateToken);
    assert.deepEqual(result, data);
  }
  for (const data of [{ status: 'approved', expiresAt: expiry }, { state: 'unknown', expiresAt: expiry }, { state: 'pending', expiresAt: 'tomorrow' }]) {
    await assert.rejects(client(async () => response(data)).claimStatus(privateToken), safeFailure('invalid_response'));
  }
});

test('personal me and logout preserve their action scope', async () => {
  const actions = [];
  const api = client(async (_url, options) => {
    const action = JSON.parse(options.body).action;
    actions.push(action);
    return response(action === 'mini.me' ? { profile } : { ok: true });
  });
  assert.deepEqual(await api.me(privateToken), profile);
  await api.logout(privateToken);
  assert.deepEqual(actions, ['mini.me', 'mini.logout']);
});

test('API errors use only known safe codes and ignore raw provider messages', async () => {
  for (const [status, code] of [[401, 'auth_required'], [403, 'forbidden'], [409, 'challenge_unavailable'], [410, 'expired'], [429, 'rate_limited'], [503, 'not_configured'], [500, 'request_failed']]) {
    await assert.rejects(client(async () => response({ error: { code: 'unknown_error', message: `${privateToken} ${privateProviderError}` } }, status)).login(privateToken), safeFailure(code));
  }
  await assert.rejects(client(async () => response({ error: { code: 'link_conflict', message: privateProviderError } }, 409)).login(privateToken), safeFailure('link_conflict'));
});

test('malformed JSON and raw fetch errors never expose underlying error text', async () => {
  await assert.rejects(client(async () => { throw new Error(`${privateToken} ${privateProviderError}`); }).login(privateToken), safeFailure('network'));
  await assert.rejects(client(async () => ({ ok: true, status: 200, json: async () => { throw new Error(privateProviderError); } })).login(privateToken), safeFailure('invalid_response'));
});

test('invalid bearer tokens are rejected before fetch', async () => {
  let calls = 0;
  for (const token of ['', 'one two', 'abc\r\nsecret', 'tiếng-việt', 'x'.repeat(8193)]) {
    await assert.rejects(client(async () => { calls++; return response({}); }).login(token), safeFailure('auth_required'));
  }
  assert.equal(calls, 0);
});

test('already-aborted operations cannot fetch or call the SDK', async () => {
  let calls = 0;
  const abort = new AbortController(); abort.abort();
  const api = client(async () => { calls++; return response({}); }, { tokenProvider: async () => { calls++; return privateToken; } });
  await assert.rejects(api.login(privateToken, abort.signal), safeFailure('cancelled'));
  await assert.rejects(api.getZaloToken(abort.signal), safeFailure('cancelled'));
  assert.equal(calls, 0);
});

test('an in-flight request is aborted when the component scope closes', async () => {
  const scope = new AbortController();
  const api = client((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(privateProviderError)), { once: true });
  }));
  const pending = api.login(privateToken, scope.signal);
  scope.abort();
  await assert.rejects(pending, safeFailure('cancelled'));
});

test('late SDK completion after cancellation cannot return a usable token', async () => {
  let complete;
  const scope = new AbortController();
  const api = client(async () => response({}), { tokenProvider: () => new Promise(resolve => { complete = resolve; }) });
  const pending = api.getZaloToken(scope.signal);
  scope.abort();
  complete(privateToken);
  await assert.rejects(pending, safeFailure('cancelled'));
});

test('SDK errors and timeouts have safe messages and never reveal token details', async () => {
  await assert.rejects(client(async () => response({}), { tokenProvider: async () => { throw new Error(privateProviderError); } }).getZaloToken(), safeFailure('zalo_required'));
  await assert.rejects(client(async () => response({}), { tokenProvider: () => new Promise(() => {}), timeoutMs: 4 }).getZaloToken(), safeFailure('timeout'));
  await assert.rejects(client((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(privateProviderError)), { once: true });
  }), { timeoutMs: 4 }).login(privateToken), safeFailure('timeout'));
});
