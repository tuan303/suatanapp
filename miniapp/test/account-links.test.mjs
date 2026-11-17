// Offline only: serialized fake transactions, fake Firebase Auth, fake Zalo and a fake mailbox.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createAccountLinkService, AccountLinkError } from '../server/account-links.mjs';
import { ZaloIdentityError } from '../server/verify-zalo-identity.mjs';
import { zaloRevocationPath } from '../server/zalo-withdrawal.mjs';

const APP = '1755714512504824995', MINI = '3378419117469948059';
const ZALO_A = '123456789000000001', ZALO_B = '123456789000000002';
const PRIVATE = 'TEST_ONLY_PROVIDER_SECRET_NEVER_PRINT';
const OTP_SECRET = 'TEST_ONLY_OTP_HMAC_SECRET_0123456789abcdef';
const sha = value => createHash('sha256').update(value).digest('hex');
const hmac = value => createHmac('sha256', OTP_SECRET).update(value).digest('hex');
const copy = value => value === undefined ? null : structuredClone(value);
const otpPath = zaloId => `zalo_link_otps/${APP}_${zaloId}`;
const limitPath = uid => `zalo_link_otp_limits/${APP}_${uid}`;
const ownerPath = uid => `zalo_link_owners/${APP}_${uid}`;
const linkPath = zaloId => `zalo_links/${APP}_${zaloId}`;
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
// After use or a failed send the OTP document keeps only this Zalo user's send history.
const retired = (sentAt, zaloId = ZALO_A) => ({ appId: APP, miniAppId: MINI, zaloUserId: zaloId, sentAt });
const wrongCode = code => code === '000000' ? '000001' : '000000';

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
  const state = { now: 1_793_345_400_000, recent: true, disabled: new Set(), schoolCalls: [], profileCalls: [], zaloCalls: [],
    lookups: [], lookupError: null, verifiedCalls: [], markFailures: 0, mail: [], mailFailures: 0, onMail: null };
  const identities = {
    'school-A': { uid: 'staff_A', email: 'a@hoangmaistarschool.edu.vn' },
    'school-B': { uid: 'staff_B', email: 'b@hoangmaistarschool.edu.vn' },
  };
  const zaloIds = { 'zalo-A': ZALO_A, 'zalo-B': ZALO_B };
  const profiles = {
    staff_A: { fullName: 'Nhân viên A', employeeId: '100001', department: 'CNTT', email: identities['school-A'].email, role: 'super_admin', isAdmin: true },
    staff_B: { fullName: 'Nhân viên B', employeeId: '100002', department: 'Văn phòng', email: identities['school-B'].email },
    staff_C: { fullName: 'Giáo viên C', employeeId: '100003', department: 'Tiểu học', email: 'giaovien.c@hoangmaistarschool.edu.vn' },
    staff_D: { fullName: 'Giáo viên D', employeeId: '100004', department: 'THCS', email: 'td@hoangmaistarschool.edu.vn' },
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
    // Fake Firebase Auth getUserByEmail: the address decides the uid.
    findSchoolAccountByEmail: async email => {
      state.lookups.push(email);
      if (state.lookupError) throw state.lookupError;
      const uid = Object.keys(profiles).find(key => profiles[key].email === email);
      if (!uid) throw Object.assign(new Error(PRIVATE), { code: 'account_not_found' });
      if (state.disabled.has(uid)) throw Object.assign(new Error(PRIVATE), { code: 'account_unavailable' });
      return { uid, email: profiles[uid].email, name: profiles[uid].fullName };
    },
    markEmailVerified: async (uid, expectedEmail) => {
      state.verifiedCalls.push(uid);
      if (expectedEmail !== profiles[uid]?.email) throw Object.assign(new Error(PRIVATE), { code: 'account_unavailable' });
      if (state.markFailures > 0) { state.markFailures--; throw new Error(PRIVATE); }
    },
    // The mailbox records every attempted send, including failing ones.
    sendLinkEmail: async message => {
      state.mail.push(copy(message));
      if (state.onMail) await state.onMail(message);
      if (state.mailFailures > 0) { state.mailFailures--; throw new Error(PRIVATE); }
    },
    otpSecret: OTP_SECRET,
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
    assert.ok(!exposed.includes(OTP_SECRET));
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

async function otpLinked(f, email = 'a', zalo = 'zalo-A') {
  const sent = await f.run('mini.requestOtp', { email }, zalo);
  const login = await f.run('mini.verifyOtp', { code: f.state.mail.at(-1).code }, zalo);
  return { sent, login };
}

// The 6-digit code may only reach the mailbox: walk every stored value.
function assertNoRawCode(f, code) {
  const walk = value => {
    assert.notEqual(value, code, 'raw OTP code stored');
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) { assert.notEqual(key, 'code'); walk(item); }
    }
  };
  for (const doc of f.store.docs.values()) walk(doc);
  assert.ok(!JSON.stringify([...f.store.docs]).includes(OTP_SECRET));
}

test('internal meal authorization binds the session UID without exposing it through mini.me or accepting meal RPCs', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const context = await f.service.authorizeMiniSession(login.sessionToken);
  assert.deepEqual(Object.keys(context).sort(), ['assertCurrent', 'profile', 'uid']);
  assert.equal(context.uid, 'staff_A');
  assert.equal(context.profile.employeeId, '100001');
  assert.equal(context.profile.role, undefined);
  assert.equal(context.profile.isAdmin, undefined);
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.profile), true);
  const me = await f.run('mini.me', {}, login.sessionToken);
  assert.deepEqual(me, { profile: context.profile });
  assert.equal(me.uid, undefined);
  assert.equal(me.assertCurrent, undefined);
  await rejects(f.run('meal.snapshot', { month: '2026-11', weekId: '2026-11-02' }, login.sessionToken), 'invalid_action', 400);
  await rejects(f.service.authorizeMiniSession('school-A'), 'unauthenticated', 401);
  let readPaths = [];
  await f.store.runTransaction(async tx => {
    await context.assertCurrent(async key => { readPaths.push(key); return tx.get(key); });
    tx.set('TEST_ONLY_meal_write', { uid: context.uid });
  });
  assert.deepEqual(readPaths.sort(), [`zalo_link_owners/${APP}_staff_A`, `zalo_link_sessions/${sha(login.sessionToken)}`,
    `zalo_links/${APP}_${ZALO_A}`, zaloRevocationPath(APP, MINI, ZALO_A)].sort());
  assert.deepEqual(await f.store.get('TEST_ONLY_meal_write'), { uid: 'staff_A' });
});

