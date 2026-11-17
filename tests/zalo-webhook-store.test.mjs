// Offline Firestore adapter checks. All identities and rows are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFirestoreWithdrawalStore } from '../api/_lib/zalo-webhook-runtime.mjs';
import { createAccountLinkService } from '../miniapp/server/account-links.mjs';
import { createZaloWithdrawalService, zaloRevocationPath } from '../miniapp/server/zalo-withdrawal.mjs';

const appId = '928403133949225802', miniAppId = '3378419117469948059';
const zaloUserId = '123456789', cutoff = 1000;
const record = (extra = {}) => ({ appId, miniAppId, zaloUserId, createdAt: 900, ...extra });

class FakeFirestore {
  // `writable` is for the services' own transactions; cleanup alone may only
  // delete, apart from keeping code send times on the hashed withdrawal marker.
  constructor(records, { writable = false } = {}) { this.rows = new Map(Object.entries(records)); this.pages = 0; this.writable = writable; }
  doc(path) { return { path, get: async () => this.snapshot(path) }; }
  snapshot(path) {
    return { id: path.split('/').at(-1), ref: this.doc(path), exists: this.rows.has(path),
      data: () => structuredClone(this.rows.get(path)) };
  }
  collection(name) {
    const db = this;
    const state = { field: null, value: null, count: 0, after: null };
    const query = {
      where(field, operator, value) { assert.equal(operator, '=='); state.field = field; state.value = value; return query; },
      orderBy() { return query; },
      limit(count) { state.count = count; return query; },
      startAfter(cursor) { state.after = cursor; return query; },
      doc: id => db.doc(`${name}/${id}`),
      async get() {
        db.pages++;
        const docs = [...db.rows].filter(([path, value]) => path.startsWith(`${name}/`)
          && value[state.field] === state.value && (!state.after || path.split('/')[1] > state.after))
          .sort(([a], [b]) => a.localeCompare(b)).slice(0, state.count).map(([path]) => db.snapshot(path));
        return { docs, size: docs.length, empty: docs.length === 0 };
      },
    };
    return query;
  }
  async runTransaction(callback) {
    const pending = [];
    let wrote = false;
    const result = await callback({
      get: async ref => { assert.equal(wrote, false); return this.snapshot(ref.path); },
      getAll: async (...refs) => { assert.equal(wrote, false); return refs.map(ref => this.snapshot(ref.path)); },
      delete: ref => { wrote = true; pending.push([ref.path]); },
      set: (ref, value) => {
        if (!this.writable && !ref.path.startsWith('zalo_link_revocations/')) throw new Error('Cleanup must only delete selected documents');
        wrote = true; pending.push([ref.path, structuredClone(value)]);
      },
    });
    pending.forEach(([path, value]) => { if (value === undefined) this.rows.delete(path); else this.rows.set(path, value); });
    return result;
  }
}

test('cleanup deletes old temporary Zalo rows and post-event sessions while preserving school and other user records', async () => {
  const db = new FakeFirestore({
    'zalo_link_sessions/old': record(),
    'zalo_link_sessions/after_event': record({ createdAt: 1100, linkVersion: 'revoked' }),
    'zalo_link_sessions/other_user': record({ zaloUserId: '987654321' }),
    'zalo_link_sessions/other_app': record({ appId: '999999' }),
    'zalo_link_claims/old': record(),
    'zalo_link_challenges/old': record(),
    'zalo_link_challenges/new': record({ createdAt: 1100 }),
    'registrations/school_record': record(),
  });
  const store = createFirestoreWithdrawalStore(db);
  await store.cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
  assert.deepEqual([...db.rows.keys()].sort(), [
    'registrations/school_record', 'zalo_link_challenges/new',
    'zalo_link_sessions/other_app', 'zalo_link_sessions/other_user',
  ]);
  await store.cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
  assert.equal(db.rows.size, 4);
});

test('cleanup preserves only a newer link version during a delayed or repeated withdrawal', async () => {
  const db = new FakeFirestore({
    [`zalo_links/${appId}_${zaloUserId}`]: record({ linkedAt: 1100, version: 'fresh' }),
    'zalo_link_sessions/fresh': record({ createdAt: 1200, linkVersion: 'fresh' }),
    'zalo_link_sessions/revoked': record({ createdAt: 1200, linkVersion: 'revoked' }),
    'zalo_link_sessions/old': record({ createdAt: 900, linkVersion: 'fresh' }),
  });
  await createFirestoreWithdrawalStore(db).cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
  assert.equal(db.rows.size, 2);
  assert.ok(db.rows.has('zalo_link_sessions/fresh'));
});

