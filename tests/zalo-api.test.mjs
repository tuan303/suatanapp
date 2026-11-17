// Offline only: no live Firebase credentials, Zalo token, network or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readZaloRuntimeConfig, validateSchoolAccount, validateSchoolProfileAccount, createFirestoreLinkStore, sanitizeSchoolProfile, reportZaloVerificationFailure,
  createFirestoreMealStore, deriveZaloOtpSecret, createSchoolAccountDirectory, createZaloEmailLinkOptions } from '../api/_lib/zalo-runtime.mjs';
import { ZaloMailError } from '../api/_lib/zalo-mail.mjs';
import { ZaloIdentityError } from '../miniapp/server/verify-zalo-identity.mjs';
import { MEAL_ACTION_FIELDS, MEAL_ERROR_STATUS } from '../miniapp/shared/meal-contract.mjs';

const require = createRequire(import.meta.url);

test('verification diagnostics log only fixed stages, fixed reasons and bounded numeric provider metadata', () => {
  const lines = [];
  const secret = 'TEST_ONLY_PRIVATE_DATA_MUST_NOT_APPEAR';
  const error = new ZaloIdentityError('verification_failed', {
    stage: 'provider', providerCode: -1241, httpStatus: 200, message: secret, accessToken: secret,
  });
  error.detail = secret;
  reportZaloVerificationFailure(error, line => lines.push(line));
  assert.deepEqual(lines, ['DKAN_ZALO_VERIFY_FAILED {"stage":"provider","providerCode":-1241,"httpStatus":200}']);
  assert.ok(!lines.join('').includes(secret));
  reportZaloVerificationFailure({ diagnostic: { stage: secret }, message: secret }, line => lines.push(line));
  assert.equal(lines.length, 1);
  assert.doesNotThrow(() => reportZaloVerificationFailure(error, () => { throw new Error(secret); }));
  for (const providerReason of ['ip_restricted', 'app_inactive', 'invalid_proof', 'invalid_token', 'unknown', secret]) {
    const reasonError = new ZaloIdentityError('verification_failed', { stage: 'provider', providerCode: -501,
      httpStatus: 200, providerReason, message: secret });
    const output = [];
    reportZaloVerificationFailure(reasonError, line => output.push(line));
    const diagnostic = JSON.parse(output[0].slice('DKAN_ZALO_VERIFY_FAILED '.length));
    assert.deepEqual(diagnostic, { stage: 'provider', providerCode: -501, httpStatus: 200,
      ...(providerReason === secret ? {} : { providerReason }) });
    assert.ok(!output[0].includes(secret));
  }
});
let createZaloHandler, AccountLinkError, createAccountLinkService;
test.before(async () => {
  const result = await build({ stdin: { contents: `export {createZaloHandler} from './api/zalo.ts'; export {AccountLinkError,createAccountLinkService} from './miniapp/server/account-links.mjs';`,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)), loader: 'ts' }, bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
  ({ createZaloHandler, AccountLinkError, createAccountLinkService } = module.exports);
});

async function request({ method = 'POST', origin = 'https://h5.zdn.vn', auth = 'Bearer TEST_ONLY_TOKEN',
  body = { action: 'mini.login' }, enabled = 'true', environment = 'production', serviceError } = {}) {
  let calls = 0, received;
  const handler = createZaloHandler({ env: { DKAN_ZALO_ENABLED: enabled, NODE_ENV: environment },
    getService: () => ({ async run(...args) { calls++; received = args; if (serviceError) throw serviceError; return { linked: false }; } }) });
  const res = { headers: {}, statusCode: 0, payload: undefined,
    setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; }, end() {} };
  await handler({ method, headers: { origin, authorization: auth }, body }, res);
  return { ...res, calls, received };
}

test('feature disabled fails closed without opening Firebase or running service', async () => {
  const r = await request({ enabled: 'false' });
  assert.equal(r.statusCode, 503); assert.equal(r.calls, 0); assert.equal(r.payload.error.code, 'not_configured');
});