test('revocation between meal authorization and its transaction prevents every business write, including after re-link', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const context = await f.service.authorizeMiniSession(login.sessionToken);
  await f.run('web.revokeLink');
  const attempt = () => f.store.runTransaction(async tx => {
    await context.assertCurrent(key => tx.get(key));
    tx.set('TEST_ONLY_FORBIDDEN_meal_write', { written: true });
  });
  await rejects(attempt(), 'session_expired', 401);
  assert.equal(await f.store.get('TEST_ONLY_FORBIDDEN_meal_write'), null);
  await linked(f);
  await rejects(attempt(), 'session_expired', 401);
  assert.equal(await f.store.get('TEST_ONLY_FORBIDDEN_meal_write'), null);
});

test('meal transaction guard rechecks expiry and logout using the server clock', async () => {
  for (const cause of ['expiry', 'logout']) {
    const f = fixture(); await linked(f);
    const login = await f.run('mini.login', {}, 'zalo-A');
    const context = await f.service.authorizeMiniSession(login.sessionToken);
    if (cause === 'expiry') f.state.now = login.expiresAt;
    else await f.run('mini.logout', {}, login.sessionToken);
    await rejects(f.store.runTransaction(async tx => {
      await context.assertCurrent(key => tx.get(key));
      tx.set('TEST_ONLY_FORBIDDEN_meal_write', {});
    }), 'session_expired', 401);
    assert.equal(await f.store.get('TEST_ONLY_FORBIDDEN_meal_write'), null);
  }
});

test('a Firestore-style business transaction retry reruns the session guard before committing after revocation', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  const context = await f.service.authorizeMiniSession(login.sessionToken);
  let attempts = 0, proposed = 0, committed = 0;
  const retryingBusinessTransaction = async callback => {
    for (let attempt = 0; attempt < 2; attempt++) {
      attempts++;
      const staged = [];
      await callback({ get: key => f.store.get(key), set: (key, value) => { proposed++; staged.push([key, value]); } });
      if (attempt === 0) {
        // The link read by the first attempt changes before commit. Firestore
        // retries its callback and discards that attempt's queued writes.
        await f.run('web.revokeLink');
        continue;
      }
      for (const [key, value] of staged) { committed++; f.store.docs.set(key, copy(value)); }
    }
  };
  await rejects(retryingBusinessTransaction(async tx => {
    await context.assertCurrent(key => tx.get(key));
    tx.set('TEST_ONLY_FORBIDDEN_retry_write', { uid: context.uid });
  }), 'session_expired', 401);
  assert.equal(attempts, 2);
  assert.equal(proposed, 1);
  assert.equal(committed, 0);
  assert.equal(await f.store.get('TEST_ONLY_FORBIDDEN_retry_write'), null);
});

