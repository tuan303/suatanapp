// Offline only. No Firebase, email, network, device or production credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountLinkError } from '../server/account-links.mjs';
import { createMealBusinessService, mealDeadlineMillis, mealMonthOptions } from '../server/meal-business.mjs';
import { createEmptyMenu } from '../../agent/lib/weekly-menu.mjs';
import { SURVEY_QUESTIONS, SURVEY_VERSION } from '../../agent/lib/survey.mjs';

const clone = value => value === undefined ? null : structuredClone(value);
const UID = 'staff_A', OTHER = 'staff_B', WEEK = '2026-11-02';
const instant = value => Date.parse(value);
const profile = { fullName: 'Nhân viên mẫu', employeeId: '100001', department: 'CNTT', email: 'demo@hoangmaistarschool.edu.vn' };
const regPath = month => `registrations/${UID}_${month}`;
const cancelPath = date => `cancel_registrations/${UID}_${date}`;
const eventPath = event => `event_registrations/${UID}_${event}`;
const responsePath = week => `meal_surveys/${week}/responses/${UID}`;
const answers = () => ({ taste: 'ngon', variety: 'da_dang', warmth: 'du_nong', portion: 'vua_du',
  hygiene: 'sach', liked: 'Cá kho', disliked: '', suggestion: '' });
const registration = (month = '2026-11', extras = {}) => ({ userId: UID, month, breakfastCount: 21, lunchCount: 21,
  firstMealDate: `${month}-01`, timestamp: `${month}-01T00:00:00.000Z`, ...profile, ...extras });

class MemoryStore {
  docs = new Map();
  reads = [];
  queries = [];
  writes = [];
  attempts = 0;
  retryOnce = null;
  queue = Promise.resolve();
  constructor(initial = {}) { for (const [path, value] of Object.entries(initial)) this.docs.set(path, clone(value)); }
  async get(path) { this.reads.push(path); return clone(this.docs.get(path)); }
  async list(collection, limit) { return this.listFrom(this.docs, collection, limit); }
  listFrom(snapshot, collection, limit) {
    this.queries.push({ collection, limit });
    return [...snapshot].filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === collection.split('/').length + 1)
      .map(([path, value]) => ({ ...clone(value), id: path.slice(collection.length + 1) }))
      .sort((a, b) => b.id.localeCompare(a.id)).slice(0, limit);
  }
  runTransaction(work) {
    const execute = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        this.attempts++;
        const snapshot = new Map([...this.docs].map(([path, value]) => [path, clone(value)]));
        const pending = [];
        let wrote = false;
        const tx = {
          get: async path => { assert.equal(wrote, false, 'all Firestore reads must precede every write'); this.reads.push(path); return clone(snapshot.get(path)); },
          list: async (collection, limit) => { assert.equal(wrote, false); return this.listFrom(snapshot, collection, limit); },
          set: (path, value) => { wrote = true; pending.push({ path, value: clone(value) }); },
        };
        const result = await work(tx);
        if (attempt === 0 && this.retryOnce) { const retry = this.retryOnce; this.retryOnce = null; await retry(this); continue; }
        for (const { path, value } of pending) { this.docs.set(path, value); this.writes.push({ path, value: clone(value) }); }
        return clone(result);
      }
      assert.fail('test transaction retry limit reached');
    };
    const result = this.queue.then(execute, execute);
    this.queue = result.then(() => {}, () => {});
    return result;
  }
}