test('cleanup pages past records outside the scope and handles more than a single batch', async () => {
  const records = Object.fromEntries(Array.from({ length: 225 }, (_, index) => [
    `zalo_link_claims/row_${String(index).padStart(3, '0')}`, record({ miniAppId: index < 110 ? '88888' : miniAppId }),
  ]));
  const db = new FakeFirestore(records);
  await createFirestoreWithdrawalStore(db).cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
  assert.equal(db.rows.size, 110);
  assert.ok(db.pages >= 5);
});

test('cleanup removes a late claim for an old challenge and preserves a post-withdrawal reconsent claim', async () => {
  const oldId = 'a'.repeat(64), newId = 'b'.repeat(64);
  const db = new FakeFirestore({
    [`zalo_link_challenges/${oldId}`]: record(),
    [`zalo_link_challenges/${newId}`]: record({ createdAt: 1100 }),
    'zalo_link_claims/late_old': record({ createdAt: 1200, challengeId: oldId }),
    'zalo_link_claims/new': record({ createdAt: 1200, challengeId: newId }),
    'zalo_link_claims/orphan': record({ createdAt: 1200, challengeId: 'c'.repeat(64) }),
  });
  await createFirestoreWithdrawalStore(db).cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
  assert.deepEqual([...db.rows.keys()].sort(), [
    `zalo_link_challenges/${newId}`, 'zalo_link_claims/new',
  ]);
});

test('cleanup deletes this Zalo user e-mail code document, with its address and uid, unless requested after the cutoff', async () => {
  const otpPath = `zalo_link_otps/${appId}_${zaloUserId}`;
  const otp = (extra = {}) => record({ otpId: 'a'.repeat(32), uid: 'staff_A', email: 'a@hoangmaistarschool.edu.vn',
    codeHash: 'f'.repeat(64), expiresAt: 900 + 600_000, attempts: 0, sentAt: [900], ...extra });
  // Retired after use or a failed send: no createdAt, only this Zalo user's send history.
  const retired = { appId, miniAppId, zaloUserId, sentAt: [900, 1100] };
  for (const [stored, kept] of [[otp(), false], [otp({ createdAt: cutoff, sentAt: [cutoff] }), false],
    [otp({ verifiedAt: 950 }), false], [retired, false],
    [otp({ createdAt: 1100, sentAt: [1100] }), true], [otp({ miniAppId: '88888' }), true]]) {
    const db = new FakeFirestore({
      [otpPath]: stored,
      [`zalo_link_otps/${appId}_987654321`]: otp({ zaloUserId: '987654321' }),
      [`zalo_link_otp_limits/${appId}_staff_A`]: { appId, miniAppId, uid: 'staff_A', sentAt: [900], failedAt: [] },
    });
    await createFirestoreWithdrawalStore(db).cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff });
    assert.equal(db.rows.has(otpPath), kept, JSON.stringify(stored));
    assert.ok(db.rows.has(`zalo_link_otps/${appId}_987654321`), 'another Zalo user keeps its code');
    assert.ok(db.rows.has(`zalo_link_otp_limits/${appId}_staff_A`), 'per-account counters hold no Zalo ID and stay');
  }
});

const DAY = 24 * 60 * 60_000;
const markerPath = zaloRevocationPath(appId, miniAppId, zaloUserId);
const marker = (extra = {}) => ({ appId, miniAppId, withdrawnAt: cutoff, receivedAt: cutoff, cleanupPending: true, ...extra });

