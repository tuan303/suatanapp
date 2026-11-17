// Offline provider events and school identities only. No live requests or data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAccountLinkService } from '../server/account-links.mjs';
import { createZaloWithdrawalService, ZaloWithdrawalError, zaloRevocationPath, keptZaloOtpSends } from '../server/zalo-withdrawal.mjs';

const APP = '928403133949225802', MINI = '3378419117469948059';
const ZALO = '111111111111111111', OTHER = '222222222222222222';
const KEY = 'TEST_ONLY_WEBHOOK_API_KEY';
const clone = value => value === undefined ? null : structuredClone(value);
const signature = body => createHash('sha256').update(Object.keys(body).sort().map(key => {
  const value = body[key];
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
}).join('') + KEY).digest('hex');

function fixture() {
  const state = { now: 1_793_851_800_000, cleanupFails: false, cleanupCalls: 0, mail: [], onVerify: null };
  const docs = new Map();
  let queue = Promise.resolve();
  const store = {
    async get(path) { return clone(docs.get(path)); },
    runTransaction(callback) {
      const execute = async () => {
        const writes = [];
        let wrote = false;
        const result = await callback({
          async get(path) {
            assert.equal(wrote, false, 'all transaction reads precede writes');
            return clone(docs.get(path));
          },
          set(path, value) { wrote = true; writes.push(['set', path, clone(value)]); },
          delete(path) { wrote = true; writes.push(['delete', path]); },
        });
        for (const [operation, path, value] of writes) {
          if (operation === 'set') docs.set(path, value); else docs.delete(path);
        }
        return clone(result);
      };
      const result = queue.then(execute, execute);
      queue = result.catch(() => {});
      return result;
    },
    async cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff, at }) {
      state.cleanupCalls++;
      if (state.cleanupFails) throw new Error('TEST_ONLY_PRIVATE_STORAGE_FAILURE');
      for (const [path, value] of docs) {
        if (/^zalo_link_(?:sessions|claims|challenges)\//.test(path) && value.appId === appId
          && value.miniAppId === miniAppId && value.zaloUserId === zaloUserId && value.createdAt <= cutoff) docs.delete(path);
      }
      // Same rule as the Firestore adapter: this Zalo user's e-mail code document
      // goes unless it was requested after the cutoff (a retired one has no createdAt);
      // its send times of the last day stay on the hashed marker.
      const otpPath = `zalo_link_otps/${appId}_${zaloUserId}`, otp = docs.get(otpPath);
      const markerPath = zaloRevocationPath(appId, miniAppId, zaloUserId), marker = docs.get(markerPath);
      if (otp?.appId === appId && otp.miniAppId === miniAppId && otp.zaloUserId === zaloUserId
        && (!Number.isSafeInteger(otp.createdAt) || otp.createdAt <= cutoff)) {
        if (marker?.appId === appId && marker.miniAppId === miniAppId && Number.isSafeInteger(marker.withdrawnAt)) {
          docs.set(markerPath, { ...marker, otpSentAt: keptZaloOtpSends([marker.otpSentAt, otp.sentAt], at) });
        }
        docs.delete(otpPath);
      }
    },
  };
  const links = createAccountLinkService({ appId: APP, miniAppId: MINI, store, now: () => state.now,
    async verifySchoolToken(token) {
      if (!['staff-A', 'staff-B'].includes(token)) throw new Error('TEST_ONLY_BAD_TOKEN');
      return { uid: token, email: `${token}@hoangmaistarschool.edu.vn` };
    },
    async verifyZaloToken(token) {
      if (!['zalo-A', 'zalo-B'].includes(token)) throw new Error('TEST_ONLY_BAD_TOKEN');
      return { zaloUserId: token === 'zalo-A' ? ZALO : OTHER };
    },
    async getSchoolProfile(uid) { return { fullName: uid, email: `${uid}@hoangmaistarschool.edu.vn` }; },
    // School-email code linking: the typed address decides the uid.
    async findSchoolAccountByEmail(email) {
      const uid = ['staff-A', 'staff-B'].find(id => `${id.toLowerCase()}@hoangmaistarschool.edu.vn` === email);
      if (!uid) throw Object.assign(new Error('TEST_ONLY_NOT_FOUND'), { code: 'account_not_found' });
      return { uid, email, name: uid };
    },
    async markEmailVerified() { if (state.onVerify) await state.onVerify(); },
    async sendLinkEmail(message) { state.mail.push(structuredClone(message)); },
    otpSecret: 'TEST_ONLY_OTP_HMAC_SECRET_0123456789abcdef',
  });
  const service = createZaloWithdrawalService({ appId: APP, miniAppId: MINI, apiKey: KEY, store, now: () => state.now });
  const run = (action, body = {}, token = 'staff-A') => links.run(action, body, token);
  const event = (values = {}) => ({ event: 'user.revoke.consent', appId: MINI, userId: ZALO, timestamp: state.now, ...values });
  return { state, docs, store, links, service, run, event,
    deliver: body => service.handle(body, signature(body)) };
}