function fixture(overrides = {}) {
  const state = { now: instant('2026-11-03T08:30:00Z'), guardCalls: 0, revoked: false, onGuard: null };
  const store = new MemoryStore({ 'settings/monthlyConfig': { '09': true, '10': true, '11': true, '12': true },
    'settings/monthlyExpiry': {}, 'settings/cancelConfig': {}, 'settings/mealOffDays': { dates: [] },
    'settings/reconcileExcludes': { employeeIds: [] }, 'settings/checkinSync': { coverage: {} },
    'test_sessions/current': { uid: UID, active: true }, ...overrides });
  const identity = { uid: UID, profile: clone(profile), async assertCurrent(read) {
    state.guardCalls++;
    await read('test_sessions/current');
    if (state.onGuard) await state.onGuard(state.guardCalls);
    if (state.revoked) throw new AccountLinkError(401, 'session_expired');
  } };
  const service = createMealBusinessService({ store, now: () => state.now });
  return { state, store, identity, run: (action, body) => service.run(action, body, identity) };
}
const snapshot = (f, month = '2026-11', weekId = WEEK) => f.run('meal.snapshot', { month, weekId });
const rejectCode = (promise, code, status) => assert.rejects(promise, error => error instanceof AccountLinkError && error.code === code && (status === undefined || error.status === status));
const cancelBody = overrides => ({ dates: ['2026-11-04'], meal: 'both', reason: 'Nghỉ phép', canteen: 'tieuhoc', ...overrides });

test('snapshot reads real personal documents by linked UID and never scans other staff or all-school checkins', async () => {
  const menu = createEmptyMenu(WEEK); menu.days[0].breakfast = 'Phở bò';
  const f = fixture({ [regPath('2026-11')]: registration(), [`registrations/${OTHER}_2026-11`]: registration('2026-11', { userId: OTHER, fullName: 'PRIVATE_OTHER_PERSON' }),
    [`meal_taps/${UID}/months/2026-11`]: { days: { '2026-11-03': ['07:30', '12:00'] }, updatedAt: '2026-11-03T07:00:00Z' },
    [`meal_taps/${OTHER}/months/2026-11`]: { days: { '2026-11-03': ['PRIVATE_OTHER_TAP'] } },
    'checkins/2026-11-03': { people: { PRIVATE_OTHER_PERSON: {} } },
    [`weekly_menus/${WEEK}`]: { ...menu, privateMetadata: 'PRIVATE_MENU_METADATA' },
    'events/lunch_event': { name: 'Sự kiện mẫu', isOpen: true },
    [eventPath('lunch_event')]: { userId: UID, eventId: 'lunch_event', choice: 'yes' },
    [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-04T00:00:00Z' },
    [responsePath(WEEK)]: { uid: UID, answers: answers(), submittedAt: '2026-11-03T01:00:00Z' },
    [`meal_surveys/${WEEK}/responses/${OTHER}`]: { uid: OTHER, answers: { liked: 'PRIVATE_OTHER_RESPONSE' } },
  });
  const result = await snapshot(f);
  assert.equal(result.version, 1);
  assert.equal(result.profile.employeeId, profile.employeeId);
  assert.equal(result.menu.days[0].breakfast, 'Phở bò');
  assert.equal(result.history.days[0].result.meals.lunch.code, 'ok');
  assert.equal(result.events[0].choice, 'yes');
  assert.equal(result.survey.answers.liked, 'Cá kho');
  assert.deepEqual(result.survey.questions, SURVEY_QUESTIONS);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_OTHER|PRIVATE_MENU_METADATA/);
  assert.ok(f.store.reads.includes(`meal_taps/${UID}/months/2026-11`));
  assert.ok(f.store.reads.every(path => !path.includes(OTHER) && !path.startsWith('checkins/') && !path.startsWith('staff/')));
  assert.deepEqual(f.store.queries.map(query => query.collection).sort(), ['events', 'meal_surveys']);
  assert.equal(f.store.writes.length, 0);
  assert.equal(f.state.guardCalls, 2);
});

test('historical snapshots keep selected-month history and current-day data separate', async () => {
  const f = fixture({ [regPath('2026-10')]: registration('2026-10'), [regPath('2026-11')]: registration(),
    [`meal_taps/${UID}/months/2026-10`]: { days: { '2026-10-30': ['12:10'] } },
    [`meal_taps/${UID}/months/2026-11`]: { days: { '2026-11-03': ['07:35'] } } });
  const result = await snapshot(f, '2026-10');
  assert.equal(result.history.month, '2026-10');
  assert.ok(result.history.days.every(row => row.date.startsWith('2026-10-')));
  assert.equal(result.todayMeals.date, '2026-11-03');
  assert.equal(result.todayMeals.result.meals.breakfast.time, '07:35');
  assert.deepEqual(result.monthOptions, ['2026-09', '2026-10', '2026-11', '2026-12']);
});