test('production handler can use the Vietnam API without local Firebase credentials and preserves all entry checks', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api-suatan.nshm.vn/api/zalo');
    assert.equal(options.headers.authorization, 'Bearer TEST_ONLY_ZALO_TOKEN');
    assert.equal(options.headers.origin, 'https://suatanapp.vercel.app');
    assert.deepEqual(JSON.parse(options.body), { action: 'mini.login' });
    return Response.json({ linked: false });
  };
  try {
    const handler = createZaloHandler({ env: { NODE_ENV: 'production', DKAN_ZALO_ENABLED: 'true',
      DKAN_ZALO_API_UPSTREAM_URL: 'https://api-suatan.nshm.vn/api/zalo' } });
    const invoke = async (origin, authorization = 'Bearer TEST_ONLY_ZALO_TOKEN') => {
      const res = { headers: {}, statusCode: 0, payload: undefined,
        setHeader(k, v) { this.headers[k] = v; }, status(v) { this.statusCode = v; return this; },
        json(v) { this.payload = v; }, end() {} };
      await handler({ method: 'POST', headers: { origin, authorization }, body: { action: 'mini.login' } }, res);
      return res;
    };
    assert.equal((await invoke('https://evil.example')).statusCode, 403);
    assert.equal((await invoke('https://h5.zdn.vn', '')).statusCode, 401);
    assert.equal(calls, 0);
    const success = await invoke('https://h5.zdn.vn');
    assert.equal(success.statusCode, 200);
    assert.equal(success.headers['Cache-Control'], 'no-store');
    assert.equal(success.headers['Access-Control-Allow-Origin'], 'https://h5.zdn.vn');
    assert.deepEqual(success.payload, { linked: false });
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test('CORS only permits the school and Zalo origins, with no credential cookie access', async () => {
  for (const origin of ['https://evil.example', 'null', 'https://h5.zdn.vn.evil.example', 'http://127.0.0.1:4930',
    'http://suatanapp.vercel.app', 'https://suatanapp.vercel.app.evil.example', 'https://suatanapp-preview.vercel.app']) {
    const r = await request({ origin }); assert.equal(r.statusCode, 403); assert.equal(r.calls, 0);
  }
  const preflight = await request({ method: 'OPTIONS' });
  assert.equal(preflight.statusCode, 204); assert.equal(preflight.calls, 0);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://h5.zdn.vn');
  assert.equal(preflight.headers['Access-Control-Allow-Credentials'], undefined);
  assert.match(preflight.headers['Access-Control-Allow-Headers'], /Authorization/);
  assert.equal((await request({ origin: 'http://127.0.0.1:4930', environment: 'development' })).statusCode, 200);
  const deployedWeb = await request({ origin: 'https://suatanapp.vercel.app' });
  assert.equal(deployedWeb.statusCode, 200);
  assert.equal(deployedWeb.headers['Access-Control-Allow-Origin'], 'https://suatanapp.vercel.app');
});
test('rejects methods and missing or malformed bearer tokens before service', async () => {
  assert.equal((await request({ method: 'GET' })).statusCode, 405);
  for (const auth of [undefined, '', 'Basic TEST', 'Bearer a b', 'Bearer a\nb', ['Bearer token']]) {
    const r = await request({ auth: auth === undefined ? '' : auth }); assert.equal(r.statusCode, 401); assert.equal(r.calls, 0);
  }
});
test('strict action and body whitelist rejects injected UID/email/admin flags and prototype keys', async () => {
  for (const body of [null, [], '{}', { action: 'admin.list' }, { action: 'mini.login', uid: 'other-user' },
    { action: 'web.confirmLink', challengeId: 'a'.repeat(64), email: 'somebody@example.com' },
    JSON.parse('{"action":"mini.login","__proto__":{"admin":true}}')]) {
    const r = await request({ body }); assert.equal(r.statusCode, 400); assert.equal(r.calls, 0);
  }
});
test('limits body size, then forwards only exact action fields and raw bearer', async () => {
  const oversized = await request({ body: { action: 'mini.claim', code: 'x'.repeat(9000) } });
  assert.equal(oversized.statusCode, 413); assert.equal(oversized.calls, 0);
  const r = await request({ body: { action: 'mini.claim', code: 'Abc_def-01234567890123456' } });
  assert.equal(r.statusCode, 200); assert.deepEqual(r.received,
    ['mini.claim', { code: 'Abc_def-01234567890123456' }, 'TEST_ONLY_TOKEN']);
  assert.equal(r.headers['Cache-Control'], 'no-store');
});
test('meal RPC actions require every exact field and reject all client identity or permission selectors', async () => {
  const bodies = {
    'meal.snapshot': { month: '2026-11', weekId: '2026-11-02' },
    'meal.register': { month: '2026-11', breakfast: true, lunch: true },
    'meal.cancel': { dates: ['2026-11-04'], meal: 'lunch', reason: 'TEST_ONLY', canteen: 'TEST_ONLY' },
    'meal.event': { eventId: 'TEST_ONLY_EVENT', choice: true },
    'meal.survey': { weekId: '2026-11-02', answers: { TEST_ONLY: 5 } },
  };
  assert.deepEqual(Object.keys(bodies).sort(), Object.keys(MEAL_ACTION_FIELDS).sort());
  for (const [action, body] of Object.entries(bodies)) {
    const result = await request({ body: { action, ...body } });
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.received, [action, body, 'TEST_ONLY_TOKEN']);
    for (const key of MEAL_ACTION_FIELDS[action]) {
      const missing = { action, ...body }; delete missing[key];
      const denied = await request({ body: missing });
      assert.equal(denied.statusCode, 400); assert.equal(denied.calls, 0);
    }
    for (const extra of [{ uid: 'forged' }, { email: 'forged@hoangmaistarschool.edu.vn' }, { employeeId: 'forged' }, { admin: true }]) {
      const denied = await request({ body: { action, ...body, ...extra } });
      assert.equal(denied.statusCode, 400); assert.equal(denied.calls, 0);
    }
  }
});

test('business service errors are fixed public messages with their documented statuses', async () => {
  for (const [code, status] of Object.entries(MEAL_ERROR_STATUS)) {
    const error = new AccountLinkError(status, code);
    const result = await request({ body: { action: 'meal.snapshot', month: '2026-11', weekId: '2026-11-02' }, serviceError: error });
    assert.equal(result.statusCode, status);
    assert.equal(result.payload.error.code, code);
    assert.ok(!result.payload.error.message.includes('TEST_ONLY'));
  }
});
test('returns trusted service errors and sanitizes unexpected errors without exposing secrets', async () => {
  const conflict = await request({ serviceError: new AccountLinkError(409, 'link_conflict') });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.payload.error.code, 'link_conflict');
  const verification = await request({ serviceError: new AccountLinkError(403, 'email_verification_required') });
  assert.equal(verification.statusCode, 403);
  assert.equal(verification.payload.error.code, 'email_verification_required');
  assert.match(verification.payload.error.message, /xác minh địa chỉ email/);
  const failed = await request({ serviceError: new Error('TEST_ONLY_SECRET_AND_PRIVATE_KEY') });
  assert.equal(failed.statusCode, 503); assert.ok(!JSON.stringify(failed).includes('TEST_ONLY_SECRET_AND_PRIVATE_KEY'));
});