test('internal meal authorizer validates current school account and sanitizes storage failures', async () => {
  const f = fixture(); await linked(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  f.state.disabled.add('staff_A');
  await rejects(f.service.authorizeMiniSession(login.sessionToken), 'account_unavailable', 403);
  f.state.disabled.clear();
  f.store.get = async () => { throw new Error(PRIVATE); };
  await rejects(f.service.authorizeMiniSession(login.sessionToken), 'service_unavailable', 503);
});

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
  assert.ok(f.store.operations.every(([, path]) => /^zalo_(link_challenges|link_claims|link_sessions|links|link_owners|link_rate_limits|link_revocations)\//.test(path)));
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

test('email OTP errors carry the fixed Vietnamese messages and HTTP statuses of the contract', () => {
  for (const [code, status, message] of [
    ['otp_invalid', 422, 'Mã xác minh chưa đúng. Thầy/Cô kiểm tra lại mã trong thư.'],
    ['otp_expired', 410, 'Mã xác minh đã hết hạn hoặc nhập sai quá nhiều lần. Vui lòng gửi mã mới.'],
    ['account_not_found', 404, 'Chưa có tài khoản Suất ăn cho email này. Thầy/Cô đăng nhập website suất ăn của trường một lần bằng tài khoản Microsoft, rồi thử lại.'],
    ['email_link_unavailable', 503, 'Liên kết bằng email chưa được bật trên máy chủ. Vui lòng liên hệ bộ phận CNTT.'],
  ]) {
    const error = new AccountLinkError(undefined, code);
    assert.deepEqual([error.code, error.status, error.message], [code, status, message]);
  }
});

test('mini.requestOtp normalizes the school email, masks it, mails a 6-digit code and stores only its HMAC', async () => {
  const f = fixture(), at = f.state.now;
  const sent = await f.run('mini.requestOtp', { email: '  A ' }, 'zalo-A');
  assert.deepEqual(sent, { state: 'sent', emailMasked: 'a***@hoangmaistarschool.edu.vn', expiresAt: at + 10 * MINUTE,
    resendAt: at + MINUTE, replacesExisting: false });
  assert.deepEqual(f.state.lookups, ['a@hoangmaistarschool.edu.vn']);
  assert.equal(f.state.mail.length, 1);
  const [mail] = f.state.mail;
  assert.deepEqual(Object.keys(mail).sort(), ['code', 'expiresAt', 'kind', 'name', 'to']);
  assert.deepEqual({ ...mail, code: undefined }, { kind: 'otp', to: 'a@hoangmaistarschool.edu.vn', code: undefined,
    expiresAt: sent.expiresAt, name: 'Nhân viên A' });
  assert.match(mail.code, /^\d{6}$/);
  const otp = f.store.docs.get(otpPath(ZALO_A));
  assert.deepEqual(Object.keys(otp).sort(), ['appId', 'attempts', 'codeHash', 'createdAt', 'email', 'expiresAt', 'miniAppId',
    'otpId', 'sentAt', 'uid', 'zaloUserId']);
  assert.match(otp.otpId, /^[a-f0-9]{32}$/);
  assert.equal(otp.codeHash, hmac(`${otp.otpId}:${ZALO_A}:staff_A:${mail.code}`));
  assert.deepEqual({ ...otp, otpId: 0, codeHash: 0 }, { appId: APP, miniAppId: MINI, otpId: 0, zaloUserId: ZALO_A, uid: 'staff_A',
    email: 'a@hoangmaistarschool.edu.vn', codeHash: 0, createdAt: at, expiresAt: at + 10 * MINUTE, attempts: 0, sentAt: [at] });
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')), { appId: APP, miniAppId: MINI, uid: 'staff_A', sentAt: [at], failedAt: [] });
  assertNoRawCode(f, mail.code);
  // A full, mixed-case address works too; the mask keeps first and last letters.
  const full = await f.run('mini.requestOtp', { email: ' GiaoVien.C@HoangMaiStarSchool.edu.vn ' }, 'zalo-B');
  assert.equal(full.emailMasked, 'g***c@hoangmaistarschool.edu.vn');
  assert.equal(f.state.mail.at(-1).to, 'giaovien.c@hoangmaistarschool.edu.vn');
  f.state.now += MINUTE;
  assert.equal((await f.run('mini.requestOtp', { email: 'td' }, 'zalo-A')).emailMasked, 't***@hoangmaistarschool.edu.vn');
  // No private mail, Auth or store text leaves through a successful response either.
  assert.ok(!JSON.stringify([sent, full]).includes(PRIVATE));
  assert.ok(f.store.operations.every(([, key]) => /^zalo_(links|link_owners|link_otps|link_otp_limits|link_revocations)\//.test(key)));
});

test('an already linked Zalo user gets state linked without an account lookup, mail or OTP document', async () => {
  const f = fixture(); await linked(f);
  for (const email of ['a', 'b@hoangmaistarschool.edu.vn', 'khongtontai']) {
    assert.deepEqual(await f.run('mini.requestOtp', { email }, 'zalo-A'), { state: 'linked' });
  }
  assert.deepEqual(f.state.lookups, []);
  assert.deepEqual(f.state.mail, []);
  assert.equal(f.store.docs.has(otpPath(ZALO_A)), false);
  assert.equal((await f.run('mini.login', {}, 'zalo-A')).linked, true);
});

test('unknown, unavailable and failing school account lookups send nothing and expose no provider text', async () => {
  const f = fixture();
  await rejects(f.run('mini.requestOtp', { email: 'khongtontai' }, 'zalo-A'), 'account_not_found', 404);
  f.state.disabled.add('staff_A');
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'account_unavailable', 403);
  f.state.disabled.clear();
  for (const error of [new Error(PRIVATE), Object.assign(new Error(PRIVATE), { code: 'auth/internal-error' })]) {
    f.state.lookupError = error;
    await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'service_unavailable', 503);
  }
  f.state.lookupError = Object.assign(new Error(PRIVATE), { code: 'auth/user-not-found' });
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'account_not_found', 404);
  f.state.lookupError = null;
  // A lookup that answers for another mailbox or a forged uid cannot redirect the code.
  for (const answer of [{ uid: 'staff_B', email: 'b@hoangmaistarschool.edu.vn' }, { uid: '../staff_B', email: 'a@hoangmaistarschool.edu.vn' },
    { uid: 'staff_A', email: 'a@example.com' }, null]) {
    const service = createAccountLinkService({ ...f.options, findSchoolAccountByEmail: async () => answer });
    await rejects(service.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'account_unavailable', 403);
  }
  assert.deepEqual(f.state.mail, []);
  assert.equal([...f.store.docs.keys()].some(key => key.startsWith('zalo_link_otp')), false);
  assert.equal(f.store.operations.some(([, key]) => key.includes('..')), false);
});

test('OTP actions reject malformed emails, codes, extra fields and Zalo tokens before any lookup or mail', async () => {
  const f = fixture();
  for (const email of ['', '   ', 'a@gmail.com', 'a b', '.a', 'a@hoangmaistarschool.edu.vn.evil.com', 'a@@hoangmaistarschool.edu.vn',
    '@hoangmaistarschool.edu.vn', 'a'.repeat(65), 'a'.repeat(255), 5, null, ['a'], { toString: () => 'a' }]) {
    await rejects(f.run('mini.requestOtp', { email }, 'zalo-A'), 'invalid_request', 400);
  }
  await rejects(f.run('mini.requestOtp', {}, 'zalo-A'), 'invalid_request', 400);
  await rejects(f.run('mini.requestOtp', { email: 'a', uid: 'staff_B' }, 'zalo-A'), 'invalid_request', 400);
  await rejects(f.run('mini.verifyOtp', { code: '123456', uid: 'staff_B' }, 'zalo-A'), 'invalid_request', 400);
  for (const code of ['', '12345', '1234567', '12345a', ' 123456', '１２３４５６', 123456, null]) {
    await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_invalid', 422);
  }
  assert.equal(f.state.zaloCalls.length, 0);
  for (const [action, body] of [['mini.requestOtp', { email: 'a' }], ['mini.verifyOtp', { code: '123456' }]]) {
    await rejects(f.run(action, body, 'zalo-forged'), 'unauthenticated', 401);
    const restricted = createAccountLinkService({ ...f.options, verifyZaloToken: async () => { throw new ZaloIdentityError('ip_restricted'); } });
    await rejects(restricted.run(action, body, 'zalo-A'), 'service_unavailable', 503);
  }
  assert.deepEqual(f.state.lookups, []);
  assert.deepEqual(f.state.mail, []);
  assert.equal(f.store.docs.size, 0);
});

test('missing or invalid OTP dependencies disable only the OTP actions with email_link_unavailable', async () => {
  const f = fixture();
  const { findSchoolAccountByEmail, markEmailVerified, sendLinkEmail, otpSecret, ...legacy } = f.options;
  for (const options of [legacy, { ...f.options, findSchoolAccountByEmail: undefined }, { ...f.options, markEmailVerified: null },
    { ...f.options, sendLinkEmail: 'send' }, { ...f.options, otpSecret: undefined }, { ...f.options, otpSecret: 'x'.repeat(31) },
    { ...f.options, otpSecret: 42 }]) {
    const service = createAccountLinkService(options);
    await rejects(service.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'email_link_unavailable', 503);
    await rejects(service.run('mini.verifyOtp', { code: '123456' }, 'zalo-A'), 'email_link_unavailable', 503);
    assert.deepEqual(await service.run('mini.login', {}, 'zalo-A'), { linked: false });
  }
  assert.equal(f.state.zaloCalls.filter(token => token === 'zalo-A').length, 7, 'only mini.login reached Zalo');
  assert.deepEqual(f.state.lookups, []);
  assert.deepEqual(f.state.mail, []);
  // The website/QR flow keeps working on a server without mail configured.
  const service = createAccountLinkService(legacy);
  const challenge = await service.run('web.createChallenge', {}, 'school-A');
  await service.run('mini.claim', { code: challenge.code }, 'zalo-A');
  assert.equal((await service.run('web.confirmLink', { challengeId: challenge.challengeId }, 'school-A')).linked, true);
});

test('resend cooldown is 60 seconds per Zalo user and per school account, including concurrent taps', async () => {
  const f = fixture(), t0 = f.state.now;
  const sent = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  assert.deepEqual(await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), sent, 'a repeat gets the mailed code');
  await rejects(f.run('mini.requestOtp', { email: 'b' }, 'zalo-A'), 'rate_limited', 429); // Same Zalo user.
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-B'), 'rate_limited', 429); // Same mailbox.
  assert.equal((await f.run('mini.requestOtp', { email: 'b' }, 'zalo-B')).state, 'sent');
  f.state.now = t0 + MINUTE - 1;
  await rejects(f.run('mini.requestOtp', { email: 'b' }, 'zalo-A'), 'rate_limited', 429);
  assert.equal(f.state.mail.length, 2);
  f.state.now = t0 + MINUTE;
  const resent = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  assert.equal(resent.resendAt, f.state.now + MINUTE);
  assert.equal(f.state.mail.length, 3);
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)).sentAt, [t0, t0 + MINUTE]);
  // Only the newest code is active: the first mail's code no longer verifies.
  const [first, , latest] = f.state.mail.map(mail => mail.code);
  if (first !== latest) await rejects(f.run('mini.verifyOtp', { code: first }, 'zalo-A'), 'otp_invalid', 422);
  // Concurrent taps: one code and one mail; the other taps get that same code.
  const g = fixture();
  const results = await Promise.all([1, 2, 3].map(() => g.run('mini.requestOtp', { email: 'a' }, 'zalo-A')));
  assert.ok(results.every(result => result.state === 'sent' && result.expiresAt === results[0].expiresAt));
  assert.equal(g.state.mail.length, 1);
  const otp = g.store.docs.get(otpPath(ZALO_A));
  assert.equal(otp.codeHash, hmac(`${otp.otpId}:${ZALO_A}:staff_A:${g.state.mail[0].code}`));
});