test('month policy honors blocklist, open switch, past month and missing profile on the server', async () => {
  const blocked = fixture({ 'blocked_users/2026-11': { emails: [' DEMO@HOANGMAISTARSCHOOL.EDU.VN '] } });
  assert.equal((await snapshot(blocked)).registration.lockedReason, 'registration_blocked');
  await rejectCode(blocked.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }), 'registration_blocked', 403);
  const closed = fixture({ 'settings/monthlyConfig': { '11': false, '10': true } });
  assert.equal((await snapshot(closed)).registration.lockedReason, 'registration_closed');
  await rejectCode(closed.run('meal.register', { month: '2026-11', breakfast: false, lunch: true }), 'registration_closed', 409);
  await rejectCode(closed.run('meal.register', { month: '2026-10', breakfast: false, lunch: true }), 'registration_closed', 409);
  const incomplete = fixture(); incomplete.identity.profile.employeeId = '';
  assert.equal((await snapshot(incomplete)).registration.lockedReason, 'profile_incomplete');
  await rejectCode(incomplete.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }), 'profile_incomplete', 403);
  for (const f of [blocked, closed, incomplete]) assert.equal(f.store.writes.length, 0);
});

test('datetime-local deadlines always mean Vietnam wall time regardless of server timezone', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/New_York', 'Asia/Ho_Chi_Minh']) {
      process.env.TZ = timezone;
      assert.equal(mealDeadlineMillis('2026-11-03T16:00'), instant('2026-11-03T09:00:00Z'));
      assert.equal(mealDeadlineMillis('2026-11-03T16:00:01'), instant('2026-11-03T09:00:01Z'));
      assert.equal(mealDeadlineMillis('2026-11-03T16:00:00+07:00'), instant('2026-11-03T09:00:00Z'));
      assert.equal(mealDeadlineMillis('2026-11-03T09:00:00Z'), instant('2026-11-03T09:00:00Z'));
    }
    assert.equal(mealDeadlineMillis('2026-02-30T16:00'), null);
    for (const invalid of ['2026-02-30T16:00:00+07:00', '2026-02-30T16:00:00Z',
      '2026-11-03T16:61', '2026-11-03T16:00:61', '2026-11-03T16:61:00+07:00',
      '2026-11-03T16:00:61+07:00', '2026-11-03T16:61:00Z', '2026-11-03T16:00:61Z'])
      assert.equal(mealDeadlineMillis(invalid), null, `must reject invalid date or clock: ${invalid}`);
    assert.equal(mealDeadlineMillis('2026-11-03T24:00'), null);
    assert.equal(mealDeadlineMillis('not-a-date'), null);
    assert.deepEqual(mealMonthOptions('2027-01-02'), ['2026-11', '2026-12', '2027-01', '2027-02']);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});

test('registration expires exactly at the configured deadline, including a deadline reached during reads', async () => {
  const f = fixture({ 'settings/monthlyExpiry': { '11': '2026-11-03T16:00' } });
  f.state.now = instant('2026-11-03T08:59:59Z');
  assert.equal((await snapshot(f)).registration.allowed, true);
  f.state.guardCalls = 0;
  f.state.onGuard = count => { if (count === 2) f.state.now = instant('2026-11-03T09:00:00Z'); };
  await rejectCode(f.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }), 'registration_closed');
  assert.equal(f.store.writes.length, 0);
});

