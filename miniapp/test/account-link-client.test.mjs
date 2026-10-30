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
const { createAccountLinkClient, resolveAccountApiOrigin, AccountLinkError, accountLinkMessage, classifyZaloSdkEnvironment } = module.exports;
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
  assert.equal(inactive.websiteUrl, null);
  await assert.rejects(inactive.getZaloToken(), safeFailure('not_configured'));
  await assert.rejects(inactive.login(privateToken), safeFailure('not_configured'));
  assert.equal(calls, 0);
});

test('production accepts only the exact reviewed HTTPS origins', () => {
  assert.equal(resolveAccountApiOrigin(' https://dkan.nshm.vn/ '), origin);
  assert.equal(resolveAccountApiOrigin('https://dkan.nshm.vn:443'), origin);
  assert.equal(resolveAccountApiOrigin(' https://suatanapp.vercel.app/ '), 'https://suatanapp.vercel.app');
  assert.equal(resolveAccountApiOrigin('https://suatanapp.vercel.app:443'), 'https://suatanapp.vercel.app');
  for (const value of ['http://dkan.nshm.vn', 'https://dkan.nshm.vn.evil.test', 'https://evil.test', 'https://dkan.nshm.vn/path', 'https://dkan.nshm.vn/?secret=x', 'https://dkan.nshm.vn/#x', 'https://u:p@dkan.nshm.vn', 'https://dkan.nshm.vn:444', 'http://localhost:4930', '//dkan.nshm.vn', 123,
    'http://suatanapp.vercel.app', 'https://suatanapp.vercel.app.evil.test', 'https://evil-suatanapp.vercel.app',
    'https://suatanapp-git-main-tuan303-5380s-projects.vercel.app', 'https://suatanapp-random-tuan303-5380s-projects.vercel.app',
    'https://suatanapp.vercel.app/path', 'https://suatanapp.vercel.app/?secret=x', 'https://suatanapp.vercel.app/#x',
    'https://u:p@suatanapp.vercel.app', 'https://suatanapp.vercel.app:444', '//suatanapp.vercel.app']) {
    assert.throws(() => resolveAccountApiOrigin(value), safeFailure('invalid_origin'));
  }
});

test('the account-link website follows the validated API origin without a cross-site fallback', () => {
  for (const apiOrigin of [origin, 'https://suatanapp.vercel.app']) {
    assert.equal(createAccountLinkClient({ origin: `${apiOrigin}/` }).websiteUrl, `${apiOrigin}/lien-ket-zalo`);
  }
  assert.equal(createAccountLinkClient({ origin: undefined }).websiteUrl, null);
  assert.throws(() => createAccountLinkClient({ origin: 'https://untrusted.vercel.app' }), safeFailure('invalid_origin'));
  assert.equal(createAccountLinkClient({ origin: 'http://localhost:3000', development: true }).websiteUrl,
    'http://localhost:3000/lien-ket-zalo');
});