const env = () => ({ DKAN_ZALO_ENABLED: 'true', ZALO_APP_ID: '123456789', ZALO_MINI_APP_ID: '987654321',
  ZALO_APP_SECRET_KEY: 'TEST_ONLY_SECRET_123456789', FIREBASE_ADMIN_CREDENTIALS_JSON: JSON.stringify({
    type: 'service_account', project_id: 'dkan-4b061', client_email: 'test@dkan-4b061.iam.gserviceaccount.com',
    private_key: '-----BEGIN PRIVATE KEY-----\nTEST_ONLY_NOT_A_REAL_KEY\n-----END PRIVATE KEY-----\n',
  }) });
test('server config requires an enabled flag, numeric strings, a real-format secret and exact Firebase project', () => {
  assert.equal(readZaloRuntimeConfig(env()).appId, '123456789');
  const variants = [ { DKAN_ZALO_ENABLED: 'false' }, { ZALO_APP_ID: 123 }, { ZALO_MINI_APP_ID: '9/9' },
    { ZALO_APP_SECRET_KEY: 'DÁN_KHÓA_VÀO_ĐÂY' }, { ZALO_APP_SECRET_KEY: 'your_secret_value_here' },
    { FIREBASE_ADMIN_CREDENTIALS_JSON: 'invalid' },
    { FIREBASE_ADMIN_CREDENTIALS_JSON: JSON.stringify({ ...JSON.parse(env().FIREBASE_ADMIN_CREDENTIALS_JSON), project_id: 'other-project' }) } ];
  for (const variant of variants) assert.throws(() => readZaloRuntimeConfig({ ...env(), ...variant }), error =>
    error.status === 503 && !error.message.includes('TEST_ONLY'));
});

const nowMs = Date.parse('2026-10-30T08:00:00Z');
const decoded = () => ({ uid: 'user_A', email: 'teacher@hoangmaistarschool.edu.vn', email_verified: true,
  auth_time: Math.floor(nowMs / 1000) - 60, firebase: { sign_in_provider: 'microsoft.com' } });
const user = () => ({ uid: 'user_A', email: 'teacher@hoangmaistarschool.edu.vn', emailVerified: true,
  disabled: false, providerData: [{ providerId: 'microsoft.com' }] });
test('school identity requires verified Microsoft email, same UID and enabled account', () => {
  assert.deepEqual(validateSchoolAccount(decoded(), user(), { requireRecent: true, nowMs }),
    { uid: 'user_A', email: 'teacher@hoangmaistarschool.edu.vn' });
  for (const mutation of [{ disabled: true }, { uid: 'user_B' },
    { email: 'teacher@gmail.com' }, { providerData: [{ providerId: 'google.com' }] }])
    assert.throws(() => validateSchoolAccount(decoded(), { ...user(), ...mutation }), error => error.code === 'account_unavailable');
  assert.throws(() => validateSchoolAccount({ ...decoded(), firebase: { sign_in_provider: 'custom' } }, user()), error => error.code === 'account_unavailable');
});
test('custom school-domain Microsoft accounts require mailbox verification without being labeled as denied permission', () => {
  for (const [recordFlag, tokenFlag] of [[false, false], [false, true], [true, false], [undefined, undefined], ['true', true], [true, 1]]) {
    assert.throws(() => validateSchoolAccount({ ...decoded(), email_verified: tokenFlag }, { ...user(), emailVerified: recordFlag }),
      error => error.status === 403 && error.code === 'email_verification_required');
  }
  // A refreshed, verified identity passes; no policy or provider bypass is added.
  assert.deepEqual(validateSchoolAccount(decoded(), user()), { uid: 'user_A', email: 'teacher@hoangmaistarschool.edu.vn' });
});
test('unverified flags never mask invalid identity, UID, school domain, Microsoft provider or disabled status', () => {
  const pendingToken = { ...decoded(), email_verified: false }, pendingUser = { ...user(), emailVerified: false };
  for (const [token, record] of [[pendingToken, { ...pendingUser, disabled: true }],
    [pendingToken, { ...pendingUser, uid: 'user_B' }],
    [{ ...pendingToken, uid: '__reserved__' }, { ...pendingUser, uid: '__reserved__' }],
    [{ ...pendingToken, uid: 123 }, { ...pendingUser, uid: 123 }],
    [pendingToken, { ...pendingUser, email: 'other@hoangmaistarschool.edu.vn' }],
    [{ ...pendingToken, email: 'teacher@outside.example' }, { ...pendingUser, email: 'teacher@outside.example' }],
    [{ ...pendingToken, firebase: { sign_in_provider: 'google.com' } }, pendingUser],
    [pendingToken, { ...pendingUser, providerData: [{ providerId: 'google.com' }] }],
    [pendingToken, { ...pendingUser, providerData: [null] }],
    [null, pendingUser], [pendingToken, null]]) {
    assert.throws(() => validateSchoolAccount(token, record), error => error.status === 403 && error.code === 'account_unavailable');
  }
});
test('Mini App profile reads use the same current account verification, UID, provider, domain and disabled checks', () => {
  assert.deepEqual(validateSchoolProfileAccount('user_A', user()), { uid: 'user_A', email: 'teacher@hoangmaistarschool.edu.vn' });
  for (const emailVerified of [false, undefined, 'true'])
    assert.throws(() => validateSchoolProfileAccount('user_A', { ...user(), emailVerified }),
      error => error.status === 403 && error.code === 'email_verification_required');
  for (const mutation of [{ uid: 'user_B' }, { disabled: true }, { email: 'teacher@gmail.com' },
    { providerData: [] }, { providerData: [null] }, { providerData: null }])
    assert.throws(() => validateSchoolProfileAccount('user_A', { ...user(), emailVerified: false, ...mutation }),
      error => error.status === 403 && error.code === 'account_unavailable');
});
test('fresh JWT iat does not bypass old or future authentication time for confirmation', () => {
  for (const auth_time of [Math.floor(nowMs / 1000) - 601, Math.floor(nowMs / 1000) + 120, undefined]) {
    assert.throws(() => validateSchoolAccount({ ...decoded(), auth_time, iat: nowMs / 1000 }, user(), { requireRecent: true, nowMs }),
      error => error.code === 'recent_auth_required');
  }
});