test('repeating a request within its cooldown answers with the code already mailed, so a lost reply never strands it', async () => {
  const f = fixture(), t0 = f.state.now;
  const first = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const stored = copy(f.store.docs.get(otpPath(ZALO_A))), limit = copy(f.store.docs.get(limitPath('staff_A')));
  // The first reply timed out on the phone; the mail arrived. The teacher taps again.
  f.state.now = t0 + MINUTE - 1;
  assert.deepEqual(await f.run('mini.requestOtp', { email: ' A@HoangMaiStarSchool.edu.vn ' }, 'zalo-A'), first);
  assert.equal(f.state.mail.length, 1, 'no second mail');
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), stored, 'nothing written');
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')), limit);
  assert.equal((await f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A')).linked, true, 'the first code still verifies');
  // A code still usable after a wrong try is replayed; a used-up one is not, and
  // another Zalo user never gets this Zalo user's code.
  const g = fixture();
  const sent = await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), wrong = wrongCode(g.state.mail[0].code);
  await rejects(g.run('mini.verifyOtp', { code: wrong }, 'zalo-A'), 'otp_invalid', 422);
  assert.deepEqual(await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), sent);
  for (let attempt = 2; attempt <= 5; attempt++) await rejects(g.run('mini.verifyOtp', { code: wrong }, 'zalo-A'), 'otp_invalid', 422);
  await rejects(g.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'rate_limited', 429);
  await rejects(g.run('mini.requestOtp', { email: 'a' }, 'zalo-B'), 'rate_limited', 429);
  assert.equal(g.state.mail.length, 1);
  // After the cooldown the same request mails a fresh code.
  g.state.now += MINUTE;
  const fresh = await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  assert.equal(fresh.expiresAt, g.state.now + 10 * MINUTE);
  assert.equal(g.state.mail.length, 2);
});

test('a Zalo user in its cooldown or out of sends gets the same 429 for every address, before any account lookup', async () => {
  const f = fixture(), t0 = f.state.now;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const lookups = f.state.lookups.length;
  f.state.disabled.add('staff_B');
  // Unknown, disabled and ordinary addresses all answer alike: no account oracle.
  for (const email of ['khongtontai', 'b', 'giaovien.c']) await rejects(f.run('mini.requestOtp', { email }, 'zalo-A'), 'rate_limited', 429);
  assert.equal(f.state.lookups.length, lookups);
  f.state.disabled.clear();
  for (const [index, email] of ['giaovien.c', 'td', 'b', 'giaovien.c'].entries()) {
    f.state.now = t0 + (index + 1) * MINUTE;
    assert.equal((await f.run('mini.requestOtp', { email }, 'zalo-A')).state, 'sent');
  }
  const used = f.state.lookups.length;
  f.state.now = t0 + 10 * MINUTE; // Cooldown over, hourly sends used up.
  for (const email of ['khongtontai', 'a', 'td']) await rejects(f.run('mini.requestOtp', { email }, 'zalo-A'), 'rate_limited', 429);
  assert.equal(f.state.lookups.length, used);
  assert.equal(f.state.mail.length, 5);
  // A caller with sends left still gets the lookup answer.
  await rejects(f.run('mini.requestOtp', { email: 'khongtontai' }, 'zalo-B'), 'account_not_found', 404);
});

