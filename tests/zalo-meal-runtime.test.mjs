// Offline only. Fake Firestore/Auth/session context; no SDK credentials or I/O.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreMealStore, createZaloBusinessDispatcher } from '../api/_lib/zalo-runtime.mjs';
import { AccountLinkError } from '../miniapp/server/account-links.mjs';
import { createEmptyMenu } from '../agent/lib/weekly-menu.mjs';

const UID = 'staff_A', OTHER = 'staff_B', MONTH = '2026-11', WEEK = '2026-11-02';
const AT = Date.parse('2026-11-03T08:30:00Z');
const PRIVATE = 'TEST_ONLY_OTHER_ACCOUNT_DATA_MUST_NOT_APPEAR';
const SESSION_PATH = 'zalo_link_sessions/test_session';
const clone = value => value === undefined ? null : structuredClone(value);
const profile = { fullName: 'Nhân viên mẫu', employeeId: '100001', department: 'CNTT', email: 'demo@hoangmaistarschool.edu.vn' };
const denied = promise => assert.rejects(promise, error => error instanceof AccountLinkError
  && error.code === 'service_unavailable' && error.status === 503);

class FakeFirestore {
  docs;
  native = [];
  constructor(initial = {}) { this.docs = new Map(Object.entries(initial).map(([path, data]) => [path, clone(data)])); }
  doc(path) { this.native.push(['doc', path]); return { kind: 'doc', path }; }
  collection(name) {
    this.native.push(['collection', name]);
    return { orderBy: (field, direction) => {
      this.native.push(['orderBy', name, field, direction]);
      return { limit: count => {
        this.native.push(['limit', name, count]);
        return { kind: 'query', name, field, direction, count };
      } };
    } };
  }
  async runTransaction(callback) {
    this.native.push(['runTransaction']);
    const pending = [], snapshot = new Map([...this.docs].map(([path, data]) => [path, clone(data)]));
    let wrote = false;
    const result = await callback({
      get: async reference => {
        assert.equal(wrote, false, 'all native transaction reads must precede writes');
        if (reference.kind === 'doc') {
          this.native.push(['get', reference.path]);
          return { exists: snapshot.has(reference.path), data: () => clone(snapshot.get(reference.path)) };
        }
        assert.equal(reference.kind, 'query');
        this.native.push(['queryGet', reference.name]);
        return { docs: [...snapshot].filter(([path]) => path.startsWith(`${reference.name}/`) && path.split('/').length === 2)
          .map(([path, data]) => ({ id: path.split('/')[1], stored: data }))
          .sort((a, b) => String(b.stored[reference.field] ?? '').localeCompare(String(a.stored[reference.field] ?? '')))
          .slice(0, reference.count).map(row => ({ id: row.id, data: () => clone(row.stored) })) };
      },
      set: (reference, data) => {
        wrote = true;
        this.native.push(['set', reference.path]);
        pending.push([reference.path, clone(data)]);
      },
    });
    for (const [path, data] of pending) this.docs.set(path, data);
    return result;
  }
}