test('unverified school RPC requests preserve actionable error and cannot read or write link storage', async () => {
  let storageCalls = 0;
  const unexpectedStorage = async () => { storageCalls++; throw new Error('Storage must not run before verification'); };
  const service = createAccountLinkService({
    appId: '123456789', miniAppId: '987654321', now: () => nowMs,
    store: { get: unexpectedStorage, runTransaction: unexpectedStorage },
    verifySchoolToken: async () => validateSchoolAccount({ ...decoded(), email_verified: false }, { ...user(), emailVerified: false }),
    verifyZaloToken: async () => { throw new Error('Zalo verification must not run'); },
    getSchoolProfile: async () => { throw new Error('Profile must not run'); },
  });
  for (const [action, body] of [['web.getLink', {}], ['web.createChallenge', {}], ['web.revokeLink', {}],
    ['web.challengeStatus', { challengeId: 'a'.repeat(64) }], ['web.confirmLink', { challengeId: 'a'.repeat(64) }]])
    await assert.rejects(service.run(action, body, 'TEST_ONLY_SCHOOL_TOKEN'), error =>
      error.status === 403 && error.code === 'email_verification_required');
  assert.equal(storageCalls, 0);
});

test('linked Zalo login cannot create a session when the current school mailbox becomes unverified', async () => {
  const link = { appId: '123456789', miniAppId: '987654321', uid: 'user_A', zaloUserId: '123456789123456789',
    version: 'a'.repeat(32), linkedAt: nowMs - 1000 };
  let transactionCalls = 0;
  const service = createAccountLinkService({ appId: link.appId, miniAppId: link.miniAppId, now: () => nowMs,
    store: { get: async path => { assert.equal(path, `zalo_links/${link.appId}_${link.zaloUserId}`); return link; },
      runTransaction: async () => { transactionCalls++; throw new Error('No session may be created'); } },
    verifySchoolToken: async () => { throw new Error('School token verification must not run'); },
    verifyZaloToken: async () => ({ zaloUserId: link.zaloUserId }),
    getSchoolProfile: async uid => validateSchoolProfileAccount(uid, { ...user(), emailVerified: false }),
  });
  await assert.rejects(service.run('mini.login', {}, 'TEST_ONLY_ZALO_TOKEN'), error =>
    error.status === 403 && error.code === 'email_verification_required');
  assert.equal(transactionCalls, 0);
});
test('profile names fall back after sanitizing empty or malformed fields and never return roles', () => {
  const account = { ...user(), displayName: 'Giáo viên mẫu' };
  for (const fullName of ['  ', '\n\t', 123, { admin: true }, undefined])
    assert.equal(sanitizeSchoolProfile({ fullName, admin: true, role: 'super_admin' }, account).fullName, 'Giáo viên mẫu');
  assert.equal(sanitizeSchoolProfile({ fullName: '\t' }, { ...account, displayName: '' }).fullName, 'CBGV-NV');
  assert.deepEqual(Object.keys(sanitizeSchoolProfile({}, account)).sort(), ['department', 'email', 'employeeId', 'fullName']);
});
test('Firestore adapter is restricted to exact private link documents', async () => {
  const calls = [];
  const db = { collection: name => ({ doc: id => ({ async get() { calls.push([name, id]); return { exists: false }; } }) }) };
  const store = createFirestoreLinkStore(db);
  assert.equal(await store.get('zalo_links/123_456'), null);
  for (const path of ['staff/user_A', 'checkins/2026-10-30', 'zalo_links/a/b/c', 'zalo_links/../secret', 'zalo_links/'])
    await assert.rejects(store.get(path));
  assert.deepEqual(calls, [['zalo_links', '123_456']]);
});

test('full offline RPC flow requires web approval, returns personal session, then revokes access', async () => {
  const docs = new Map();
  const clone = value => value ? structuredClone(value) : null;
  const store = { async get(path) { return clone(docs.get(path)); }, async runTransaction(fn) {
    const writes = [];
    const result = await fn({ get: async path => clone(docs.get(path)),
      set: (path, value) => writes.push(() => docs.set(path, clone(value))), delete: path => writes.push(() => docs.delete(path)) });
    writes.forEach(write => write()); return result;
  } };
  const profile = { fullName: 'Nhân viên mẫu', employeeId: 'TEST-ONLY', department: 'Đơn vị mẫu', email: 'teacher@hoangmaistarschool.edu.vn' };
  const service = createAccountLinkService({ store, appId: '123456789', miniAppId: '987654321', now: () => nowMs,
    verifySchoolToken: async token => { assert.equal(token, 'SCHOOL_TOKEN_TEST_ONLY'); return { uid: 'user_A', email: profile.email }; },
    verifyZaloToken: async token => { assert.equal(token, 'ZALO_TOKEN_TEST_ONLY'); return { zaloUserId: '123456789123456789' }; },
    getSchoolProfile: async uid => { assert.equal(uid, 'user_A'); return profile; } });
  const handler = createZaloHandler({ env: { DKAN_ZALO_ENABLED: 'true', NODE_ENV: 'production' }, getService: () => service });
  const rpc = async (action, token, fields = {}) => {
    const res = { statusCode: 0, payload: null, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; } };
    await handler({ method: 'POST', headers: { origin: 'https://dkan.nshm.vn', authorization: `Bearer ${token}` }, body: { action, ...fields } }, res);
    return res;
  };
  const challenge = (await rpc('web.createChallenge', 'SCHOOL_TOKEN_TEST_ONLY')).payload;
  assert.equal(challenge.code.length, 24);
  const claim = (await rpc('mini.claim', 'ZALO_TOKEN_TEST_ONLY', { code: challenge.code })).payload;
  assert.equal((await rpc('mini.claimStatus', claim.claimToken)).payload.state, 'pending');
  assert.deepEqual((await rpc('mini.login', 'ZALO_TOKEN_TEST_ONLY')).payload, { linked: false });
  assert.equal((await rpc('web.confirmLink', 'SCHOOL_TOKEN_TEST_ONLY', { challengeId: challenge.challengeId })).payload.linked, true);
  assert.equal((await rpc('mini.claimStatus', claim.claimToken)).payload.state, 'approved');
  const login = (await rpc('mini.login', 'ZALO_TOKEN_TEST_ONLY')).payload;
  assert.equal(login.sessionToken.length, 43); assert.deepEqual(login.profile, profile);
  assert.deepEqual((await rpc('mini.me', login.sessionToken)).payload, { profile });
  assert.deepEqual((await rpc('web.revokeLink', 'SCHOOL_TOKEN_TEST_ONLY')).payload, { revoked: true, linked: false });
  assert.equal((await rpc('mini.me', login.sessionToken)).statusCode, 401);
  for (const value of docs.values()) {
    const stored = JSON.stringify(value);
    assert.ok(!stored.includes(challenge.code)); assert.ok(!stored.includes(claim.claimToken)); assert.ok(!stored.includes(login.sessionToken));
  }
});