test('at most five codes per rolling hour per Zalo user', async () => {
  const f = fixture(), t0 = f.state.now;
  for (const [index, email] of ['a', 'b', 'giaovien.c', 'a', 'b'].entries()) {
    f.state.now = t0 + index * MINUTE;
    assert.equal((await f.run('mini.requestOtp', { email }, 'zalo-A')).state, 'sent');
  }
  f.state.now = t0 + 5 * MINUTE;
  await rejects(f.run('mini.requestOtp', { email: 'td' }, 'zalo-A'), 'rate_limited', 429);
  assert.equal((await f.run('mini.requestOtp', { email: 'td' }, 'zalo-B')).state, 'sent', 'the mailbox itself is not exhausted');
  f.state.now = t0 + HOUR - 1;
  await rejects(f.run('mini.requestOtp', { email: 'giaovien.c' }, 'zalo-A'), 'rate_limited', 429);
  f.state.now = t0 + HOUR;
  assert.equal((await f.run('mini.requestOtp', { email: 'giaovien.c' }, 'zalo-A')).state, 'sent');
  // A day of history is kept for the daily cap.
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)).sentAt, [0, 1, 2, 3, 4].map(index => t0 + index * MINUTE).concat(t0 + HOUR));
  assert.equal(f.state.mail.length, 7);
});

test('at most five codes per rolling hour per school account, whichever Zalo users ask', async () => {
  const f = fixture(), t0 = f.state.now;
  for (let index = 0; index < 5; index++) {
    f.state.now = t0 + index * MINUTE;
    assert.equal((await f.run('mini.requestOtp', { email: 'a' }, index % 2 ? 'zalo-B' : 'zalo-A')).state, 'sent');
  }
  f.state.now = t0 + 5 * MINUTE;
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-B'), 'rate_limited', 429);
  assert.equal((await f.run('mini.requestOtp', { email: 'b' }, 'zalo-B')).state, 'sent', 'zalo-B itself has sent only two codes');
  f.state.now = t0 + HOUR;
  assert.equal((await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A')).state, 'sent');
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')).sentAt, [0, 1, 2, 3, 4].map(index => t0 + index * MINUTE).concat(t0 + HOUR));
});

// Ten sends spread over two hours: every hourly window and cooldown holds.
const spread = index => Math.floor(index / 5) * HOUR + (index % 5) * MINUTE;

test('one Zalo user is cut off at ten codes a rolling day even when every hourly window is respected', async () => {
  const f = fixture(), t0 = f.state.now, emails = ['a', 'b', 'giaovien.c', 'td', 'a'];
  for (let index = 0; index < 10; index++) {
    f.state.now = t0 + spread(index);
    assert.equal((await f.run('mini.requestOtp', { email: emails[index % 5] }, 'zalo-A')).state, 'sent');
  }
  const lookups = f.state.lookups.length;
  for (const later of [3 * HOUR, DAY - 1]) {
    f.state.now = t0 + later;
    await rejects(f.run('mini.requestOtp', { email: 'b' }, 'zalo-A'), 'rate_limited', 429);
  }
  assert.equal(f.state.lookups.length, lookups, 'refused before any lookup');
  assert.equal((await f.run('mini.requestOtp', { email: 'b' }, 'zalo-B')).state, 'sent', 'the mailboxes are not capped');
  f.state.now = t0 + DAY; // The first send leaves the rolling day.
  assert.equal((await f.run('mini.requestOtp', { email: 'giaovien.c' }, 'zalo-A')).state, 'sent');
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)).sentAt, Array.from({ length: 9 }, (_, index) => t0 + spread(index + 1)).concat(t0 + DAY));
  assert.equal(f.state.mail.length, 12);
});

test('one school account gets at most ten codes a rolling day, whichever Zalo users ask, its owner included', async () => {
  const f = fixture(), t0 = f.state.now;
  f.zaloIds['zalo-C'] = '123456789000000003';
  for (let index = 0; index < 10; index++) {
    f.state.now = t0 + spread(index);
    assert.equal((await f.run('mini.requestOtp', { email: 'a' }, index % 2 ? 'zalo-B' : 'zalo-A')).state, 'sent');
  }
  // The owner's own Zalo is refused too: that owner links through the website.
  f.state.now = t0 + 3 * HOUR;
  for (const zalo of ['zalo-A', 'zalo-B', 'zalo-C']) await rejects(f.run('mini.requestOtp', { email: 'a' }, zalo), 'rate_limited', 429);
  assert.equal((await f.run('mini.requestOtp', { email: 'b' }, 'zalo-C')).state, 'sent', 'only that mailbox is capped');
  f.state.now = t0 + DAY;
  assert.equal((await f.run('mini.requestOtp', { email: 'a' }, 'zalo-C')).state, 'sent');
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')).sentAt, Array.from({ length: 9 }, (_, index) => t0 + spread(index + 1)).concat(t0 + DAY));
  assert.equal((await f.run('mini.verifyOtp', { code: f.state.mail.at(-1).code }, 'zalo-C')).profile.email, 'a@hoangmaistarschool.edu.vn');
});

test('wrong codes add up per school account across Zalo users: ten a rolling day, then every code is refused', async () => {
  const f = fixture(), t0 = f.state.now;
  f.zaloIds['zalo-C'] = '123456789000000003';
  const guess = async (zalo, times) => {
    const code = f.state.mail.at(-1).code;
    for (let attempt = 0; attempt < times; attempt++) await rejects(f.run('mini.verifyOtp', { code: wrongCode(code) }, zalo), 'otp_invalid', 422);
    return code;
  };
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  await guess('zalo-A', 5);
  f.state.now = t0 + MINUTE;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-B');
  const codeB = await guess('zalo-B', 4);
  f.state.now = t0 + 2 * MINUTE;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-C');
  const codeC = await guess('zalo-C', 1);
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')).failedAt, [...Array(5).fill(t0), ...Array(4).fill(t0 + MINUTE), t0 + 2 * MINUTE]);
  // Even the right codes are refused now, before comparing: no try is counted.
  await rejects(f.run('mini.verifyOtp', { code: codeB }, 'zalo-B'), 'otp_expired', 410);
  await rejects(f.run('mini.verifyOtp', { code: codeC }, 'zalo-C'), 'otp_expired', 410);
  assert.equal(f.store.docs.get(otpPath(ZALO_B)).attempts, 4);
  assert.equal(f.store.docs.get(limitPath('staff_A')).failedAt.length, 10);
  // No new code is mailed for that account to anyone; other accounts are unaffected.
  f.state.now = t0 + 10 * MINUTE;
  const mails = f.state.mail.length;
  for (const zalo of ['zalo-A', 'zalo-B', 'zalo-C']) await rejects(f.run('mini.requestOtp', { email: 'a' }, zalo), 'rate_limited', 429);
  assert.equal(f.state.mail.length, mails);
  assert.equal((await f.run('mini.requestOtp', { email: 'b' }, 'zalo-C')).state, 'sent');
  assert.deepEqual(f.state.verifiedCalls, []);
  assert.equal(f.store.docs.has(ownerPath('staff_A')), false);
  // A day after the first five wrong codes the account can be linked again.
  f.state.now = t0 + DAY;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  assert.equal((await f.run('mini.verifyOtp', { code: f.state.mail.at(-1).code }, 'zalo-A')).linked, true);
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')).failedAt, [...Array(4).fill(t0 + MINUTE), t0 + 2 * MINUTE]);
});