test('business adapter reads only exact own-UID personal paths and named public configuration', async () => {
  const allowed = ['settings/monthlyConfig', 'settings/monthlyExpiry', 'settings/cancelConfig',
    'settings/checkinSync', 'settings/mealOffDays', 'settings/reconcileExcludes',
    `blocked_users/${MONTH}`, `weekly_menus/${WEEK}`, 'events/event_A', `meal_surveys/${WEEK}`,
    `registrations/${UID}_${MONTH}`, `cancel_registrations/${UID}_2026-11-04`,
    `event_registrations/${UID}_event_A`, `meal_taps/${UID}/months/${MONTH}`,
    `meal_surveys/${WEEK}/responses/${UID}`];
  const db = new FakeFirestore(Object.fromEntries(allowed.map(path => [path, { marker: path }])));
  const store = createFirestoreMealStore(db, UID);
  for (const path of allowed) assert.deepEqual(await store.runTransaction(tx => tx.get(path)), { marker: path });
  for (const path of ['staff/staff_A', 'staff/staff_B', 'checkins/2026-11-03', 'settings/admins', 'admins/staff_A',
    `registrations/${OTHER}_${MONTH}`, `cancel_registrations/${OTHER}_2026-11-04`, `event_registrations/${OTHER}_event_A`,
    `meal_taps/${OTHER}/months/${MONTH}`, `meal_surveys/${WEEK}/responses/${OTHER}`,
    `registrations/${UID}_extra_${MONTH}`, `registrations/${UID}_2026-13`,
    `meal_taps/${UID}/months/${MONTH}/private/details`, 'events/../staff_A', 'weekly_menus/', '', null]) {
    const start = db.native.length;
    await denied(store.runTransaction(tx => tx.get(path)));
    assert.deepEqual(db.native.slice(start), [['runTransaction']], 'invalid paths must fail before db.doc/get');
  }
});

test('adapter permits only own registration/cancellation/event/survey writes with matching owner metadata', async () => {
  const db = new FakeFirestore(), store = createFirestoreMealStore(db, UID);
  const allowed = [[`registrations/${UID}_${MONTH}`, { userId: UID, month: MONTH }],
    [`cancel_registrations/${UID}_2026-11-04`, { userId: UID }],
    [`event_registrations/${UID}_event_A`, { userId: UID }],
    [`meal_surveys/${WEEK}/responses/${UID}`, { uid: UID }]];
  for (const [path, data] of allowed) {
    await store.runTransaction(tx => tx.set(path, data));
    assert.deepEqual(db.docs.get(path), data);
  }
  const attempts = [
    [`registrations/${OTHER}_${MONTH}`, { userId: UID }], [`registrations/${UID}_${MONTH}`, { userId: OTHER }],
    [`registrations/${UID}_${MONTH}`, { uid: UID }], [`cancel_registrations/${OTHER}_2026-11-04`, { userId: UID }],
    [`event_registrations/${OTHER}_event_A`, { userId: UID }], [`meal_surveys/${WEEK}/responses/${OTHER}`, { uid: UID }],
    [`meal_surveys/${WEEK}/responses/${UID}`, { uid: OTHER }], [`meal_surveys/${WEEK}/responses/${UID}`, { userId: UID }],
    [`meal_taps/${UID}/months/${MONTH}`, { userId: UID }], ['settings/monthlyConfig', { userId: UID }],
    [`blocked_users/${MONTH}`, { userId: UID }], [`weekly_menus/${WEEK}`, { userId: UID }],
    ['events/event_A', { userId: UID }], [`meal_surveys/${WEEK}`, { uid: UID }],
    [`registrations/${UID}_${MONTH}`, null], [`registrations/${UID}_${MONTH}`, {}],
  ];
  for (const [path, data] of attempts) {
    const start = db.native.length;
    await denied(store.runTransaction(tx => tx.set(path, data)));
    assert.deepEqual(db.native.slice(start), [['runTransaction']], 'path/owner checks precede native writes');
  }
});

test('private link/session guard documents can be read but never written by the business adapter', async () => {
  const paths = [SESSION_PATH, 'zalo_links/123_456', 'zalo_link_owners/123_staff_A',
    'zalo_link_challenges/test_challenge', 'zalo_link_claims/test_claim', 'zalo_link_rate_limits/123_staff_A'];
  const db = new FakeFirestore(Object.fromEntries(paths.map(path => [path, { active: true }])));
  const store = createFirestoreMealStore(db, UID);
  for (const path of paths) {
    assert.deepEqual(await store.runTransaction(tx => tx.get(path)), { active: true });
    const start = db.native.length;
    await denied(store.runTransaction(tx => tx.set(path, { userId: UID })));
    assert.deepEqual(db.native.slice(start), [['runTransaction']]);
  }
});