test('OTP RPC actions forward only the typed address or code; the Zalo user always comes from the bearer', async () => {
  for (const [action, body, other] of [['mini.requestOtp', { email: 'teacher' }, { code: '012345' }],
    ['mini.verifyOtp', { code: '012345' }, { email: 'teacher@hoangmaistarschool.edu.vn' }]]) {
    const allowed = await request({ body: { action, ...body } });
    assert.equal(allowed.statusCode, 200);
    assert.deepEqual(allowed.received, [action, body, 'TEST_ONLY_TOKEN']);
    for (const denied of [{ action }, { action, ...body, ...other }, { action, ...body, zaloUserId: '123456789123456789' },
      { action, ...body, uid: 'user_A' }, { action, ...body, admin: true }]) {
      const result = await request({ body: denied });
      assert.equal(result.statusCode, 400); assert.equal(result.calls, 0);
    }
  }
  const oversized = await request({ body: { action: 'mini.requestOtp', email: 'x'.repeat(9000) } });
  assert.equal(oversized.statusCode, 413); assert.equal(oversized.calls, 0);
});

test('OTP public errors keep their documented statuses and actionable Vietnamese messages', async () => {
  for (const [status, code, message] of [[422, 'otp_invalid', /Mã xác minh chưa đúng/], [410, 'otp_expired', /gửi mã mới/],
    [404, 'account_not_found', /Chưa có tài khoản Suất ăn/], [503, 'email_link_unavailable', /bộ phận CNTT/]]) {
    const result = await request({ body: { action: 'mini.verifyOtp', code: '012345' }, serviceError: new AccountLinkError(status, code) });
    assert.equal(result.statusCode, status);
    assert.equal(result.payload.error.code, code);
    assert.match(result.payload.error.message, message);
  }
});

test('link store reaches the OTP documents but business transactions can never read them', async () => {
  const calls = [];
  const db = { collection: name => ({ doc: id => ({ async get() { calls.push([name, id]); return { exists: false }; } }) }) };
  const store = createFirestoreLinkStore(db);
  assert.equal(await store.get('zalo_link_otps/123_456'), null);
  assert.equal(await store.get('zalo_link_otp_limits/123_user_A'), null);
  for (const path of ['zalo_link_otps/123_456/x', 'zalo_link_otps/../x', 'zalo_link_otp/123_456']) await assert.rejects(store.get(path));
  assert.deepEqual(calls, [['zalo_link_otps', '123_456'], ['zalo_link_otp_limits', '123_user_A']]);
  const reads = [];
  const mealDb = { doc: path => ({ path }), runTransaction: fn => fn({ async get(ref) { reads.push(ref.path); return { exists: false }; } }) };
  const meal = createFirestoreMealStore(mealDb, 'user_A');
  assert.equal(await meal.runTransaction(tx => tx.get('zalo_link_sessions/test_session')), null);
  for (const path of ['zalo_link_otps/123_456', 'zalo_link_otp_limits/123_user_A'])
    await assert.rejects(meal.runTransaction(tx => tx.get(path)), error => error.code === 'service_unavailable');
  assert.deepEqual(reads, ['zalo_link_sessions/test_session']);
});

test('OTP secret is a labelled HMAC of the Zalo app secret, never the secret itself', () => {
  const secret = 'TEST_ONLY_SECRET_123456789', derived = deriveZaloOtpSecret(secret);
  assert.match(derived, /^[a-f0-9]{64}$/);
  assert.equal(derived, createHmac('sha256', secret).update('dkan-zalo-email-otp-v1').digest('hex'));
  assert.equal(deriveZaloOtpSecret(secret), derived);
  assert.notEqual(deriveZaloOtpSecret('TEST_ONLY_SECRET_987654321'), derived);
  assert.ok(!derived.includes(secret));
  for (const value of [undefined, null, '', 'TEST_ONLY_SHORT', 123]) assert.equal(deriveZaloOtpSecret(value), undefined);
});

