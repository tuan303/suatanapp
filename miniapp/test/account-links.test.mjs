// Offline only: serialized fake transactions, fake Firebase Auth and fake Zalo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccountLinkService, AccountLinkError } from '../server/account-links.mjs';
import { ZaloIdentityError } from '../server/verify-zalo-identity.mjs';

const APP = '1755714512504824995', MINI = '3378419117469948059';
const ZALO_A = '123456789000000001', ZALO_B = '123456789000000002';
const PRIVATE = 'TEST_ONLY_PROVIDER_SECRET_NEVER_PRINT';
const sha = value => createHash('sha256').update(value).digest('hex');
const copy = value => value === undefined ? null : structuredClone(value);

class FakeStore {
  docs = new Map();
  operations = [];
  queue = Promise.resolve();
  async get(path) { this.operations.push(['get', path]); return copy(this.docs.get(path)); }
  runTransaction(callback) {
    const execute = async () => {
      const snapshot = new Map([...this.docs].map(([path, value]) => [path, copy(value)]));
      const writes = [];
      let wrote = false;
      const result = await callback({
        get: async path => {
          assert.equal(wrote, false, 'Firestore requires every read before any write');
          this.operations.push(['tx.get', path]);
          return copy(snapshot.get(path));
        },
        set: (path, data) => { wrote = true; writes.push(['set', path, copy(data)]); },
        delete: path => { wrote = true; writes.push(['delete', path]); },
      });
      for (const [operation, path, data] of writes) {
        this.operations.push([operation, path]);
        if (operation === 'set') this.docs.set(path, data); else this.docs.delete(path);
      }
      return copy(result);
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
}

function fixture() {
  const store = new FakeStore();
  const state = { now: 1_793_345_400_000, recent: true, disabled: new Set(), schoolCalls: [], profileCalls: [], zaloCalls: [] };
  const identities = {
    'school-A': { uid: 'staff_A', email: 'a@hoangmaistarschool.edu.vn' },
    'school-B': { uid: 'staff_B', email: 'b@hoangmaistarschool.edu.vn' },
  };
  const zaloIds = { 'zalo-A': ZALO_A, 'zalo-B': ZALO_B };
  const profiles = {
    staff_A: { fullName: 'Nhân viên A', employeeId: '100001', department: 'CNTT', email: identities['school-A'].email, role: 'super_admin', isAdmin: true },
    staff_B: { fullName: 'Nhân viên B', employeeId: '100002', department: 'Văn phòng', email: identities['school-B'].email },
  };
  const options = { store, appId: APP, miniAppId: MINI, now: () => state.now,
    verifySchoolToken: async (token, flags) => {
      state.schoolCalls.push({ token, ...flags });
      const identity = identities[token];
      if (!identity) throw new Error(PRIVATE);
      if (state.disabled.has(identity.uid)) throw Object.assign(new Error(PRIVATE), { code: 'auth/user-disabled' });
      if (flags.requireRecent && !state.recent) throw Object.assign(new Error(PRIVATE), { code: 'auth/requires-recent-login' });
      return { ...identity, role: 'admin' };
    },
    verifyZaloToken: async token => {
      state.zaloCalls.push(token);
      if (!zaloIds[token]) throw new Error(PRIVATE);
      return { zaloUserId: zaloIds[token] };
    },
    getSchoolProfile: async uid => {
      state.profileCalls.push(uid);
      if (state.disabled.has(uid) || !profiles[uid]) throw new Error(PRIVATE);
      return profiles[uid];
    },
  };
  const service = createAccountLinkService(options);
  return { store, state, identities, zaloIds, profiles, options, service,
    run: (action, body = {}, bearer = 'school-A') => service.run(action, body, bearer) };
}

async function rejects(promise, code, status) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof AccountLinkError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
    assert.ok(!exposed.includes(PRIVATE));
    for (const token of ['school-A', 'school-B', 'zalo-A', 'zalo-B']) assert.ok(!exposed.includes(token));
    assert.equal(error.cause, undefined);
    return true;
  });
}