test('invalid UID is rejected before constructing any Firestore operation', () => {
  const db = new FakeFirestore();
  for (const uid of [null, undefined, 123, '', '../staff_A', '__reserved__', 'a/b', 'a'.repeat(129), 'staff A'])
    assert.throws(() => createFirestoreMealStore(db, uid), error => error instanceof AccountLinkError && error.code === 'service_unavailable');
  assert.deepEqual(db.native, []);
});

test('collection queries are bounded to public events and survey weeks and document IDs override stored metadata', async () => {
  const db = new FakeFirestore({ 'events/real_event': { id: 'FORGED_METADATA_ID', name: 'Sự kiện mẫu', createdAt: '2026-11-01' },
    [`meal_surveys/${WEEK}`]: { id: 'FORGED_METADATA_ID', weekId: WEEK } });
  const store = createFirestoreMealStore(db, UID);
  const events = await store.runTransaction(tx => tx.list('events', 20));
  const surveys = await store.runTransaction(tx => tx.list('meal_surveys', 12));
  assert.equal(events[0].id, 'real_event'); assert.equal(surveys[0].id, WEEK);
  assert.ok(db.native.some(call => JSON.stringify(call) === JSON.stringify(['orderBy', 'events', 'createdAt', 'desc'])));
  assert.ok(db.native.some(call => JSON.stringify(call) === JSON.stringify(['orderBy', 'meal_surveys', 'weekId', 'desc'])));
  for (const [name, count] of [['events', 21], ['meal_surveys', 13], ['staff', 1], ['checkins', 1], ['zalo_links', 1],
    ['events', 0], ['events', -1], ['events', 1.5], ['events', '1'], ['events', NaN], ['meal_surveys', Infinity]]) {
    const start = db.native.length;
    await denied(store.runTransaction(tx => tx.list(name, count)));
    assert.deepEqual(db.native.slice(start), [['runTransaction']]);
  }
});

function fakeLinks({ fail = null } = {}) {
  const calls = [], identity = Object.freeze({ uid: UID, profile: Object.freeze({ ...profile }), async assertCurrent(read) {
    const session = await read(SESSION_PATH);
    if (!session?.active) throw new AccountLinkError(401, 'session_expired');
  } });
  return { calls, identity, async run(...args) { calls.push(['run', ...args]); return { TEST_ONLY_LINK_RESPONSE: true }; },
    async authorizeMiniSession(bearer) { calls.push(['authorize', bearer]); if (fail) throw fail; return identity; } };
}

test('dispatcher leaves link RPCs unchanged and does not open business data', async () => {
  const db = new FakeFirestore(), links = fakeLinks(), dispatcher = createZaloBusinessDispatcher(links, db);
  const body = { challengeId: 'a'.repeat(64) };
  assert.deepEqual(await dispatcher.run('web.challengeStatus', body, 'TEST_ONLY_BEARER'), { TEST_ONLY_LINK_RESPONSE: true });
  assert.deepEqual(links.calls, [['run', 'web.challengeStatus', body, 'TEST_ONLY_BEARER']]);
  assert.deepEqual(db.native, []);
});

test('dispatcher authenticates a meal request before any business access and never accepts body UID metadata', async t => {
  t.mock.method(Date, 'now', () => AT);
  const db = new FakeFirestore({ [SESSION_PATH]: { active: true }, 'settings/monthlyConfig': { '11': true } });
  const links = fakeLinks(), dispatcher = createZaloBusinessDispatcher(links, db);
  await assert.rejects(dispatcher.run('meal.register', { month: MONTH, breakfast: true, lunch: true, uid: OTHER }, 'TEST_ONLY_SESSION'),
    error => error instanceof AccountLinkError && error.code === 'invalid_request');
  assert.deepEqual(links.calls, [['authorize', 'TEST_ONLY_SESSION']]);
  assert.deepEqual(db.native, []);
  const result = await dispatcher.run('meal.register', { month: MONTH, breakfast: true, lunch: true }, 'TEST_ONLY_SESSION');
  assert.deepEqual(result, { saved: true });
  const registration = db.docs.get(`registrations/${UID}_${MONTH}`);
  assert.equal(registration.userId, UID); assert.equal(registration.employeeId, profile.employeeId);
  assert.equal(db.docs.has(`registrations/${OTHER}_${MONTH}`), false);
  assert.equal(db.native.some(call => call[0] === 'doc' && call[1].includes(OTHER)), false);
  assert.equal(JSON.stringify(result).includes(UID), false);
});