const SCHOOL_EMAIL_TEST = 'teacher@hoangmaistarschool.edu.vn';
function fakeAuth() {
  const users = new Map([['user_A', { uid: 'user_A', email: SCHOOL_EMAIL_TEST, emailVerified: false, disabled: false,
    displayName: 'Tên hiển thị', providerData: [{ providerId: 'microsoft.com' }] }]]);
  const calls = [];
  const notFound = () => Object.assign(new Error('TEST_ONLY_AUTH_TEXT'), { code: 'auth/user-not-found' });
  return { users, calls,
    async getUserByEmail(email) {
      calls.push(['getUserByEmail', email]);
      const found = [...users.values()].find(user => user.email.toLowerCase() === email);
      if (!found) throw notFound();
      return structuredClone(found);
    },
    async getUser(uid) { calls.push(['getUser', uid]); if (!users.has(uid)) throw notFound(); return structuredClone(users.get(uid)); },
    async updateUser(uid, change) { calls.push(['updateUser', uid, change]); Object.assign(users.get(uid), change); },
  };
}
const fakeStaffDb = ({ staff = { fullName: ' Nguyễn\nVăn A ' }, fail = false } = {}) => ({ collection: name => ({ doc: id => ({
  async get() {
    if (fail) throw new Error('TEST_ONLY_FIRESTORE_TEXT');
    assert.equal(name, 'staff');
    return staff && id === 'user_A' ? { exists: true, data: () => structuredClone(staff) } : { exists: false };
  } }) }) });

test('school account lookup by e-mail rechecks the Admin SDK record and accepts a not-yet-verified mailbox', async () => {
  const auth = fakeAuth();
  const { findSchoolAccountByEmail } = createSchoolAccountDirectory(auth, fakeStaffDb());
  // The code proves the mailbox; emailVerified=false must not block sending it.
  assert.deepEqual(await findSchoolAccountByEmail('Teacher@HoangMaiStarSchool.edu.vn'),
    { uid: 'user_A', email: SCHOOL_EMAIL_TEST, name: 'Nguyễn Văn A' });
  assert.deepEqual(auth.calls[0], ['getUserByEmail', SCHOOL_EMAIL_TEST]);
  assert.equal((await createSchoolAccountDirectory(auth, fakeStaffDb({ fail: true })).findSchoolAccountByEmail(SCHOOL_EMAIL_TEST)).name, 'Tên hiển thị');
  assert.equal((await createSchoolAccountDirectory(auth, fakeStaffDb({ staff: null })).findSchoolAccountByEmail(SCHOOL_EMAIL_TEST)).name, 'Tên hiển thị');
  await assert.rejects(findSchoolAccountByEmail('missing@hoangmaistarschool.edu.vn'), error =>
    error instanceof Error && error.code === 'account_not_found' && error.status === 404 && !error.message.includes('TEST_ONLY'));
  for (const mutation of [{ disabled: true }, { providerData: [{ providerId: 'password' }] }, { providerData: null }, { uid: '__reserved__' }]) {
    const changed = fakeAuth();
    Object.assign(changed.users.get('user_A'), mutation);
    await assert.rejects(createSchoolAccountDirectory(changed, fakeStaffDb()).findSchoolAccountByEmail(SCHOOL_EMAIL_TEST),
      error => error.code === 'account_unavailable' && error.status === 403);
  }
  const broken = { async getUserByEmail() { throw Object.assign(new Error('TEST_ONLY_PROVIDER_TEXT'), { code: 'auth/internal-error' }); } };
  await assert.rejects(createSchoolAccountDirectory(broken, fakeStaffDb()).findSchoolAccountByEmail(SCHOOL_EMAIL_TEST), error =>
    !String(error.code).startsWith('account_') && !`${error.message}${error.stack}`.includes('TEST_ONLY_PROVIDER_TEXT'));
  const untouched = fakeAuth();
  for (const email of ['teacher@gmail.com', 'teacher', 123, null, `${'a'.repeat(250)}@hoangmaistarschool.edu.vn`])
    await assert.rejects(createSchoolAccountDirectory(untouched, fakeStaffDb()).findSchoolAccountByEmail(email),
      error => error.code === 'account_unavailable');
  assert.deepEqual(untouched.calls, []);
});

test('markEmailVerified records the proven mailbox only for a current, valid school record', async () => {
  const auth = fakeAuth(), { markEmailVerified } = createSchoolAccountDirectory(auth, fakeStaffDb());
  await markEmailVerified('user_A');
  assert.deepEqual(auth.calls.filter(call => call[0] === 'updateUser'), [['updateUser', 'user_A', { emailVerified: true }]]);
  assert.doesNotThrow(() => validateSchoolProfileAccount('user_A', auth.users.get('user_A')));
  await markEmailVerified('user_A', SCHOOL_EMAIL_TEST);
  assert.equal(auth.calls.filter(call => call[0] === 'updateUser').length, 1, 'already verified: no second write');
  for (const [mutation, expected] of [[{ disabled: true }, undefined], [{ providerData: [] }, undefined],
    [{ email: 'other@hoangmaistarschool.edu.vn' }, SCHOOL_EMAIL_TEST], [{}, 'other@hoangmaistarschool.edu.vn'], [{}, 123]]) {
    const changed = fakeAuth();
    Object.assign(changed.users.get('user_A'), mutation);
    await assert.rejects(createSchoolAccountDirectory(changed, fakeStaffDb()).markEmailVerified('user_A', expected),
      error => error.code === 'account_unavailable');
    assert.equal(changed.users.get('user_A').emailVerified, false);
    assert.ok(!changed.calls.some(call => call[0] === 'updateUser'));
  }
  const readOnly = fakeAuth();
  readOnly.updateUser = async () => { throw Object.assign(new Error('TEST_ONLY_PROVIDER_TEXT'), { code: 'auth/internal-error' }); };
  await assert.rejects(createSchoolAccountDirectory(readOnly, fakeStaffDb()).markEmailVerified('user_A'), error =>
    !String(error.code).startsWith('account_') && !`${error.message}${error.stack}`.includes('TEST_ONLY_PROVIDER_TEXT'));
  const fresh = fakeAuth();
  for (const uid of ['missing_user', '__reserved__', '', 'a/b', 123]) await assert.rejects(
    createSchoolAccountDirectory(fresh, fakeStaffDb()).markEmailVerified(uid), error => error.code === 'account_unavailable');
  assert.ok(!fresh.calls.some(call => call[0] === 'updateUser'));
});