async function link(f, staff = 'staff-A', zalo = 'zalo-A') {
  const challenge = await f.run('web.createChallenge', {}, staff);
  await f.run('mini.claim', { code: challenge.code }, zalo);
  await f.run('web.confirmLink', { challengeId: challenge.challengeId }, staff);
  return challenge;
}

async function fails(request, code) {
  await assert.rejects(request, error => error.code === code && !error.message.includes(KEY)
    && !error.message.includes('PRIVATE_STORAGE_FAILURE'));
}

test('signed withdrawal erases only the requested Zalo link data and invalidates a previously authorized write', async () => {
  const f = fixture();
  await link(f);
  await link(f, 'staff-B', 'zalo-B');
  const login = await f.run('mini.login', {}, 'zalo-A');
  const context = await f.links.authorizeMiniSession(login.sessionToken);
  f.docs.set('registrations/staff-A_2026-11', { userId: 'staff-A', breakfast: true });
  f.state.now++;
  assert.deepEqual(await f.deliver(f.event()), { received: true });
  assert.equal(await f.store.get(`zalo_links/${APP}_${ZALO}`), null);
  assert.equal(await f.store.get(`zalo_link_owners/${APP}_staff-A`), null);
  for (const [path, value] of f.docs) {
    if (/^zalo_link_(?:sessions|claims|challenges)\//.test(path)) assert.notEqual(value.zaloUserId, ZALO);
  }
  assert.ok(await f.store.get(`zalo_links/${APP}_${OTHER}`));
  assert.deepEqual(await f.store.get('registrations/staff-A_2026-11'), { userId: 'staff-A', breakfast: true });
  await fails(f.run('mini.me', {}, login.sessionToken), 'session_expired');
  await fails(f.store.runTransaction(async tx => {
    await context.assertCurrent(path => tx.get(path));
    tx.set('TEST_ONLY_FORBIDDEN', { written: true });
  }), 'session_expired');
  assert.equal(await f.store.get('TEST_ONLY_FORBIDDEN'), null);
});

test('invalid, missing and wrong-key signatures make no store changes', async () => {
  const f = fixture(); await link(f);
  const before = structuredClone(f.docs);
  for (const invalid of [undefined, '', 'x'.repeat(64), '0'.repeat(64)]) {
    await fails(f.service.handle(f.event(), invalid), 'invalid_signature');
  }
  assert.deepEqual(f.docs, before);
});

test('valid unrelated events are acknowledged while a signed wrong Mini App is rejected', async () => {
  const f = fixture();
  assert.deepEqual(await f.deliver({ event: 'versions.review.done', appId: MINI, status: 0 }), { received: true });
  await fails(f.deliver(f.event({ appId: '999999999999999999' })), 'wrong_app');
  assert.equal(f.docs.size, 0);
});

test('known event rejects extra fields, unsafe IDs and future or nonnumeric timestamps', async () => {
  const f = fixture();
  for (const values of [{ uid: 'staff-A' }, { userId: '../staff-A' }, { timestamp: '123' },
    { timestamp: f.state.now + 300_001 }, { timestamp: -1 }]) {
    await fails(f.deliver(f.event(values)), 'invalid_request');
  }
  assert.equal(f.docs.size, 0);
});

test('cleanup failure immediately revokes access and a duplicate delivery retries the cleanup', async () => {
  const f = fixture(); await link(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  f.state.now++;
  const body = f.event();
  f.state.cleanupFails = true;
  await fails(f.deliver(body), 'service_unavailable');
  await fails(f.run('mini.me', {}, login.sessionToken), 'session_expired');
  assert.equal((await f.store.get(zaloRevocationPath(APP, MINI, ZALO))).cleanupPending, true);
  f.state.cleanupFails = false;
  await f.deliver(body);
  assert.equal(f.state.cleanupCalls, 2);
  assert.equal((await f.store.get(zaloRevocationPath(APP, MINI, ZALO))).cleanupPending, false);
  await f.deliver(body);
  assert.equal(f.state.cleanupCalls, 2);
});

test('a delayed older event preserves the newly linked account and its new session', async () => {
  const f = fixture();
  const oldEvent = f.event();
  f.state.now += 100;
  await link(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  await f.deliver(oldEvent);
  assert.equal((await f.run('mini.me', {}, login.sessionToken)).profile.fullName, 'staff-A');
});

test('new post-withdrawal consent can link again and replay cannot unlink that new pair', async () => {
  const f = fixture(); await link(f);
  f.state.now++;
  const oldEvent = f.event();
  await f.deliver(oldEvent);
  f.state.now++;
  await link(f);
  const login = await f.run('mini.login', {}, 'zalo-A');
  await f.deliver(oldEvent);
  await f.service.handle(oldEvent, signature(oldEvent).toUpperCase());
  assert.equal((await f.run('mini.me', {}, login.sessionToken)).profile.fullName, 'staff-A');
});

test('an old pending challenge cannot re-establish a link after withdrawal even if cleanup temporarily fails', async () => {
  const f = fixture();
  const challenge = await f.run('web.createChallenge');
  await f.run('mini.claim', { code: challenge.code }, 'zalo-A');
  f.state.now++;
  f.state.cleanupFails = true;
  await fails(f.deliver(f.event()), 'service_unavailable');
  await fails(f.run('web.confirmLink', { challengeId: challenge.challengeId }), 'challenge_unavailable');
  assert.equal(await f.store.get(`zalo_links/${APP}_${ZALO}`), null);
});

test('a challenge created before withdrawal cannot claim later, while a new challenge can', async () => {
  const f = fixture();
  const challenge = await f.run('web.createChallenge');
  f.state.now++;
  await f.deliver(f.event());
  await fails(f.run('mini.claim', { code: challenge.code }, 'zalo-A'), 'challenge_unavailable');
  f.state.now++;
  await link(f);
  assert.ok(await f.store.get(`zalo_links/${APP}_${ZALO}`));
});

test('timestamp-less withdrawal fails closed before any identity or receipt changes', async () => {
  const f = fixture(); await link(f);
  f.state.now++;
  const body = { event: 'user.revoke.consent', appId: MINI, userId: ZALO };
  const before = structuredClone(f.docs);
  await fails(f.deliver(body), 'invalid_request');
  assert.deepEqual(f.docs, before);
  assert.equal(f.state.cleanupCalls, 0);
  assert.ok(await f.store.get(`zalo_links/${APP}_${ZALO}`));
});

test('marker and receipt retain no raw Zalo identity, school UID, email or token', async () => {
  const f = fixture(); await link(f); f.state.now++;
  await f.deliver(f.event());
  for (const [path, value] of f.docs) {
    if (!/^zalo_(?:link_revocations|webhook_events)\//.test(path)) continue;
    const serialized = JSON.stringify({ path, value });
    for (const sensitive of [ZALO, 'staff-A', '@hoangmaistarschool', KEY]) assert.equal(serialized.includes(sensitive), false);
  }
});

test('missing webhook key fails closed with a fixed error', () => {
  assert.throws(() => createZaloWithdrawalService({}), error => error instanceof ZaloWithdrawalError
    && error.status === 503 && error.code === 'not_configured');
});

// School-email code linking (zalo_link_otps / zalo_link_otp_limits) under a withdrawal.
const otpPath = zaloId => `zalo_link_otps/${APP}_${zaloId}`;
async function requestCode(f, email = 'staff-a', zalo = 'zalo-A') {
  const sent = await f.run('mini.requestOtp', { email }, zalo);
  assert.equal(sent.state, 'sent');
  return f.state.mail.at(-1).code;
}

test('a school-email code sent before withdrawal never links and cleanup leaves no address or Zalo ID', async () => {
  const f = fixture();
  const code = await requestCode(f);
  f.state.now++;
  const body = f.event();
  f.state.cleanupFails = true;
  await fails(f.deliver(body), 'service_unavailable');
  f.state.now++;
  // The marker alone refuses the code before comparing it: no attempt is spent
  // and the mailbox is never marked verified for a withdrawn Zalo user.
  let verified = 0;
  f.state.onVerify = () => { verified++; };
  await fails(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired');
  const pending = await f.store.get(otpPath(ZALO));
  assert.equal(pending.attempts, 0);
  assert.equal(pending.verifiedAt, undefined);
  assert.equal(verified, 0);
  f.state.onVerify = null;
  // A repeat inside the cooldown is not answered with the withdrawn code.
  await fails(f.run('mini.requestOtp', { email: 'staff-a' }, 'zalo-A'), 'rate_limited');
  assert.equal(f.state.mail.length, 1);
  assert.equal(await f.store.get(`zalo_links/${APP}_${ZALO}`), null);
  f.state.cleanupFails = false;
  await f.deliver(body);
  assert.equal(await f.store.get(otpPath(ZALO)), null);
  for (const [path, value] of f.docs) {
    const serialized = JSON.stringify({ path, value });
    for (const sensitive of [ZALO, '@hoangmaistarschool', code]) assert.equal(serialized.includes(sensitive), false, path);
  }
  // Per-account send and wrong-code counters hold no Zalo identity and keep limiting that mailbox.
  assert.deepEqual(Object.keys(await f.store.get(`zalo_link_otp_limits/${APP}_staff-A`)).sort(),
    ['appId', 'failedAt', 'miniAppId', 'sentAt', 'uid']);
});

test('a withdrawal between the code check and the link write still blocks the link', async () => {
  const f = fixture();
  const code = await requestCode(f);
  f.state.now++;
  f.state.onVerify = async () => {
    f.state.onVerify = null;
    f.state.cleanupFails = true; // Keep the code document so only the marker can refuse it.
    await fails(f.deliver(f.event()), 'service_unavailable');
  };
  await fails(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired');
  assert.equal(await f.store.get(`zalo_links/${APP}_${ZALO}`), null);
  assert.equal(await f.store.get(`zalo_link_owners/${APP}_staff-A`), null);
  assert.equal(f.state.mail.length, 1, 'no linked notice');
  await fails(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired');
});

test('a code requested after the withdrawal links, even when that withdrawal is delivered late', async () => {
  const f = fixture();
  const withdrawal = f.event();
  f.state.now += 100;
  const code = await requestCode(f);
  await f.deliver(withdrawal);
  assert.ok(await f.store.get(otpPath(ZALO)), 'a newer code is outside the event cutoff');
  const login = await f.run('mini.verifyOtp', { code }, 'zalo-A');
  assert.equal(login.linked, true);
  assert.equal((await f.run('mini.me', {}, login.sessionToken)).profile.fullName, 'staff-A');
});

test('withdrawing consent and granting it again does not restart the per-Zalo code limits', async () => {
  const f = fixture(), t0 = f.state.now;
  const colleagues = ['staff-a', 'staff-b', 'staff-a', 'staff-b', 'staff-a'];
  for (const [index, email] of colleagues.entries()) {
    f.state.now = t0 + index * 61_000;
    await requestCode(f, email);
  }
  f.state.now += 1;
  await f.deliver(f.event());
  // Cleanup deleted the code document (address, uid, code hash); the marker keeps only the times.
  assert.equal(await f.store.get(otpPath(ZALO)), null);
  const marker = await f.store.get(zaloRevocationPath(APP, MINI, ZALO));
  assert.deepEqual(marker.otpSentAt, colleagues.map((_, index) => t0 + index * 61_000));
  assert.equal(marker.cleanupPending, false);
  // Fresh consent: the hourly cap still holds, for the same and for another address.
  f.state.now += 61_000;
  for (const email of ['staff-b', 'staff-a', 'khongtontai']) await fails(f.run('mini.requestOtp', { email }, 'zalo-A'), 'rate_limited');
  assert.equal(f.state.mail.length, 5);
  // A second withdrawal with no code in between keeps the times on the marker.
  f.state.now += 1;
  await f.deliver(f.event());
  assert.deepEqual((await f.store.get(zaloRevocationPath(APP, MINI, ZALO))).otpSentAt, marker.otpSentAt);
  await fails(f.run('mini.requestOtp', { email: 'staff-b' }, 'zalo-A'), 'rate_limited');
  // A later withdrawal keeps those times, and a code sent after the hour is counted once.
  f.state.now = t0 + 60 * 60_000;
  const code = await requestCode(f, 'staff-b');
  assert.deepEqual((await f.store.get(otpPath(ZALO))).sentAt, [...marker.otpSentAt, f.state.now]);
  f.state.now += 1;
  await f.deliver(f.event());
  await fails(f.run('mini.verifyOtp', { code }, 'zalo-A'), 'otp_expired');
  assert.deepEqual((await f.store.get(zaloRevocationPath(APP, MINI, ZALO))).otpSentAt,
    [...marker.otpSentAt, t0 + 60 * 60_000]);
  // Six sends in the day: four more are allowed after the hour, the tenth is the last.
  for (let index = 1; index <= 4; index++) {
    f.state.now = t0 + 2 * 60 * 60_000 + index * 61_000;
    await requestCode(f, index % 2 ? 'staff-a' : 'staff-b');
  }
  f.state.now = t0 + 4 * 60 * 60_000;
  await fails(f.run('mini.requestOtp', { email: 'staff-a' }, 'zalo-A'), 'rate_limited');
  assert.equal(f.state.mail.length, 10);
  // Another Zalo user is not affected, and the day's limit lapses after a day.
  assert.equal((await f.run('mini.requestOtp', { email: 'staff-a' }, 'zalo-B')).state, 'sent');
  f.state.now = t0 + 24 * 60 * 60_000 + 61_000 * 4 + 1;
  await requestCode(f, 'staff-b');
});

test('the marker keeps only the code send times of the last day, at most ten', () => {
  const at = 1_793_851_800_000, day = 24 * 60 * 60_000;
  assert.deepEqual(keptZaloOtpSends([[at - day, at - day + 1, at - 5], [at - 5, at - 3, 'x', -1, 1.5, null]], at),
    [at - day + 1, at - 5, at - 3]);
  assert.deepEqual(keptZaloOtpSends([undefined, null, {}, 'sentAt'], at), []);
  const many = Array.from({ length: 14 }, (_, index) => at - 14 + index);
  assert.deepEqual(keptZaloOtpSends([many.slice(0, 7), many.slice(7)], at), many.slice(-10));
  assert.deepEqual(keptZaloOtpSends([[at - 1]], undefined), []);
});

test('no code is mailed while a withdrawal stamped ahead of the server clock still covers it', async () => {
  const f = fixture();
  await f.deliver(f.event({ timestamp: f.state.now + 60_000 }));
  await fails(f.run('mini.requestOtp', { email: 'staff-a' }, 'zalo-A'), 'service_unavailable');
  assert.equal(f.state.mail.length, 0);
  assert.equal(await f.store.get(otpPath(ZALO)), null);
  f.state.now += 60_001;
  const code = await requestCode(f);
  assert.equal((await f.run('mini.verifyOtp', { code }, 'zalo-A')).linked, true);
});