test('failed session authorization causes zero business reads or writes', async () => {
  for (const code of ['session_expired', 'account_unavailable']) {
    const db = new FakeFirestore(), failure = new AccountLinkError(code === 'session_expired' ? 401 : 403, code);
    const links = fakeLinks({ fail: failure }), dispatcher = createZaloBusinessDispatcher(links, db);
    await assert.rejects(dispatcher.run('meal.snapshot', { month: MONTH, weekId: WEEK }, 'TEST_ONLY_SESSION'), error => error === failure);
    assert.deepEqual(links.calls, [['authorize', 'TEST_ONLY_SESSION']]);
    assert.deepEqual(db.native, []);
  }
});

test('offline dispatcher snapshot projects real-shaped own records through the scoped adapter without leaking private rows', async t => {
  t.mock.method(Date, 'now', () => AT);
  const menu = createEmptyMenu(WEEK); menu.days[0].breakfast = 'Phở bò';
  const db = new FakeFirestore({ [SESSION_PATH]: { active: true }, 'settings/monthlyConfig': { '11': true },
    [`registrations/${UID}_${MONTH}`]: { userId: UID, month: MONTH, breakfastCount: 21, lunchCount: 21,
      employeeId: profile.employeeId, firstMealDate: `${MONTH}-01`, timestamp: '2026-11-01T00:00:00Z' },
    [`registrations/${OTHER}_${MONTH}`]: { userId: OTHER, fullName: PRIVATE },
    [`meal_taps/${UID}/months/${MONTH}`]: { days: { '2026-11-03': ['07:30', '12:00'] }, updatedAt: '2026-11-03T08:00:00Z' },
    [`meal_taps/${OTHER}/months/${MONTH}`]: { days: { '2026-11-03': [PRIVATE] } },
    [`weekly_menus/${WEEK}`]: { ...menu, privateMetadata: PRIVATE }, 'checkins/2026-11-03': { raw: PRIVATE },
    'events/event_A': { name: 'Sự kiện mẫu', isOpen: true, createdAt: '2026-11-01T00:00:00Z', privateMetadata: PRIVATE },
  });
  const dispatcher = createZaloBusinessDispatcher(fakeLinks(), db);
  const result = await dispatcher.run('meal.snapshot', { month: MONTH, weekId: WEEK }, 'TEST_ONLY_SESSION');
  assert.equal(result.version, 1); assert.equal(result.month, MONTH); assert.equal(result.profile.employeeId, profile.employeeId);
  assert.equal(result.menu.days[0].breakfast, 'Phở bò');
  assert.equal(result.todayMeals.date, '2026-11-03');
  assert.equal(result.todayMeals.result.meals.breakfast.time, '07:30');
  assert.equal(result.todayMeals.result.meals.lunch.time, '12:00');
  assert.equal(result.events[0].name, 'Sự kiện mẫu');
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  assert.equal(JSON.stringify(result).includes(OTHER), false);
  assert.equal(JSON.stringify(result).includes('assertCurrent'), false);
  assert.equal(JSON.stringify(result).includes(SESSION_PATH), false);
  const documentReads = db.native.filter(call => call[0] === 'doc').map(call => call[1]);
  assert.equal(documentReads.some(path => path.startsWith('staff/') || path.startsWith('checkins/') || path.includes(OTHER)), false);
  assert.equal(db.native.some(call => call[0] === 'set'), false);
});