test('malformed OTP counters fail closed and malformed OTP documents never verify', async () => {
  const f = fixture();
  f.store.docs.set(otpPath(ZALO_A), { appId: APP, miniAppId: MINI, zaloUserId: ZALO_A, sentAt: 'reset' });
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'service_unavailable', 503);
  await rejects(f.run('mini.verifyOtp', { code: '123456' }, 'zalo-A'), 'otp_expired', 410);
  for (const forged of [{ sentAt: Array(11).fill(1) }, { sentAt: [], failedAt: 'reset' }, { sentAt: [], failedAt: Array(11).fill(1) }]) {
    f.store.docs.set(limitPath('staff_B'), { appId: APP, miniAppId: MINI, uid: 'staff_B', ...forged });
    await rejects(f.run('mini.requestOtp', { email: 'b' }, 'zalo-B'), 'service_unavailable', 503);
  }
  assert.deepEqual(f.state.mail, []);
  const g = fixture();
  await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = g.state.mail[0].code, stored = g.store.docs.get(otpPath(ZALO_A));
  for (const forged of [{ miniAppId: '1' }, { zaloUserId: ZALO_B }, { expiresAt: stored.expiresAt + HOUR }, { attempts: -1 },
    { attempts: 6 }, { codeHash: 'x' }, { verifiedAt: null }, { sentAt: null }]) {
    g.store.docs.set(otpPath(ZALO_A), { ...stored, ...forged });
    await rejects(g.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired', 410);
  }
  // The HMAC binds the request, Zalo user and uid: an edited document cannot move the code.
  for (const forged of [{ uid: 'staff_B', email: 'b@hoangmaistarschool.edu.vn' }, { otpId: 'e'.repeat(32) }]) {
    g.store.docs.set(otpPath(ZALO_A), { ...stored, ...forged });
    await rejects(g.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_invalid', 422);
  }
  // A malformed wrong-code counter is never reset by a verification either.
  g.store.docs.set(otpPath(ZALO_A), stored);
  g.store.docs.set(limitPath('staff_A'), { ...g.store.docs.get(limitPath('staff_A')), failedAt: [2, 1] });
  await rejects(g.run('mini.verifyOtp', { code }, 'zalo-A'), 'service_unavailable', 503);
  assert.equal(g.store.docs.get(otpPath(ZALO_A)).verifiedAt, undefined);
  assert.deepEqual(g.state.verifiedCalls, []);
});

test('a failed mail send retires that OTP, keeps every send counter and returns service_unavailable', async () => {
  const f = fixture(), t0 = f.state.now;
  f.state.mailFailures = 1;
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'service_unavailable', 503);
  const failedCode = f.state.mail[0].code;
  // Retired, not deleted: nothing left to verify, but this Zalo user's history stays.
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), retired([t0]));
  assert.deepEqual(f.store.docs.get(limitPath('staff_A')).sentAt, [t0], 'the provider may have delivered it');
  await rejects(f.run('mini.verifyOtp', { code: failedCode }, 'zalo-A'), 'otp_expired', 410);
  await rejects(f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'rate_limited', 429);
  // The per-Zalo cooldown survives the failure: a colleague's address waits too.
  await rejects(f.run('mini.requestOtp', { email: 'b' }, 'zalo-A'), 'rate_limited', 429);
  assert.equal(f.state.mail.length, 1);
  f.state.now = t0 + MINUTE;
  assert.equal((await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A')).state, 'sent');
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)).sentAt, [t0, t0 + MINUTE]);
  assert.equal((await f.run('mini.verifyOtp', { code: f.state.mail.at(-1).code }, 'zalo-A')).linked, true);
  // Failed sends count toward this Zalo user's hourly cap: a sixth send is refused.
  const e = fixture(), s0 = e.state.now;
  for (const [index, email] of ['a', 'b', 'giaovien.c', 'td', 'a'].entries()) {
    e.state.now = s0 + index * MINUTE;
    e.state.mailFailures = 1;
    await rejects(e.run('mini.requestOtp', { email }, 'zalo-A'), 'service_unavailable', 503);
  }
  e.state.now = s0 + 5 * MINUTE;
  await rejects(e.run('mini.requestOtp', { email: 'b' }, 'zalo-A'), 'rate_limited', 429);
  assert.equal(e.state.mail.length, 5);
  assert.deepEqual(e.store.docs.get(otpPath(ZALO_A)), retired([0, 1, 2, 3, 4].map(index => s0 + index * MINUTE)));
  // Cleanup never retires a newer request's code, and its own failure stays private.
  const g = fixture(), newer = 'f'.repeat(32);
  g.state.onMail = async () => {
    g.store.docs.set(otpPath(ZALO_A), { ...g.store.docs.get(otpPath(ZALO_A)), otpId: newer });
    throw new Error(PRIVATE);
  };
  await rejects(g.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'service_unavailable', 503);
  assert.equal(g.store.docs.get(otpPath(ZALO_A)).otpId, newer);
  assert.match(g.store.docs.get(otpPath(ZALO_A)).codeHash, /^[a-f0-9]{64}$/);
  const h = fixture();
  h.state.onMail = async () => { h.store.runTransaction = async () => { throw new Error(PRIVATE); }; throw new Error(PRIVATE); };
  await rejects(h.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'service_unavailable', 503);
});