const MAIL_ENV = Object.freeze({ MS_GRAPH_TENANT_ID: '00000000-0000-4000-8000-000000000001',
  MS_GRAPH_CLIENT_ID: '00000000-0000-4000-8000-000000000002', MS_GRAPH_CLIENT_SECRET: 'TEST_ONLY_CLIENT_SECRET_VALUE',
  MS_GRAPH_SENDER: 'dinhduong@hoangmaistarschool.edu.vn' });
function fakeGraph({ sendStatus = 202 } = {}) {
  const mails = [], calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url);
    if (url.startsWith('https://login.microsoftonline.com/'))
      return Response.json({ token_type: 'Bearer', expires_in: 3599, access_token: 'TEST_ONLY_GRAPH_TOKEN' });
    mails.push(JSON.parse(options.body).message);
    return new Response(sendStatus === 202 ? null : 'TEST_ONLY_GRAPH_ERROR_TEXT', { status: sendStatus });
  };
  return { mails, calls, fetchImpl };
}

test('mail settings are optional: missing or invalid MS_GRAPH_* only drop sendLinkEmail and log variable names', () => {
  const lines = [], report = line => lines.push(line);
  const keys = options => Object.keys(options).sort();
  const missing = createZaloEmailLinkOptions({ env: {}, appSecret: 'TEST_ONLY_SECRET_123456789', auth: fakeAuth(), db: fakeStaffDb(), report });
  assert.deepEqual(keys(missing), ['findSchoolAccountByEmail', 'markEmailVerified', 'otpSecret']);
  assert.equal(missing.otpSecret, deriveZaloOtpSecret('TEST_ONLY_SECRET_123456789'));
  const invalid = createZaloEmailLinkOptions({ env: { ...MAIL_ENV, MS_GRAPH_SENDER: 'dinhduong@gmail.com',
    MS_GRAPH_CLIENT_SECRET: 'your_client_secret_here' }, appSecret: 'TEST_ONLY_SECRET_123456789', auth: fakeAuth(), db: fakeStaffDb(), report });
  assert.deepEqual(keys(invalid), ['findSchoolAccountByEmail', 'markEmailVerified', 'otpSecret']);
  assert.deepEqual(lines, [
    'DKAN_ZALO_MAIL_UNAVAILABLE {"missing":["MS_GRAPH_TENANT_ID","MS_GRAPH_CLIENT_ID","MS_GRAPH_CLIENT_SECRET","MS_GRAPH_SENDER"],"invalid":[]}',
    'DKAN_ZALO_MAIL_UNAVAILABLE {"missing":[],"invalid":["MS_GRAPH_CLIENT_SECRET","MS_GRAPH_SENDER"]}']);
  const configured = createZaloEmailLinkOptions({ env: MAIL_ENV, appSecret: 'TEST_ONLY_SECRET_123456789',
    auth: fakeAuth(), db: fakeStaffDb(), fetchImpl: fakeGraph().fetchImpl, report });
  assert.deepEqual(keys(configured), ['findSchoolAccountByEmail', 'markEmailVerified', 'otpSecret', 'sendLinkEmail']);
  assert.equal(lines.length, 2);
  // Never throws, even with a throwing logger or nothing at all.
  assert.doesNotThrow(() => createZaloEmailLinkOptions({ env: {}, report: () => { throw new Error('TEST_ONLY'); } }));
  assert.doesNotThrow(() => createZaloEmailLinkOptions({ report: () => {} }));
  assert.equal(createZaloEmailLinkOptions({ report: () => {} }).otpSecret, undefined);
  assert.deepEqual(createZaloEmailLinkOptions(null), {});
});

test('sendLinkEmail sends through Graph, and a failure logs one fixed line and rethrows no provider text', async () => {
  const ok = fakeGraph(), lines = [];
  const { sendLinkEmail } = createZaloEmailLinkOptions({ env: MAIL_ENV, appSecret: 'TEST_ONLY_SECRET_123456789',
    auth: fakeAuth(), db: fakeStaffDb(), fetchImpl: ok.fetchImpl, report: line => lines.push(line) });
  await sendLinkEmail({ kind: 'otp', to: SCHOOL_EMAIL_TEST, code: '012345', expiresAt: nowMs + 600_000, name: 'Nguyễn Văn A' });
  assert.equal(ok.mails.length, 1);
  assert.equal(ok.mails[0].subject, 'Mã xác minh liên kết Zalo: 012345');
  assert.deepEqual(ok.mails[0].toRecipients, [{ emailAddress: { address: SCHOOL_EMAIL_TEST } }]);
  const denied = fakeGraph({ sendStatus: 403 });
  const failing = createZaloEmailLinkOptions({ env: MAIL_ENV, appSecret: 'TEST_ONLY_SECRET_123456789',
    auth: fakeAuth(), db: fakeStaffDb(), fetchImpl: denied.fetchImpl, report: line => lines.push(line) });
  await assert.rejects(failing.sendLinkEmail({ kind: 'linked', to: SCHOOL_EMAIL_TEST, linkedAt: nowMs }), error =>
    error instanceof ZaloMailError && error.code === 'send_failed' && !`${error.message}${error.stack}`.includes('TEST_ONLY'));
  assert.deepEqual(lines, ['DKAN_ZALO_MAIL_FAILED {"code":"send_failed","httpStatus":403}']);
});