test('registration writes the canonical own-user document and uses server weekday counts from today inclusive', async () => {
  const f = fixture();
  assert.deepEqual(await f.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }), { saved: true });
  const saved = f.store.docs.get(regPath('2026-11'));
  assert.deepEqual(saved, { ...profile, userId: UID, month: '2026-11', breakfastCount: 20, lunchCount: 20,
    firstMealDate: '2026-11-03', weekdaysCounted: 20, fullMonthWeekdays: 21, timestamp: '2026-11-03T08:30:00.000Z' });
  assert.equal(f.store.writes.length, 1);
  assert.equal(f.state.guardCalls, 2);
  const future = fixture(); await future.run('meal.register', { month: '2026-12', breakfast: false, lunch: true });
  const next = future.store.docs.get(regPath('2026-12'));
  assert.equal(next.firstMealDate, '2026-12-01'); assert.equal(next.breakfastCount, 0); assert.equal(next.lunchCount, 23);
});

test('registration preserves existing documents; repeated identical and concurrent requests do not create extra writes', async () => {
  const f = fixture(); const body = { month: '2026-11', breakfast: true, lunch: true };
  const results = await Promise.all([f.run('meal.register', body), f.run('meal.register', body)]);
  assert.deepEqual(results, [{ saved: true }, { saved: true, unchanged: true }]);
  const original = clone(f.store.docs.get(regPath('2026-11')));
  f.store.docs.set('settings/monthlyConfig', { '11': false });
  assert.deepEqual(await f.run('meal.register', body), { saved: true, unchanged: true });
  await rejectCode(f.run('meal.register', { ...body, breakfast: false }), 'already_registered');
  assert.deepEqual(f.store.docs.get(regPath('2026-11')), original);
  assert.equal(f.store.writes.length, 1);
});

test('a retried registration transaction rechecks current policy rather than committing an earlier allowed decision', async () => {
  const f = fixture(); f.store.retryOnce = store => store.docs.set('settings/monthlyConfig', { '11': false });
  await rejectCode(f.run('meal.register', { month: '2026-11', breakfast: false, lunch: true }), 'registration_closed');
  assert.equal(f.store.attempts, 2); assert.equal(f.store.writes.length, 0); assert.equal(f.store.docs.has(regPath('2026-11')), false);
});

test('cancellation uses the Vietnam 16:00 cutoff, accepts valid extensions and rejects elapsed extensions', async () => {
  const before = fixture({ [regPath('2026-11')]: registration() });
  before.state.now = instant('2026-11-03T08:59:59Z');
  assert.equal((await snapshot(before)).cancellations.earliestDate, '2026-11-04');
  assert.deepEqual(await before.run('meal.cancel', cancelBody()), { saved: true });
  const atCutoff = fixture({ [regPath('2026-11')]: registration() }); atCutoff.state.now = instant('2026-11-03T09:00:00Z');
  assert.equal((await snapshot(atCutoff)).cancellations.earliestDate, '2026-11-05');
  await rejectCode(atCutoff.run('meal.cancel', cancelBody()), 'cancellation_closed');
  const extended = fixture({ [regPath('2026-11')]: registration(), 'settings/cancelConfig': { extendUntil: '2026-11-03T17:00' } });
  extended.state.now = instant('2026-11-03T09:30:00Z');
  assert.equal((await snapshot(extended)).cancellations.earliestDate, '2026-11-04');
  await extended.run('meal.cancel', cancelBody());
  const expired = fixture({ [regPath('2026-11')]: registration(), 'settings/cancelConfig': { extendUntil: '2026-11-03T17:00' } });
  expired.state.now = instant('2026-11-03T10:00:00Z');
  await rejectCode(expired.run('meal.cancel', cancelBody()), 'cancellation_closed');
  await rejectCode(extended.run('meal.cancel', cancelBody({ dates: ['2026-11-03'] })), 'cancellation_closed');
});