test('wrong codes are counted in committed transactions; five wrong tries expire the code', async () => {
  const f = fixture();
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code, wrong = wrongCode(code);
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-B'), 'otp_expired', 410); // Another Zalo user has no active code.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await rejects(f.run('mini.verifyOtp', { code: wrong }, 'zalo-A'), 'otp_invalid', 422);
    assert.equal(f.store.docs.get(otpPath(ZALO_A)).attempts, attempt);
  }
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired', 410);
  assert.equal(f.store.docs.get(otpPath(ZALO_A)).attempts, 5);
  assert.equal(f.store.docs.get(limitPath('staff_A')).failedAt.length, 5, 'wrong codes also count for the account');
  assert.deepEqual(f.state.verifiedCalls, []);
  assert.equal([...f.store.docs.keys()].some(key => key.startsWith('zalo_link_owners/') || key.startsWith('zalo_links/')), false);
  // Parallel guessing cannot exceed the cap either.
  const g = fixture();
  await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const real = Number(g.state.mail[0].code);
  const guesses = Array.from({ length: 10 }, (_, index) => String((real + 1 + index) % 1_000_000).padStart(6, '0'));
  const results = await Promise.allSettled(guesses.map(guess => g.run('mini.verifyOtp', { code: guess }, 'zalo-A')));
  assert.equal(results.filter(result => result.reason?.code === 'otp_invalid').length, 5);
  assert.equal(results.filter(result => result.reason?.code === 'otp_expired').length, 5);
  assert.equal(g.store.docs.get(otpPath(ZALO_A)).attempts, 5);
});

test('a code expires after ten minutes and a fresh code works afterwards', async () => {
  const f = fixture(), sent = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code;
  f.state.now = sent.expiresAt;
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired', 410);
  assert.equal(f.store.docs.get(otpPath(ZALO_A)).attempts, 0, 'expiry is not a wrong try');
  const again = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  f.state.now = again.expiresAt - 1;
  assert.equal((await f.run('mini.verifyOtp', { code: f.state.mail.at(-1).code }, 'zalo-A')).linked, true);
});

test('a correct code links the pair, signs in like mini.login, retires the OTP and mails a linked notice', async () => {
  const f = fixture(), t0 = f.state.now, sent = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code;
  f.state.now += 30_000;
  const result = await f.run('mini.verifyOtp', { code }, 'zalo-A');
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'linked', 'profile', 'sessionToken']);
  assert.equal(result.linked, true);
  assert.match(result.sessionToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.expiresAt, f.state.now + 8 * HOUR);
  assert.deepEqual(result.profile, { fullName: 'Nhân viên A', employeeId: '100001', department: 'CNTT', email: 'a@hoangmaistarschool.edu.vn' });
  const owner = f.store.docs.get(ownerPath('staff_A'));
  assert.deepEqual(f.store.docs.get(linkPath(ZALO_A)), owner);
  assert.deepEqual({ ...owner, version: 0 }, { appId: APP, miniAppId: MINI, uid: 'staff_A', zaloUserId: ZALO_A, version: 0, linkedAt: f.state.now });
  assert.match(owner.version, /^[a-f0-9]{32}$/);
  assert.deepEqual(f.store.docs.get(`zalo_link_sessions/${sha(result.sessionToken)}`), { appId: APP, miniAppId: MINI, uid: 'staff_A',
    zaloUserId: ZALO_A, linkVersion: owner.version, createdAt: f.state.now, expiresAt: result.expiresAt });
  // Single use: no code is left, the send history stays for this Zalo user's limits.
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), retired([t0]));
  assert.deepEqual(f.state.verifiedCalls, ['staff_A']);
  assert.deepEqual(f.state.mail[1], { kind: 'linked', to: 'a@hoangmaistarschool.edu.vn', linkedAt: f.state.now, name: 'Nhân viên A' });
  assert.equal(sent.replacesExisting, false);
  assert.deepEqual(await f.run('mini.me', {}, result.sessionToken), { profile: result.profile });
  assert.equal((await f.run('mini.login', {}, 'zalo-A')).linked, true);
  assert.deepEqual(await f.run('web.getLink'), { linked: true, zaloUserIdSuffix: ZALO_A.slice(-4), linkedAt: f.state.now });
  assert.deepEqual(await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), { state: 'linked' });
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired', 410);
  assertNoRawCode(f, code);
  assert.ok(f.store.operations.every(([, key]) => /^zalo_(link_sessions|links|link_owners|link_otps|link_otp_limits|link_rate_limits|link_revocations)\//.test(key)));
  // The website can revoke an email-made link like any other.
  await f.run('web.revokeLink');
  await rejects(f.run('mini.me', {}, result.sessionToken), 'session_expired', 401);
});

test('a lost linked notice never fails a committed link', async () => {
  const f = fixture();
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  f.state.mailFailures = 1;
  const result = await f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A');
  assert.equal(result.linked, true);
  assert.equal(f.state.mail.at(-1).kind, 'linked');
  assert.ok((await f.run('mini.me', {}, result.sessionToken)).profile);
});

test('a hanging linked notice holds the committed reply for two seconds at most', async t => {
  const f = fixture(), t0 = f.state.now;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  let release;
  // Graph stalls on the notice only; the code mail already went out.
  f.state.onMail = message => message.kind === 'linked' ? new Promise(resolve => { release = resolve; }) : undefined;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let settled = false;
  const pending = f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A').finally(() => { settled = true; });
  const turns = async count => { for (let turn = 0; turn < count; turn++) await new Promise(resolve => setImmediate(resolve)); };
  for (let turn = 0; turn < 100 && f.state.mail.length < 2; turn++) await turns(1);
  assert.equal(f.state.mail.at(-1).kind, 'linked');
  t.mock.timers.tick(1_999);
  await turns(5);
  assert.equal(settled, false, 'a quick notice is still awaited');
  t.mock.timers.tick(1);
  await turns(5);
  assert.equal(settled, true, 'a slow notice must not hold the reply past the client deadline');
  const result = await pending;
  assert.equal(result.linked, true);
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), retired([t0]));
  assert.ok((await f.run('mini.me', {}, result.sessionToken)).profile);
  release();
});