test('the new production origin receives authentication only at its exact API endpoint', async () => {
  const productionOrigin = 'https://suatanapp.vercel.app';
  let calls = 0;
  const api = createAccountLinkClient({ origin: productionOrigin, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, `${productionOrigin}/api/zalo`);
    assert.equal(options.headers.Authorization, `Bearer ${privateToken}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { action: 'mini.login' });
    return response({ linked: false });
  } });
  assert.equal(calls, 0);
  assert.equal(api.websiteUrl, `${productionOrigin}/lien-ket-zalo`);
  assert.deepEqual(await api.login(privateToken), { linked: false });
  assert.equal(calls, 1);
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
  for (const [status, code] of [[401, 'auth_required'], [403, 'forbidden'], [409, 'challenge_unavailable'], [410, 'expired'], [429, 'rate_limited'], [503, 'service_unavailable'], [500, 'request_failed']]) {
    await assert.rejects(client(async () => response({ error: { code: 'unknown_error', message: `${privateToken} ${privateProviderError}` } }, status)).login(privateToken), safeFailure(code));
  }
  await assert.rejects(client(async () => response({ error: { code: 'link_conflict', message: privateProviderError } }, 409)).login(privateToken), safeFailure('link_conflict'));
});

test('HTTP 503 preserves explicit feature-off versus service-failure diagnostics', async () => {
  for (const code of ['not_configured', 'service_unavailable']) {
    await assert.rejects(client(async () => response({ error: { code, message: `${privateToken} ${privateProviderError}` } }, 503))
      .login(privateToken), safeFailure(code));
  }
  const featureOff = new AccountLinkError('not_configured');
  const serviceFailure = new AccountLinkError('service_unavailable');
  assert.notEqual(featureOff.message, serviceFailure.message);
  assert.doesNotMatch(serviceFailure.message, /Chưa cấu hình/);
  await assert.rejects(client(async () => response({}, 503)).login(privateToken), safeFailure('service_unavailable'));
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
  await assert.rejects(client(async () => response({}), { tokenProvider: async () => { throw new Error(privateProviderError); } }).getZaloToken(), safeFailure('zalo_auth_failed'));
  await assert.rejects(client(async () => response({}), { tokenProvider: () => new Promise(() => {}), timeoutMs: 4 }).getZaloToken(), safeFailure('timeout'));
  await assert.rejects(client((_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error(privateProviderError)), { once: true });
  }), { timeoutMs: 4 }).login(privateToken), safeFailure('timeout'));
});

test('support environment is a bounded context category, never a URL or authentication proof', async () => {
  const samples = [
    [{ hostname: 'h5.zdn.vn', pathname: '/zapps/3378419117469948059/', search: `?token=${privateToken}` }, 'miniapp'],
    [{ hostname: 'h5.zdn.vn', pathname: '/', search: `?env=TESTING_LOCAL&token=${privateToken}` }, 'miniapp'],
    [{ hostname: 'h5.zdn.vn', pathname: '/ordinary-webview', search: '' }, 'web'],
    [{ hostname: 'h5.zdn.vn.evil.test', pathname: '/zapps/anything', search: '' }, 'web'],
    [{ hostname: 'suatanapp.vercel.app', pathname: '/login', search: '' }, 'web'],
    [{ hostname: '127.0.0.1', pathname: '/', search: '' }, 'development'],
    [null, 'unknown'], [undefined, 'unknown'], [{ hostname: privateToken }, 'unknown'],
  ];
  for (const [locationLike, expected] of samples) assert.equal(classifyZaloSdkEnvironment(locationLike), expected);
  const api = client(async () => response({}), { tokenProvider: async () => privateToken });
  assert.equal(await api.getZaloToken(), privateToken);
});

test('SDK native error codes retain safe category and stage without leaking provider details', async () => {
  let requests = 0;
  for (const [sdkCode, code] of [[-1401, 'zalo_auth_failed'], [-201, 'zalo_permission_denied'],
    [-202, 'zalo_permission_denied'], [-2002, 'zalo_permission_denied'], [-1403, 'zalo_permission_required'],
    [-1404, 'zalo_sdk_unsupported'], [-1408, 'timeout'], [-203, 'rate_limited'],
    [-2003, 'zalo_auth_failed'], [-1409, 'zalo_auth_failed'], [-1410, 'zalo_auth_failed']]) {
    const api = client(async () => { requests++; return response({}); }, { sdkLoader: async () => ({ getAccessToken: async () => {
      throw { code: sdkCode, message: privateProviderError, detail: { token: privateToken }, cause: privateToken };
    } }) });
    await assert.rejects(api.getZaloToken(), error => {
      safeFailure(code)(error);
      assert.deepEqual(error.diagnostic, { stage: 'sdk-auth', environment: 'unknown', sdkCode });
      assert.match(accountLinkMessage(error), new RegExp(`sdk-auth/unknown/Zalo ${sdkCode}`));
      assert.doesNotMatch(error.message, /mở Mini App trong Zalo/);
      return true;
    });
  }
  assert.equal(requests, 0);
});

test('SDK loader failures are distinct from native auth failures and do not call native or API', async () => {
  let nativeCalls = 0, requests = 0;
  const noFetch = async () => { requests++; return response({}); };
  const failedImport = client(noFetch, { sdkLoader: async () => { throw new Error(`${privateToken} ${privateProviderError}`); } });
  await assert.rejects(failedImport.getZaloToken(), error => {
    safeFailure('zalo_sdk_load_failed')(error);
    assert.deepEqual(error.diagnostic, { stage: 'sdk-load', environment: 'unknown' }); return true;
  });
  const failedNative = client(noFetch, { sdkLoader: async () => ({ getAccessToken: async () => { nativeCalls++; throw undefined; } }) });
  await assert.rejects(failedNative.getZaloToken(), error => {
    safeFailure('zalo_auth_failed')(error);
    assert.deepEqual(error.diagnostic, { stage: 'sdk-auth', environment: 'unknown' }); return true;
  });
  assert.equal(nativeCalls, 1); assert.equal(requests, 0);
});

test('missing SDK export and invalid token results have distinct safe diagnostics', async () => {
  const malformedSdk = client(async () => response({}), { sdkLoader: async () => ({ unrelated: privateToken }) });
  await assert.rejects(malformedSdk.getZaloToken(), safeFailure('zalo_sdk_load_failed'));
  for (const value of ['', undefined, null, {}, 'not a token', 'x'.repeat(8193)]) {
    const api = client(async () => response({}), { tokenProvider: async () => value });
    await assert.rejects(api.getZaloToken(), error => {
      safeFailure('zalo_token_missing')(error);
      assert.deepEqual(error.diagnostic, { stage: 'sdk-result', environment: 'unknown' }); return true;
    });
  }
});

test('diagnostic values accept only approved enums and bounded numeric SDK codes', async () => {
  for (const sdkCode of [privateToken, `${privateToken}\n-1401`, 100000, -100000, NaN, Infinity, {}, ['-1401']]) {
    const api = client(async () => response({}), { tokenProvider: async () => { throw { code: sdkCode, message: privateProviderError }; } });
    await assert.rejects(api.getZaloToken(), error => {
      safeFailure('zalo_auth_failed')(error);
      assert.deepEqual(error.diagnostic, { stage: 'sdk-auth', environment: 'unknown' }); return true;
    });
  }
  const numericString = client(async () => response({}), { tokenProvider: async () => { throw { code: '-1401' }; } });
  await assert.rejects(numericString.getZaloToken(), error => { assert.equal(error.diagnostic.sdkCode, -1401); return true; });
  for (const diagnostic of [
    { stage: privateToken, environment: 'web', sdkCode: -1401 },
    { stage: { toString: () => 'sdk-auth', token: privateToken }, environment: 'web' },
    { stage: 'sdk-auth', environment: privateProviderError },
  ]) {
    const error = new AccountLinkError('zalo_auth_failed', diagnostic);
    assert.equal(error.diagnostic, undefined);
    assert.ok(!accountLinkMessage(error).includes(privateToken));
  }
});

test('a late SDK import cannot invoke getAccessToken after cancellation', async () => {
  let releaseImport, nativeCalls = 0;
  const scope = new AbortController();
  const api = client(async () => response({}), { sdkLoader: () => new Promise(resolve => { releaseImport = resolve; }) });
  const pending = api.getZaloToken(scope.signal);
  scope.abort();
  await assert.rejects(pending, safeFailure('cancelled'));
  releaseImport({ getAccessToken: async () => { nativeCalls++; return privateToken; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeCalls, 0);
});

test('a late SDK import cannot invoke getAccessToken after timeout', async () => {
  let releaseImport, nativeCalls = 0;
  const api = client(async () => response({}), { timeoutMs: 4, sdkLoader: () => new Promise(resolve => { releaseImport = resolve; }) });
  await assert.rejects(api.getZaloToken(), error => {
    safeFailure('timeout')(error);
    assert.deepEqual(error.diagnostic, { stage: 'sdk-load', environment: 'unknown' }); return true;
  });
  releaseImport({ getAccessToken: async () => { nativeCalls++; return privateToken; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeCalls, 0);
});