test('offline e-mail OTP flow links, verifies the mailbox, signs in and notifies through the wired runtime', async () => {
  const docs = new Map();
  const clone = value => value ? structuredClone(value) : null;
  const store = { async get(path) { return clone(docs.get(path)); }, async runTransaction(fn) {
    const writes = [];
    const result = await fn({ get: async path => clone(docs.get(path)),
      set: (path, value) => writes.push(() => docs.set(path, clone(value))), delete: path => writes.push(() => docs.delete(path)) });
    writes.forEach(write => write()); return result;
  } };
  const auth = fakeAuth(), graph = fakeGraph();
  const service = env => createAccountLinkService({ store, appId: '123456789', miniAppId: '987654321', now: () => nowMs,
    verifySchoolToken: async () => { throw new Error('School token verification must not run'); },
    verifyZaloToken: async token => { assert.equal(token, 'ZALO_TOKEN_TEST_ONLY'); return { zaloUserId: '123456789123456789' }; },
    // Same current-record check as production: fails until the mailbox is verified.
    async getSchoolProfile(uid) {
      const user = await auth.getUser(uid);
      validateSchoolProfileAccount(uid, user);
      return sanitizeSchoolProfile({ fullName: 'Nhân viên mẫu' }, user);
    },
    ...createZaloEmailLinkOptions({ env, appSecret: 'TEST_ONLY_SECRET_123456789', auth, db: fakeStaffDb(),
      fetchImpl: graph.fetchImpl, report: () => {} }) });
  const rpcWith = links => async (action, token, fields = {}) => {
    const handler = createZaloHandler({ env: { DKAN_ZALO_ENABLED: 'true', NODE_ENV: 'production' }, getService: () => links });
    const res = { statusCode: 0, payload: null, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; } };
    await handler({ method: 'POST', headers: { origin: 'https://h5.zdn.vn', authorization: `Bearer ${token}` }, body: { action, ...fields } }, res);
    return res;
  };

  // Without mail settings only the OTP actions are off; Zalo login still answers.
  const disabled = rpcWith(service({}));
  const off = await disabled('mini.requestOtp', 'ZALO_TOKEN_TEST_ONLY', { email: 'teacher' });
  assert.equal(off.statusCode, 503); assert.equal(off.payload.error.code, 'email_link_unavailable');
  assert.deepEqual((await disabled('mini.login', 'ZALO_TOKEN_TEST_ONLY')).payload, { linked: false });
  assert.equal(graph.mails.length, 0);

  const rpc = rpcWith(service(MAIL_ENV));
  const sent = await rpc('mini.requestOtp', 'ZALO_TOKEN_TEST_ONLY', { email: 'teacher' });
  assert.equal(sent.statusCode, 200);
  assert.deepEqual(sent.payload, { state: 'sent', emailMasked: 't***r@hoangmaistarschool.edu.vn',
    expiresAt: nowMs + 10 * 60_000, resendAt: nowMs + 60_000, replacesExisting: false });
  assert.equal(graph.mails.length, 1);
  assert.deepEqual(graph.mails[0].toRecipients, [{ emailAddress: { address: SCHOOL_EMAIL_TEST } }]);
  const code = /^Mã xác minh liên kết Zalo: (\d{6})$/.exec(graph.mails[0].subject)?.[1];
  assert.ok(code);
  for (const value of docs.values()) assert.ok(!JSON.stringify(value).includes(`"${code}"`), 'raw code is never stored');
  // A repeat inside the cooldown (e.g. after a lost reply) gets the code already mailed, with no second mail.
  const repeat = await rpc('mini.requestOtp', 'ZALO_TOKEN_TEST_ONLY', { email: SCHOOL_EMAIL_TEST });
  assert.equal(repeat.statusCode, 200); assert.deepEqual(repeat.payload, sent.payload); assert.equal(graph.mails.length, 1);
  // Another address from the same Zalo user waits for the cooldown, before any Auth lookup.
  const lookups = auth.calls.filter(([name]) => name === 'getUserByEmail').length;
  const other = await rpc('mini.requestOtp', 'ZALO_TOKEN_TEST_ONLY', { email: 'khongtontai' });
  assert.equal(other.statusCode, 429); assert.equal(other.payload.error.code, 'rate_limited'); assert.equal(graph.mails.length, 1);
  assert.equal(auth.calls.filter(([name]) => name === 'getUserByEmail').length, lookups);

  const wrong = await rpc('mini.verifyOtp', 'ZALO_TOKEN_TEST_ONLY', { code: code === '000000' ? '111111' : '000000' });
  assert.equal(wrong.statusCode, 422); assert.equal(wrong.payload.error.code, 'otp_invalid');
  assert.equal(auth.users.get('user_A').emailVerified, false);

  const linked = await rpc('mini.verifyOtp', 'ZALO_TOKEN_TEST_ONLY', { code });
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.payload.linked, true);
  assert.equal(linked.payload.sessionToken.length, 43);
  assert.equal(linked.payload.profile.email, SCHOOL_EMAIL_TEST);
  assert.equal(auth.users.get('user_A').emailVerified, true);
  for (let tick = 0; tick < 20 && graph.mails.length < 2; tick++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(graph.mails.length, 2);
  assert.equal(graph.mails[1].subject, 'Tài khoản Suất ăn vừa liên kết với Zalo');
  assert.ok(!JSON.stringify(graph.mails[1]).includes(code));
  assert.equal(graph.calls.filter(url => url.startsWith('https://login.microsoftonline.com/')).length, 1, 'app token is reused');

  assert.equal((await rpc('mini.me', linked.payload.sessionToken)).payload.profile.email, SCHOOL_EMAIL_TEST);
  assert.equal((await rpc('mini.login', 'ZALO_TOKEN_TEST_ONLY')).payload.linked, true);
  const replay = await rpc('mini.verifyOtp', 'ZALO_TOKEN_TEST_ONLY', { code });
  assert.equal(replay.statusCode, 410); assert.equal(replay.payload.error.code, 'otp_expired');
  for (const value of docs.values()) {
    const stored = JSON.stringify(value);
    assert.ok(!stored.includes(`"${code}"`)); assert.ok(!stored.includes(linked.payload.sessionToken));
  }
});