test('verifying moves an existing school link to the new Zalo user and kills the old Zalo user’s sessions', async () => {
  const f = fixture(); await linked(f, 'school-A', 'zalo-B');
  const old = await f.run('mini.login', {}, 'zalo-B');
  const oldVersion = f.store.docs.get(ownerPath('staff_A')).version;
  const sent = await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  assert.equal(sent.replacesExisting, true);
  assert.ok((await f.run('mini.me', {}, old.sessionToken)).profile, 'nothing changes before the code is verified');
  const result = await f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A');
  const owner = f.store.docs.get(ownerPath('staff_A'));
  assert.equal(owner.zaloUserId, ZALO_A);
  assert.notEqual(owner.version, oldVersion);
  assert.deepEqual(f.store.docs.get(linkPath(ZALO_A)), owner);
  assert.equal(f.store.docs.has(linkPath(ZALO_B)), false);
  await rejects(f.run('mini.me', {}, old.sessionToken), 'session_expired', 401);
  assert.deepEqual(await f.run('mini.login', {}, 'zalo-B'), { linked: false });
  assert.ok((await f.run('mini.me', {}, result.sessionToken)).profile);
  assert.equal(f.state.mail.at(-1).kind, 'linked');
  // A stale one-sided mirror of the old Zalo user that points elsewhere is left alone.
  const g = fixture(); await linked(g, 'school-A', 'zalo-B');
  g.store.docs.set(linkPath(ZALO_B), { ...g.store.docs.get(linkPath(ZALO_B)), uid: 'staff_B' });
  await otpLinked(g);
  assert.equal(g.store.docs.get(linkPath(ZALO_B)).uid, 'staff_B');
});

test('a Zalo user linked to another school account gets link_conflict, before mailing or at verification', async () => {
  const f = fixture();
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code;
  await linked(f, 'school-B', 'zalo-A'); // Linked through the website meanwhile.
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'link_conflict', 409);
  assert.equal(f.store.docs.has(ownerPath('staff_A')), false);
  assert.equal(f.store.docs.get(linkPath(ZALO_A)).uid, 'staff_B');
  assert.equal(f.state.mail.length, 1, 'no linked notice');
  // A one-sided link to another uid blocks the request without mailing a useless code.
  const g = fixture(); await linked(g, 'school-B', 'zalo-A');
  g.store.docs.delete(ownerPath('staff_B'));
  await rejects(g.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'link_conflict', 409);
  // A malformed owner mirror of the requested account is never overwritten.
  const h = fixture();
  h.store.docs.set(ownerPath('staff_A'), { appId: APP, miniAppId: '1', uid: 'staff_A', zaloUserId: ZALO_B, version: 'a'.repeat(32), linkedAt: 1 });
  await rejects(h.run('mini.requestOtp', { email: 'a' }, 'zalo-A'), 'link_conflict', 409);
  assert.deepEqual([...g.state.mail, ...h.state.mail], []);
  assert.equal(g.store.docs.has(otpPath(ZALO_A)) || h.store.docs.has(otpPath(ZALO_A)), false);
});

test('a markEmailVerified failure keeps the verified code so retrying the same code succeeds', async () => {
  const f = fixture(), t0 = f.state.now;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code;
  f.state.markFailures = 1;
  await rejects(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'service_unavailable', 503);
  const otp = f.store.docs.get(otpPath(ZALO_A));
  assert.equal(otp.verifiedAt, t0);
  assert.equal(otp.attempts, 0);
  assert.equal(f.store.docs.has(ownerPath('staff_A')), false);
  f.state.now += 5_000;
  const result = await f.run('mini.verifyOtp', { code }, 'zalo-A');
  assert.equal(result.linked, true);
  assert.deepEqual(f.state.verifiedCalls, ['staff_A', 'staff_A']);
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), retired([t0]));
  // A new request replaces a verified-but-unfinished code.
  const g = fixture();
  await g.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  g.state.markFailures = 1;
  const stale = g.state.mail[0].code;
  await rejects(g.run('mini.verifyOtp', { code: stale }, 'zalo-A'), 'service_unavailable', 503);
  g.state.now += MINUTE;
  await g.run('mini.requestOtp', { email: 'b' }, 'zalo-A');
  const fresh = g.state.mail.at(-1).code;
  assert.equal(g.store.docs.get(otpPath(ZALO_A)).verifiedAt, undefined);
  if (stale !== fresh) await rejects(g.run('mini.verifyOtp', { code: stale }, 'zalo-A'), 'otp_invalid', 422);
  assert.equal((await g.run('mini.verifyOtp', { code: fresh }, 'zalo-A')).profile.email, 'b@hoangmaistarschool.edu.vn');
});

test('an address moved to another account since the request does not verify either account', async () => {
  const f = fixture();
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  f.profiles.staff_A.email = 'moi@hoangmaistarschool.edu.vn';
  f.profiles.staff_B.email = 'a@hoangmaistarschool.edu.vn';
  await rejects(f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A'), 'account_unavailable', 403);
  assert.deepEqual(f.state.verifiedCalls, []);
  assert.equal([...f.store.docs.keys()].some(key => key.startsWith('zalo_link_owners/')), false);
});

test('verifying onto an intact pair keeps its version and sessions and sends no second notice', async () => {
  const f = fixture(), t0 = f.state.now;
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  await linked(f); // The same pair was confirmed on the website meanwhile.
  const web = await f.run('mini.login', {}, 'zalo-A'), version = f.store.docs.get(ownerPath('staff_A')).version;
  const result = await f.run('mini.verifyOtp', { code: f.state.mail[0].code }, 'zalo-A');
  assert.equal(result.linked, true);
  assert.equal(f.store.docs.get(ownerPath('staff_A')).version, version);
  assert.equal(f.store.docs.get(`zalo_link_sessions/${sha(result.sessionToken)}`).linkVersion, version);
  assert.ok((await f.run('mini.me', {}, web.sessionToken)).profile);
  assert.equal(f.state.mail.filter(mail => mail.kind === 'linked').length, 0);
  assert.deepEqual(f.store.docs.get(otpPath(ZALO_A)), retired([t0]));
});

test('parallel submissions of one correct code create exactly one link and one notice', async () => {
  const f = fixture();
  await f.run('mini.requestOtp', { email: 'a' }, 'zalo-A');
  const code = f.state.mail[0].code;
  const results = await Promise.allSettled([1, 2].map(() => f.run('mini.verifyOtp', { code }, 'zalo-A')));
  const won = results.filter(result => result.status === 'fulfilled');
  assert.equal(won.length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'otp_expired');
  assert.equal(f.state.mail.filter(mail => mail.kind === 'linked').length, 1);
  assert.ok((await f.run('mini.me', {}, won[0].value.sessionToken)).profile);
  assert.equal([...f.store.docs.keys()].filter(key => key.startsWith('zalo_links/')).length, 1);
});