test('multi-day cancellations are atomic, scoped to each day registration and never overwrite a different previous cancellation', async () => {
  const f = fixture({ [regPath('2026-11')]: registration(), 'settings/mealOffDays': { dates: ['2026-11-05'] } });
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-04', '2026-11-05'] })), 'not_registered');
  assert.equal(f.store.writes.length, 0);
  assert.equal(f.store.docs.has(cancelPath('2026-11-04')), false);
  const working = fixture({ [regPath('2026-11')]: registration() });
  const body = cancelBody({ dates: ['2026-11-04', '2026-11-05'] });
  await working.run('meal.cancel', body);
  assert.equal(working.store.writes.length, 2);
  assert.deepEqual(await working.run('meal.cancel', body), { saved: true, unchanged: true });
  const saved = clone(working.store.docs.get(cancelPath('2026-11-04')));
  assert.equal(saved.formattedDate, '04/11/2026'); assert.equal(saved.userId, UID); assert.equal(saved.cancelMeal, 'both');
  await rejectCode(working.run('meal.cancel', { ...body, reason: 'Lý do khác' }), 'already_cancelled');
  assert.deepEqual(working.store.docs.get(cancelPath('2026-11-04')), saved);
  assert.equal(working.store.writes.length, 2);
});

test('an exact committed cancellation remains idempotent after 16:00 and an admin off-day change', async () => {
  const f = fixture({ [regPath('2026-11')]: registration() });
  const body = cancelBody();
  await f.run('meal.cancel', body);
  const saved = clone(f.store.docs.get(cancelPath('2026-11-04')));
  f.state.now = instant('2026-11-03T10:00:00Z');
  f.store.docs.set('settings/mealOffDays', { dates: ['2026-11-04'] });
  assert.deepEqual(await f.run('meal.cancel', body), { saved: true, unchanged: true });
  assert.deepEqual(f.store.docs.get(cancelPath('2026-11-04')), saved);
  assert.equal(f.store.writes.length, 1);
  await rejectCode(f.run('meal.cancel', { ...body, meal: 'lunch' }), 'already_cancelled');
  assert.equal(f.store.writes.length, 1);
});

test('a partial cancellation batch preserves a committed expired date and checks only its new dates', async () => {
  const f = fixture({ [regPath('2026-11')]: registration() });
  await f.run('meal.cancel', cancelBody());
  const existing = clone(f.store.docs.get(cancelPath('2026-11-04')));
  f.state.now = instant('2026-11-03T09:00:00Z');
  f.store.docs.set('settings/mealOffDays', { dates: ['2026-11-04'] });
  assert.deepEqual(await f.run('meal.cancel', cancelBody({ dates: ['2026-11-04', '2026-11-05'] })), { saved: true });
  assert.deepEqual(f.store.docs.get(cancelPath('2026-11-04')), existing);
  assert.equal(f.store.docs.get(cancelPath('2026-11-05')).timestamp, '2026-11-03T09:00:00.000Z');
  assert.deepEqual(f.store.writes.map(write => write.path), [cancelPath('2026-11-04'), cancelPath('2026-11-05')]);
});

test('a partial cancellation batch aborts atomically if any missing date is past cutoff', async () => {
  const f = fixture({ [regPath('2026-11')]: registration() });
  await f.run('meal.cancel', cancelBody({ dates: ['2026-11-05'] }));
  const before = clone([...f.store.docs]);
  f.state.now = instant('2026-11-03T09:00:00Z');
  // The first new date is valid; the second new date is now locked; the last
  // date was committed earlier. No new date may survive the batch failure.
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-06', '2026-11-04', '2026-11-05'] })), 'cancellation_closed');
  assert.deepEqual([...f.store.docs], before);
  assert.equal(f.store.writes.length, 1);
  assert.equal(f.store.docs.has(cancelPath('2026-11-06')), false);
  assert.equal(f.store.docs.has(cancelPath('2026-11-04')), false);
});

test('cancellation checks each month, requested meal, effective registration date, weekends and actual off days', async () => {
  const f = fixture({ [regPath('2026-11')]: registration('2026-11', { breakfastCount: 0, lunchCount: 21, firstMealDate: '2026-11-05' }) });
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-04'], meal: 'lunch' })), 'not_registered');
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-05'], meal: 'breakfast' })), 'not_registered');
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-07'], meal: 'lunch' })), 'not_registered');
  await rejectCode(f.run('meal.cancel', cancelBody({ dates: ['2026-11-30', '2026-12-01'], meal: 'lunch' })), 'not_registered');
  assert.equal(f.store.writes.length, 0);
  await f.run('meal.cancel', cancelBody({ dates: ['2026-11-05'], meal: 'lunch' }));
  assert.equal(f.store.writes.length, 1);
});