async function linked(f, school = 'school-A', zalo = 'zalo-A') {
  const challenge = await f.run('web.createChallenge', {}, school);
  const claim = await f.run('mini.claim', { code: challenge.code }, zalo);
  const link = await f.run('web.confirmLink', { challengeId: challenge.challengeId }, school);
  return { challenge, claim, link };
}

test('complete link requires both verified identities and explicit recent web confirmation', async () => {
  const f = fixture();
  assert.deepEqual(await f.run('mini.login', {}, 'zalo-A'), { linked: false });
  assert.deepEqual(await f.run('web.getLink'), { linked: false });
  const challenge = await f.run('web.createChallenge');
  assert.match(challenge.code, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(challenge.challengeId, sha(challenge.code));
  assert.equal(challenge.expiresAt, f.state.now + 5 * 60_000);
  assert.deepEqual(await f.run('web.challengeStatus', { challengeId: challenge.challengeId }), { state: 'waiting', expiresAt: challenge.expiresAt });
  const claim = await f.run('mini.claim', { code: challenge.code }, 'zalo-A');
  assert.match(claim.claimToken, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(await f.run('mini.login', {}, 'zalo-A'), { linked: false }, 'claim alone cannot grant access');
  assert.deepEqual(await f.run('mini.claimStatus', {}, claim.claimToken), { state: 'pending', expiresAt: challenge.expiresAt });
  assert.deepEqual(await f.run('web.challengeStatus', { challengeId: challenge.challengeId }), {
    state: 'pending', expiresAt: challenge.expiresAt, zaloUserIdSuffix: ZALO_A.slice(-4),
  });
  await rejects(f.run('mini.me', {}, claim.claimToken), 'session_expired', 401);
  assert.deepEqual(await f.run('web.confirmLink', { challengeId: challenge.challengeId }), {
    linked: true, zaloUserIdSuffix: ZALO_A.slice(-4), linkedAt: f.state.now,
  });
  assert.deepEqual(await f.run('mini.claimStatus', {}, claim.claimToken), { state: 'approved', expiresAt: challenge.expiresAt });
  const login = await f.run('mini.login', {}, 'zalo-A');
  assert.equal(login.linked, true);
  assert.match(login.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(login.expiresAt, f.state.now + 8 * 60 * 60_000);
  assert.deepEqual(login.profile, { fullName: 'Nhân viên A', employeeId: '100001', department: 'CNTT', email: 'a@hoangmaistarschool.edu.vn' });
  assert.deepEqual(await f.run('mini.me', {}, login.sessionToken), { profile: login.profile });
  assert.ok(f.state.schoolCalls.filter(call => call.requireRecent).length >= 2);
});

test('stored documents contain hashes and private owner metadata, never plaintext credentials or admin privileges', async () => {
  const f = fixture(), { challenge, claim } = await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const stored = JSON.stringify([...f.store.docs]);
  for (const value of [challenge.code, claim.claimToken, login.sessionToken, 'school-A', 'zalo-A', 'super_admin', 'isAdmin']) assert.ok(!stored.includes(value));
  assert.ok(f.store.docs.has(`zalo_link_challenges/${sha(challenge.code)}`));
  assert.ok(f.store.docs.has(`zalo_link_claims/${sha(claim.claimToken)}`));
  assert.ok(f.store.docs.has(`zalo_link_sessions/${sha(login.sessionToken)}`));
  assert.deepEqual(f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`), f.store.docs.get(`zalo_link_owners/${APP}_staff_A`));
  assert.deepEqual(Object.keys(login.profile).sort(), ['department', 'email', 'employeeId', 'fullName']);
  assert.ok(f.store.operations.every(([, path]) => /^zalo_(link_challenges|link_claims|link_sessions|links|link_owners|link_rate_limits)\//.test(path)));
});

test('one claim consumes the code even when the same Zalo account retries', async () => {
  const f = fixture(), challenge = await f.run('web.createChallenge');
  await f.run('mini.claim', { code: challenge.code }, 'zalo-A');
  await rejects(f.run('mini.claim', { code: challenge.code }, 'zalo-A'), 'challenge_unavailable', 409);
  await rejects(f.run('mini.claim', { code: challenge.code }, 'zalo-B'), 'challenge_unavailable', 409);
});

test('foreign web users cannot inspect or confirm another staff member’s challenge', async () => {
  const f = fixture(), challenge = await f.run('web.createChallenge');
  await f.run('mini.claim', { code: challenge.code }, 'zalo-A');
  await rejects(f.run('web.challengeStatus', { challengeId: challenge.challengeId }, 'school-B'), 'challenge_unavailable', 409);
  await rejects(f.run('web.confirmLink', { challengeId: challenge.challengeId }, 'school-B'), 'challenge_unavailable', 409);
  assert.deepEqual(await f.run('web.getLink', {}, 'school-B'), { linked: false });
  assert.deepEqual(await f.run('mini.login', {}, 'zalo-A'), { linked: false });
});

test('unclaimed, expired and unknown confirmation requests fail without creating links', async () => {
  const f = fixture(), first = await f.run('web.createChallenge');
  await rejects(f.run('web.confirmLink', { challengeId: first.challengeId }), 'challenge_unavailable', 409);
  const second = await f.run('web.createChallenge');
  await f.run('mini.claim', { code: second.code }, 'zalo-A');
  f.state.now = second.expiresAt;
  await rejects(f.run('web.confirmLink', { challengeId: second.challengeId }), 'challenge_unavailable', 409);
  await rejects(f.run('mini.claim', { code: first.code }, 'zalo-A'), 'challenge_unavailable', 409);
  await rejects(f.run('web.confirmLink', { challengeId: 'f'.repeat(64) }), 'challenge_unavailable', 409);
  assert.equal([...f.store.docs.keys()].filter(path => path.startsWith('zalo_links/')).length, 0);
});

test('five-minute TTL is enforced for a code, web status and its opaque pending claim', async () => {
  const f = fixture(), challenge = await f.run('web.createChallenge');
  const claim = await f.run('mini.claim', { code: challenge.code }, 'zalo-A');
  f.state.now = challenge.expiresAt;
  assert.deepEqual(await f.run('web.challengeStatus', { challengeId: challenge.challengeId }), { state: 'expired', expiresAt: challenge.expiresAt });
  assert.deepEqual(await f.run('mini.claimStatus', {}, claim.claimToken), { state: 'expired', expiresAt: challenge.expiresAt });
  await rejects(f.run('mini.claim', { code: challenge.code }, 'zalo-A'), 'challenge_unavailable', 409);
});

test('creating a fresh challenge retires the prior waiting or pending challenge atomically', async () => {
  const f = fixture(), first = await f.run('web.createChallenge');
  const claim = await f.run('mini.claim', { code: first.code }, 'zalo-A');
  const second = await f.run('web.createChallenge');
  assert.notEqual(second.code, first.code);
  assert.deepEqual(await f.run('mini.claimStatus', {}, claim.claimToken), { state: 'expired', expiresAt: first.expiresAt });
  await rejects(f.run('web.confirmLink', { challengeId: first.challengeId }), 'challenge_unavailable', 409);
  await f.run('mini.claim', { code: second.code }, 'zalo-B');
  await f.run('web.confirmLink', { challengeId: second.challengeId });
  assert.equal(f.store.docs.get(`zalo_link_owners/${APP}_staff_A`).zaloUserId, ZALO_B);
});

test('creation is limited to five codes per staff member per ten minutes, including concurrent requests', async () => {
  const f = fixture();
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => f.run('web.createChallenge')));
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 5);
  const failure = attempts.find(result => result.status === 'rejected').reason;
  assert.equal(failure.code, 'rate_limited'); assert.equal(failure.status, 429);
  assert.equal([...f.store.docs.values()].filter(doc => doc.state === 'waiting').length, 1);
  assert.equal(f.store.docs.get(`zalo_link_rate_limits/${APP}_staff_A`).count, 5);
  await f.run('web.createChallenge', {}, 'school-B');
  f.state.now += 10 * 60_000;
  await f.run('web.createChallenge');
  assert.equal(f.store.docs.get(`zalo_link_rate_limits/${APP}_staff_A`).count, 1);
});

test('a concurrent race cannot link one Zalo account to two staff accounts', async () => {
  const f = fixture();
  const a = await f.run('web.createChallenge', {}, 'school-A');
  const b = await f.run('web.createChallenge', {}, 'school-B');
  await f.run('mini.claim', { code: a.code }, 'zalo-A');
  await f.run('mini.claim', { code: b.code }, 'zalo-A');
  const results = await Promise.allSettled([
    f.run('web.confirmLink', { challengeId: a.challengeId }, 'school-A'),
    f.run('web.confirmLink', { challengeId: b.challengeId }, 'school-B'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'link_conflict');
  assert.equal([...f.store.docs.keys()].filter(path => path.startsWith('zalo_link_owners/')).length, 1);
  assert.equal([...f.store.docs.keys()].filter(path => path.startsWith('zalo_links/')).length, 1);
});

test('existing links cannot be taken over from either side', async () => {
  const f = fixture(); await linked(f);
  const otherSchool = await f.run('web.createChallenge', {}, 'school-B');
  await rejects(f.run('mini.claim', { code: otherSchool.code }, 'zalo-A'), 'link_conflict', 409);
  const own = await f.run('web.createChallenge');
  await rejects(f.run('mini.claim', { code: own.code }, 'zalo-B'), 'link_conflict', 409);
  assert.equal(f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).uid, 'staff_A');
  assert.equal(f.store.docs.has(`zalo_links/${APP}_${ZALO_B}`), false);
});

test('same-owner confirmation retry and a new same-pair link preserve the link version and existing sessions', async () => {
  const f = fixture(), first = await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const version = f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).version;
  assert.deepEqual(await f.run('web.confirmLink', { challengeId: first.challenge.challengeId }), first.link);
  await linked(f);
  assert.equal(f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).version, version);
  assert.ok((await f.run('mini.me', {}, login.sessionToken)).profile);
});

test('revoke deletes both mirrors, retires pending challenges and invalidates every old session', async () => {
  const f = fixture(); await linked(f);
  const one = await f.run('mini.login', {}, 'zalo-A'), two = await f.run('mini.login', {}, 'zalo-A');
  const waiting = await f.run('web.createChallenge');
  const claim = await f.run('mini.claim', { code: waiting.code }, 'zalo-A');
  assert.deepEqual(await f.run('web.revokeLink'), { revoked: true, linked: false });
  assert.equal(f.store.docs.has(`zalo_link_owners/${APP}_staff_A`), false);
  assert.equal(f.store.docs.has(`zalo_links/${APP}_${ZALO_A}`), false);
  await rejects(f.run('mini.me', {}, one.sessionToken), 'session_expired', 401);
  await rejects(f.run('mini.me', {}, two.sessionToken), 'session_expired', 401);
  assert.deepEqual(await f.run('mini.claimStatus', {}, claim.claimToken), { state: 'expired', expiresAt: waiting.expiresAt });
  await rejects(f.run('web.confirmLink', { challengeId: waiting.challengeId }), 'challenge_unavailable', 409);
  assert.deepEqual(await f.run('mini.login', {}, 'zalo-A'), { linked: false });
  assert.deepEqual(await f.run('web.revokeLink'), { revoked: true, linked: false });
});

test('re-link after revocation creates a new version; stale sessions cannot revive', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const oldVersion = f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).version;
  await f.run('web.revokeLink');
  await linked(f);
  assert.notEqual(f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).version, oldVersion);
  await rejects(f.run('mini.me', {}, login.sessionToken), 'session_expired', 401);
});

test('session expires at eight hours and logout removes only that opaque session', async () => {
  const f = fixture(); await linked(f);
  const one = await f.run('mini.login', {}, 'zalo-A'), two = await f.run('mini.login', {}, 'zalo-A');
  assert.deepEqual(await f.run('mini.logout', {}, one.sessionToken), { loggedOut: true });
  assert.deepEqual(await f.run('mini.logout', {}, one.sessionToken), { loggedOut: true });
  await rejects(f.run('mini.me', {}, one.sessionToken), 'session_expired', 401);
  assert.ok((await f.run('mini.me', {}, two.sessionToken)).profile);
  f.state.now = two.expiresAt;
  await rejects(f.run('mini.me', {}, two.sessionToken), 'session_expired', 401);
});

test('disabled school accounts cannot create, confirm, log in or use an existing Mini App session', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  f.state.disabled.add('staff_A');
  await rejects(f.run('web.createChallenge'), 'account_unavailable', 403);
  await rejects(f.run('mini.login', {}, 'zalo-A'), 'account_unavailable', 403);
  await rejects(f.run('mini.me', {}, login.sessionToken), 'account_unavailable', 403);
});

test('fresh school authentication is required only for create, confirm and revoke', async () => {
  const f = fixture(), link = await linked(f);
  f.state.recent = false;
  await rejects(f.run('web.createChallenge'), 'recent_auth_required', 403);
  await rejects(f.run('web.confirmLink', { challengeId: link.challenge.challengeId }), 'recent_auth_required', 403);
  await rejects(f.run('web.revokeLink'), 'recent_auth_required', 403);
  assert.equal((await f.run('web.getLink')).linked, true);
  assert.equal((await f.run('web.challengeStatus', { challengeId: link.challenge.challengeId })).state, 'approved');
});

test('strict action/body fields cannot forge UIDs, emails, Zalo IDs, profiles or admin scopes', async () => {
  const f = fixture();
  for (const action of ['admin.list', 'mini.admin', 'web.setRole', '', '__proto__']) await rejects(f.run(action), 'invalid_action', 400);
  for (const body of [null, [], 'body', { uid: 'staff_B' }, { email: 'b@hoangmaistarschool.edu.vn' },
    { role: 'admin' }, { zaloUserId: ZALO_B }, { profile: { isAdmin: true } }, Object.create({ uid: 'staff_B' })]) {
    await rejects(f.run('web.createChallenge', body), 'invalid_request', 400);
  }
  await rejects(f.run('mini.claim', { code: 'x'.repeat(24), uid: 'staff_B' }, 'zalo-A'), 'invalid_request', 400);
  assert.equal(f.state.schoolCalls.length, 0);
  assert.equal(f.state.zaloCalls.length, 0);
});

test('malformed credentials, IDs and unknown opaque tokens fail closed without accessing arbitrary document paths', async () => {
  const f = fixture();
  await rejects(f.run('web.createChallenge', {}, ''), 'unauthenticated', 401);
  await rejects(f.run('web.createChallenge', {}, 'school-A\n'), 'unauthenticated', 401);
  await rejects(f.run('mini.login', {}, 'zalo-forged'), 'unauthenticated', 401);
  f.zaloIds['zalo-forged'] = '../staff_B';
  await rejects(f.run('mini.login', {}, 'zalo-forged'), 'unauthenticated', 401);
  f.identities['school-forged'] = { uid: '../staff_B', email: 'a@hoangmaistarschool.edu.vn' };
  await rejects(f.run('web.createChallenge', {}, 'school-forged'), 'unauthenticated', 401);
  f.identities['school-forged'] = { uid: 'staff_B', email: 'external@example.com' };
  await rejects(f.run('web.createChallenge', {}, 'school-forged'), 'unauthenticated', 401);
  for (const action of ['mini.me', 'mini.logout', 'mini.claimStatus']) await rejects(f.run(action, {}, '../token'), 'unauthenticated', 401);
  await rejects(f.run('mini.claimStatus', {}, 'A'.repeat(43)), 'unauthenticated', 401);
  await rejects(f.run('mini.me', {}, 'A'.repeat(43)), 'session_expired', 401);
  await rejects(f.run('web.challengeStatus', { challengeId: '../other' }), 'invalid_request', 400);
  assert.equal(f.store.operations.some(([, path]) => path.includes('..')), false);
});

test('server IP restrictions return 503 and create no claims, links or sessions; untrusted failures stay 401', async () => {
  const f = fixture();
  const challenge = await f.run('web.createChallenge');
  const before = copy([...f.store.docs]);
  for (const exception of [new ZaloIdentityError('ip_restricted'),
    Object.assign(new Error(PRIVATE), { code: 'ip_restricted' }),
    new ZaloIdentityError('verification_failed')]) {
    const service = createAccountLinkService({ ...f.options, verifyZaloToken: async () => { throw exception; } });
    const trustedRestriction = exception instanceof ZaloIdentityError && exception.code === 'ip_restricted';
    for (const [action, body] of [['mini.login', {}], ['mini.claim', { code: challenge.code }]]) {
      await rejects(service.run(action, body, 'zalo-A'), trustedRestriction ? 'service_unavailable' : 'unauthenticated',
        trustedRestriction ? 503 : 401);
    }
    assert.deepEqual([...f.store.docs], before);
  }
});

test('malformed scoped metadata and one-sided links are rejected rather than overwritten', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  f.store.docs.delete(`zalo_link_owners/${APP}_staff_A`);
  await rejects(f.run('mini.me', {}, login.sessionToken), 'session_expired', 401);
  const challenge = await f.run('web.createChallenge');
  await rejects(f.run('mini.claim', { code: challenge.code }, 'zalo-A'), 'link_conflict', 409);
  assert.equal(f.store.docs.get(`zalo_links/${APP}_${ZALO_A}`).uid, 'staff_A');
});

test('a profile callback cannot return an external email or grant admin fields', async () => {
  const f = fixture(); await linked(f);
  f.profiles.staff_A.email = 'someone@example.com';
  await rejects(f.run('mini.login', {}, 'zalo-A'), 'account_unavailable', 403);
});

test('private store, identity and profile exceptions are never returned to clients', async () => {
  const f = fixture();
  const service = createAccountLinkService({ ...f.options, store: { ...f.store,
    get: async () => { throw new Error(PRIVATE); }, runTransaction: async () => { throw new Error(PRIVATE); } } });
  await rejects(service.run('web.createChallenge', {}, 'school-A'), 'service_unavailable', 503);
  await rejects(service.run('mini.login', {}, 'zalo-A'), 'service_unavailable', 503);
  const foreignError = new AccountLinkError(500, 'service_unavailable');
  foreignError.message = PRIVATE;
  Object.defineProperty(foreignError, 'code', { get() { throw new Error(PRIVATE); } });
  const malicious = createAccountLinkService({ ...f.options, store: { get: async () => { throw foreignError; }, runTransaction: async () => {} } });
  await rejects(malicious.run('mini.login', {}, 'zalo-A'), 'service_unavailable', 503);
});

test('factory IDs, callbacks, store and clock configuration are validated', async () => {
  const f = fixture();
  for (const options of [null, [], {}, { ...f.options, appId: Number(APP) }, { ...f.options, appId: '../app' },
    { ...f.options, miniAppId: '0' }, { ...f.options, verifyZaloToken: null }, { ...f.options, store: {} }]) {
    assert.throws(() => createAccountLinkService(options), error => error instanceof AccountLinkError && error.code === 'invalid_config');
  }
  f.state.now = NaN;
  await rejects(f.run('web.createChallenge'), 'service_unavailable', 503);
});
