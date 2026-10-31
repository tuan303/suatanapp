// Offline only: no live Firebase credentials, Zalo token, network or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readZaloRuntimeConfig, validateSchoolAccount, createFirestoreLinkStore, sanitizeSchoolProfile, reportZaloVerificationFailure } from '../api/_lib/zalo-runtime.mjs';
import { ZaloIdentityError } from '../miniapp/server/verify-zalo-identity.mjs';

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
test('returns trusted service errors and sanitizes unexpected errors without exposing secrets', async () => {
  const conflict = await request({ serviceError: new AccountLinkError(409, 'link_conflict') });
  assert.equal(conflict.statusCode, 409); assert.equal(conflict.payload.error.code, 'link_conflict');
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
  for (const mutation of [{ disabled: true }, { uid: 'user_B' }, { emailVerified: false },
    { email: 'teacher@gmail.com' }, { providerData: [{ providerId: 'google.com' }] }])
    assert.throws(() => validateSchoolAccount(decoded(), { ...user(), ...mutation }), /Tài khoản/);
  assert.throws(() => validateSchoolAccount({ ...decoded(), firebase: { sign_in_provider: 'custom' } }, user()), /Tài khoản/);
});
test('fresh JWT iat does not bypass old or future authentication time for confirmation', () => {
  for (const auth_time of [Math.floor(nowMs / 1000) - 601, Math.floor(nowMs / 1000) + 120, undefined]) {
    assert.throws(() => validateSchoolAccount({ ...decoded(), auth_time, iat: nowMs / 1000 }, user(), { requireRecent: true, nowMs }),
      error => error.code === 'recent_auth_required');
  }
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