test('cleanup moves the deleted code document send times of the last day onto the hashed marker only', async () => {
  const otpPath = `zalo_link_otps/${appId}_${zaloUserId}`;
  const otp = { ...record({ otpId: 'a'.repeat(32), uid: 'staff_A', email: 'a@hoangmaistarschool.edu.vn',
    codeHash: 'f'.repeat(64), expiresAt: 900 + 600_000, attempts: 0 }), sentAt: [500, 900] };
  const db = new FakeFirestore({ [otpPath]: otp, [markerPath]: marker({ otpSentAt: [100, 500] }) });
  const store = createFirestoreWithdrawalStore(db);
  await store.cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff, at: 100 + DAY });
  assert.equal(db.rows.has(otpPath), false);
  // 100 is a day old; 500 is kept once.
  assert.deepEqual(db.rows.get(markerPath), marker({ otpSentAt: [500, 900] }));
  const kept = JSON.stringify([...db.rows]);
  for (const sensitive of [zaloUserId, 'staff_A', '@hoangmaistarschool', 'f'.repeat(64), 'a'.repeat(32)]) assert.equal(kept.includes(sensitive), false);
  await store.cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff, at: 100 + DAY });
  assert.deepEqual(db.rows.get(markerPath), marker({ otpSentAt: [500, 900] }));
  // A code requested after the cutoff stays and the marker is left as it is;
  // a marker of another Mini App is never written, but the code still goes.
  for (const [stored, current, otpKept] of [[{ ...otp, createdAt: 1100, sentAt: [1100] }, marker(), true],
    [otp, marker({ miniAppId: '88888' }), false]]) {
    const other = new FakeFirestore({ [otpPath]: stored, [markerPath]: current });
    await createFirestoreWithdrawalStore(other).cleanupZaloData({ appId, miniAppId, zaloUserId, cutoff, at: 2000 });
    assert.equal(other.rows.has(otpPath), otpKept);
    assert.deepEqual(other.rows.get(markerPath), current);
  }
});

test('through the Firestore adapter, withdrawing consent and granting it again keeps the per-Zalo code limits', async () => {
  const key = 'TEST_ONLY_WEBHOOK_API_KEY', mail = [];
  let now = 1_793_851_800_000;
  const db = new FakeFirestore({}, { writable: true });
  const store = createFirestoreWithdrawalStore(db);
  const people = ['staff_a', 'staff_b', 'staff_c', 'staff_d', 'staff_e', 'staff_f'];
  const links = createAccountLinkService({ appId, miniAppId, store, now: () => now,
    verifySchoolToken: async () => { throw new Error('TEST_ONLY_UNUSED'); },
    verifyZaloToken: async token => { assert.equal(token, 'TEST_ONLY_ZALO_TOKEN'); return { zaloUserId }; },
    getSchoolProfile: async uid => ({ fullName: uid, email: `${uid}@hoangmaistarschool.edu.vn` }),
    findSchoolAccountByEmail: async email => {
      const uid = people.find(id => `${id}@hoangmaistarschool.edu.vn` === email);
      if (!uid) throw Object.assign(new Error('TEST_ONLY_NOT_FOUND'), { code: 'account_not_found' });
      return { uid, email, name: uid };
    },
    markEmailVerified: async () => {}, sendLinkEmail: async message => { mail.push(message.to); },
    otpSecret: 'TEST_ONLY_OTP_HMAC_SECRET_0123456789abcdef' });
  const withdrawal = createZaloWithdrawalService({ appId, miniAppId, apiKey: key, store, now: () => now });
  const send = email => links.run('mini.requestOtp', { email }, 'TEST_ONLY_ZALO_TOKEN').then(result => result.state, error => error.code);
  const withdraw = () => {
    const body = { event: 'user.revoke.consent', appId: miniAppId, userId: zaloUserId, timestamp: now };
    const content = Object.keys(body).sort().map(name => String(body[name])).join('');
    return withdrawal.handle(body, createHash('sha256').update(content).update(key).digest('hex'));
  };
  for (const email of people.slice(0, 5)) { assert.equal(await send(email), 'sent'); now += 61_000; }
  assert.equal(await send('staff_f'), 'rate_limited');
  assert.deepEqual(await withdraw(), { received: true });
  assert.equal(db.rows.has(`zalo_link_otps/${appId}_${zaloUserId}`), false, 'no address, uid or code hash is kept');
  now += 61_000;
  assert.equal(await send('staff_f'), 'rate_limited');
  assert.equal(await send('khongtontai'), 'rate_limited', 'answered before any account lookup');
  now += 1;
  assert.deepEqual(await withdraw(), { received: true });
  now += 61_000;
  assert.equal(await send('staff_f'), 'rate_limited');
  assert.deepEqual(mail, people.slice(0, 5).map(id => `${id}@hoangmaistarschool.edu.vn`));
  assert.equal(db.rows.get(markerPath).otpSentAt.length, 5);
});