test('cancellation rejects missing or duplicate dates and invalid canteen, meal or reason', async () => {
  const f = fixture({ [regPath('2026-11')]: registration() });
  for (const overrides of [{ dates: [] }, { dates: ['2026-11-04', '2026-11-04'] }, { dates: ['2026-02-30'] },
    { meal: 'dinner' }, { canteen: 'arbitrary' }, { reason: '' }, { reason: 'x'.repeat(501) }, { reason: 'bad\u0000reason' }])
    await rejectCode(f.run('meal.cancel', cancelBody(overrides)), 'invalid_request', 400);
  assert.equal(f.store.writes.length, 0);
});

test('events require an actually open, unexpired record and preserve existing yes/no responses', async () => {
  const f = fixture({ 'events/open': { name: 'Sự kiện thật', isOpen: true, expiresAt: '2026-11-03T16:00' },
    'events/closed': { name: 'Đã đóng', isOpen: false }, 'events/expired': { name: 'Hết hạn', isOpen: true, expiresAt: '2026-11-03T15:30' } });
  for (const eventId of ['closed', 'expired', 'missing']) await rejectCode(f.run('meal.event', { eventId, choice: 'yes' }), 'event_closed');
  assert.equal(f.store.writes.length, 0);
  assert.deepEqual(await f.run('meal.event', { eventId: 'open', choice: 'no' }), { saved: true });
  const saved = clone(f.store.docs.get(eventPath('open')));
  assert.equal(saved.eventName, 'Sự kiện thật'); assert.equal(saved.choice, 'no'); assert.equal(saved.userId, UID);
  f.store.docs.set('events/open', { name: 'Đã đóng sau phản hồi', isOpen: false });
  assert.deepEqual(await f.run('meal.event', { eventId: 'open', choice: 'no' }), { saved: true, unchanged: true });
  await rejectCode(f.run('meal.event', { eventId: 'open', choice: 'yes' }), 'already_responded');
  assert.deepEqual(f.store.docs.get(eventPath('open')), saved); assert.equal(f.store.writes.length, 1);
});

test('survey validates the actual question codes and enforces [opensAt, closesAt) from the stored week', async () => {
  const open = '2026-11-06T08:00:00Z', close = '2026-11-09T05:00:00Z';
  const f = fixture({ [`meal_surveys/${WEEK}`]: { opensAt: open, closesAt: close } });
  const body = { weekId: WEEK, answers: answers() };
  f.state.now = instant(open) - 1; await rejectCode(f.run('meal.survey', body), 'survey_closed');
  f.state.now = instant(open); assert.deepEqual(await f.run('meal.survey', body), { saved: true });
  const saved = f.store.docs.get(responsePath(WEEK));
  assert.equal(saved.version, SURVEY_VERSION); assert.equal(saved.uid, UID); assert.equal(saved.weekId, WEEK);
  assert.equal(saved.email, profile.email); assert.equal(saved.userId, undefined);
  assert.equal(saved.answers.disliked, undefined); assert.equal(saved.answers.suggestion, undefined);
  f.state.now = instant(close); await rejectCode(f.run('meal.survey', body), 'survey_closed');
  assert.equal(f.store.writes.length, 1);
});

test('editing survey preserves first submittedAt and clears optional answers omitted by the edit', async () => {
  const f = fixture({ [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-04T00:00:00Z' } });
  await f.run('meal.survey', { weekId: WEEK, answers: { ...answers(), disliked: 'Món cũ', suggestion: 'Góp ý cũ' } });
  const first = clone(f.store.docs.get(responsePath(WEEK)));
  f.state.now += 60_000;
  await f.run('meal.survey', { weekId: WEEK, answers: { ...answers(), liked: 'Canh chua' } });
  const edited = f.store.docs.get(responsePath(WEEK));
  assert.equal(edited.submittedAt, first.submittedAt); assert.notEqual(edited.updatedAt, first.updatedAt);
  assert.equal(edited.answers.liked, 'Canh chua'); assert.equal(edited.answers.disliked, undefined); assert.equal(edited.answers.suggestion, undefined);
});

test('survey rejects malformed answers, unknown fields, skipped weeks and a deadline reached during its transaction', async () => {
  const f = fixture({ [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-03T09:00:00Z' } });
  for (const invalid of [{ ...answers(), taste: 'good' }, { ...answers(), liked: ' ' }, { ...answers(), liked: 'x'.repeat(501) }, { ...answers(), admin: 'true' }])
    await rejectCode(f.run('meal.survey', { weekId: WEEK, answers: invalid }), 'invalid_request');
  f.state.onGuard = count => { if (count === 2) f.state.now = instant('2026-11-03T09:00:00Z'); };
  await rejectCode(f.run('meal.survey', { weekId: WEEK, answers: answers() }), 'survey_closed');
  const skipped = fixture({ [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-04T00:00:00Z', email: { status: 'skipped' } } });
  await rejectCode(skipped.run('meal.survey', { weekId: WEEK, answers: answers() }), 'survey_closed');
  assert.equal(f.store.writes.length + skipped.store.writes.length, 0);
});

test('RPC does not accept client-selected identities, extra fields, malformed IDs or out-of-range months', async () => {
  const f = fixture();
  for (const [action, body] of [
    ['meal.register', { month: '2026-11', breakfast: true, lunch: true, uid: OTHER }],
    ['meal.register', { month: '2026-11', breakfast: true, lunch: true, userId: OTHER }],
    ['meal.register', { month: '2026-11', breakfast: true, lunch: false }],
    ['meal.register', { month: '2026-11', breakfast: false, lunch: false }],
    ['meal.register', { month: '2026-11', breakfast: 'yes', lunch: true }],
    ['meal.snapshot', { month: '2026-08', weekId: WEEK }],
    ['meal.snapshot', { month: '2026-11', weekId: '2026-11-03' }],
    ['meal.event', { eventId: '../private', choice: 'yes' }],
    ['meal.event', { eventId: 'open', choice: 'maybe' }],
    ['meal.survey', { weekId: WEEK, answers: answers(), email: profile.email }],
    ['admin.listUsers', {}],
  ]) await rejectCode(f.run(action, body), 'invalid_request');
  assert.equal(f.store.reads.length, 0); assert.equal(f.store.writes.length, 0);
});

test('documents whose stored owner conflicts with the trusted UID fail closed without any business writes', async () => {
  const f = fixture({ [regPath('2026-11')]: registration('2026-11', { userId: OTHER }) });
  await rejectCode(snapshot(f), 'service_unavailable');
  await rejectCode(f.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }), 'service_unavailable');
  assert.equal(f.store.writes.length, 0);
});

test('session revocation rechecked immediately before every write aborts the whole transaction', async () => {
  for (const [action, body, documents] of [
    ['meal.register', { month: '2026-11', breakfast: true, lunch: true }, {}],
    ['meal.cancel', cancelBody(), { [regPath('2026-11')]: registration() }],
    ['meal.event', { eventId: 'open', choice: 'yes' }, { 'events/open': { name: 'Sự kiện', isOpen: true } }],
    ['meal.survey', { weekId: WEEK, answers: answers() }, { [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-04T00:00:00Z' } }],
  ]) {
    const f = fixture(documents), before = clone([...f.store.docs]);
    f.state.onGuard = count => { if (count === 2) f.state.revoked = true; };
    await rejectCode(f.run(action, body), 'session_expired', 401);
    assert.equal(f.state.guardCalls, 2); assert.equal(f.store.writes.length, 0); assert.deepEqual([...f.store.docs], before);
  }
});

test('snapshot also rechecks a revoked session before returning personal business data', async () => {
  const f = fixture({ [regPath('2026-11')]: registration() });
  f.state.onGuard = count => { if (count === 2) f.state.revoked = true; };
  await rejectCode(snapshot(f), 'session_expired', 401);
  assert.equal(f.store.writes.length, 0);
});
