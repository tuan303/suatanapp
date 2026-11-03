import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersonalMealHistory } from '../server/meal-history.mjs';
import { evaluatePersonDay, mealDaysOfMonth } from '../../agent/lib/meal-rules.mjs';

const registration = { userId: 'staff_A', employeeId: '100001', month: '2026-10', breakfastCount: 22,
  lunchCount: 22, firstMealDate: '2026-10-01', timestamp: '2026-09-25T04:00:00.000Z' };
const at = '2026-10-19T09:00:00.000Z'; // 16:00 VN
const fixture = overrides => ({ month: '2026-10', today: '2026-10-19', now: new Date(at), registration,
  tapsDoc: { updatedAt: at, days: { '2026-10-19': ['07:30', '12:05', '15:20'] } },
  cancelations: [], sync: { coverage: { '2026-10-19': at } }, offDays: [], excludedIds: [], ...overrides });
const day = (history, date = '2026-10-19') => history.days.find(row => row.date === date);

test('personal history mirrors shared meal decisions and returns newest day first', () => {
  const input = fixture(), history = buildPersonalMealHistory(input);
  assert.equal(history.month, input.month);
  assert.equal(history.updatedAt, at);
  assert.equal(history.closedFrom, '2026-10-19');
  assert.equal(history.conflict, false);
  assert.deepEqual(history.days.map(row => row.date), mealDaysOfMonth('2026-10', [], '2026-10-19').reverse());
  assert.deepEqual(day(history).result, { ...evaluatePersonDay({ date: input.today, registration, times: input.tapsDoc.days[input.today], coverageAt: at, now: input.now }), unrecognizedCount: 1 });
  assert.deepEqual(day(history).result.unrecognized, ['15:20']);
  assert.equal(day(history).result.meals.breakfast.code, 'ok');
});

test('actual taps on an off day and weekend remain visible as reference only', () => {
  const history = buildPersonalMealHistory(fixture({ offDays: ['2026-10-19'], tapsDoc: { days: {
    '2026-10-19': ['07:30', '12:05'], '2026-10-18': ['12:15'], '2026-10-17': [] } } }));
  assert.equal(day(history).result.offDay, true);
  assert.deepEqual(day(history).result.meals.lunch, { code: 'off_day', time: '12:05' });
  assert.equal(day(history, '2026-10-18').result.meals.lunch.code, 'off_day');
  assert.equal(day(history, '2026-10-18').result.meals.lunch.time, '12:15');
  assert.equal(day(history, '2026-10-17'), undefined);
});

test('today is never marked missing before meal end or after an incomplete sync', () => {
  const input = fixture({ now: new Date('2026-10-19T01:15:00Z'), tapsDoc: { days: {} },
    sync: { coverage: { '2026-10-19': '2026-10-19T01:15:00Z' } } });
  const morning = day(buildPersonalMealHistory(input));
  assert.equal(morning.result.meals.breakfast.code, 'missing');
  assert.equal(morning.result.meals.lunch.code, 'pending');
  const incomplete = day(buildPersonalMealHistory(fixture({ tapsDoc: null, sync: { lastRunComplete: false, coverage: {} } })));
  assert.equal(incomplete.result.meals.breakfast.code, 'pending');
  assert.equal(incomplete.result.meals.lunch.code, 'pending');
});

test('future and invalid coverage cannot finalize absent taps', () => {
  const history = buildPersonalMealHistory(fixture({ tapsDoc: null, sync: { coverage: {
    '2026-10-19': '2026-10-19T10:00:00Z', '2026-02-30': at, '2026-10-16': 'not-a-time',
    '2026-10-15': '2026-10-19T16:00', '2026-10-14': '2026-02-30T04:00:00Z', '2026-10-13': '2026-10-13T24:00:00Z' } } }));
  assert.equal(history.closedFrom, null);
  assert.equal(day(history).result.meals.lunch.code, 'pending');
});

test('conflict applies from the real conflictSince date and preserves earlier decisions', () => {
  const history = buildPersonalMealHistory(fixture({ tapsDoc: { conflict: true, conflictSince: '2026-10-19', updatedAt: at, days: {} },
    sync: { coverage: { '2026-10-16': at, '2026-10-19': at } } }));
  assert.equal(history.conflict, true);
  assert.equal(day(history).hold, 'conflict');
  assert.equal(day(history).result.meals.lunch.code, 'pending');
  assert.equal(day(history, '2026-10-16').hold, null);
  assert.equal(day(history, '2026-10-16').result.meals.lunch.code, 'missing');
});

test('legacy conflict uses updatedAt VN date; explicit null or invalid since holds the whole month', () => {
  const legacy = buildPersonalMealHistory(fixture({ tapsDoc: { conflict: true, updatedAt: '2026-10-18T18:00:00Z', days: {} } }));
  assert.equal(day(legacy).hold, 'conflict');
  assert.equal(day(legacy, '2026-10-16').hold, 'expired');
  for (const conflictSince of [null, '2026-02-30', 1]) {
    const history = buildPersonalMealHistory(fixture({ tapsDoc: { conflict: true, conflictSince, updatedAt: at } }));
    assert.equal(day(history, '2026-10-01').hold, 'conflict');
  }
});

test('safety-held days do not become missing; expired days are distinguishable from pending sync', () => {
  const history = buildPersonalMealHistory(fixture({ tapsDoc: { days: {} }, sync: {
    coverage: { '2026-10-16': at, '2026-10-19': at }, alerts: { '2026-10-19': { held: true, privateDetails: 'not returned' } } } }));
  assert.equal(day(history).hold, 'guarded');
  assert.equal(day(history).result.meals.lunch.code, 'pending');
  assert.equal(day(history, '2026-10-15').hold, 'expired');
  assert.equal(day(history, '2026-10-15').result.meals.lunch.code, 'pending');
});

test('only real selected-month dates and valid deduplicated times are projected', () => {
  const history = buildPersonalMealHistory(fixture({ tapsDoc: { days: {
    '2026-10-19': ['24:00', '07:30', '12:05', '07:30', '12:60', 123, null, '9:00', '00:00'],
    '2026-11-02': ['12:00'], '2026-09-30': ['12:00'], '2026-10-32': ['12:00'],
    '2026-10-20': ['12:00'], '2026-10-18': ['24:00'], 'arbitrary': ['12:00'] } } }));
  assert.equal(history.days.length, 13);
  assert.deepEqual(day(history).result.unrecognized, ['00:00']);
  assert.equal(day(history).result.meals.lunch.time, '12:05');
  assert.ok(history.days.every(row => row.date.startsWith('2026-10-') && row.date <= '2026-10-19'));
});

test('cancellations are scoped to date, meal and the registration owner', () => {
  const history = buildPersonalMealHistory(fixture({ tapsDoc: null, cancelations: [
    { userId: 'other', employeeId: '100001', cancelDate: '2026-10-19', cancelMeal: 'lunch' },
    { userId: 'staff_A', cancelDate: '2026-10-19', cancelMeal: 'breakfast' },
    { userId: 'staff_A', cancelDate: '2026-10-19', cancelMeal: 'unsupported' },
    { userId: 'staff_A', cancelDate: '2026-09-19', cancelMeal: 'both' },
  ] }));
  assert.equal(day(history).result.meals.breakfast.code, 'not_registered');
  assert.equal(day(history).result.meals.breakfast.reason, 'canceled');
  assert.equal(day(history).result.meals.lunch.code, 'missing');
});

test('normalizes historical breakfast-only counts and respects configured exclusions', () => {
  const legacy = fixture({ registration: { ...registration, breakfastCount: '22', lunchCount: 0 }, tapsDoc: null });
  assert.equal(day(buildPersonalMealHistory(legacy)).result.meals.lunch.code, 'missing');
  assert.equal(day(buildPersonalMealHistory({ ...legacy, excludedIds: ['100001'] })).result.meals.lunch.code, 'excluded');
  const wrongMonth = buildPersonalMealHistory(fixture({ registration: { ...registration, month: '2026-09' }, tapsDoc: null }));
  assert.equal(day(wrongMonth).result.meals.lunch.code, 'not_registered');
});

test('outside-window details are bounded only after every valid tap classifies the meals', () => {
  const outside = Array.from({ length: 60 }, (_, minute) => `00:${String(minute).padStart(2, '0')}`);
  const history = buildPersonalMealHistory(fixture({ tapsDoc: { days: { '2026-10-19': [...outside, '07:30', '12:05'] } } }));
  assert.equal(day(history).result.meals.breakfast.code, 'ok');
  assert.equal(day(history).result.meals.lunch.code, 'ok');
  assert.equal(day(history).result.unrecognized.length, 20);
  assert.equal(day(history).result.unrecognizedCount, 60);
});

test('projection contains only the fixed personal result and bounded primitive values', () => {
  const input = fixture({ registration: { ...registration, fullName: 'PRIVATE_NAME', role: 'admin' },
    tapsDoc: { ...fixture().tapsDoc, privateToken: 'PRIVATE_TOKEN' }, sync: { ...fixture().sync, devices: { PRIVATE_IP: {} } } });
  const before = structuredClone(input);
  const history = buildPersonalMealHistory(input);
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(history).sort(), ['closedFrom', 'conflict', 'days', 'month', 'updatedAt']);
  const serialized = JSON.stringify(history);
  assert.doesNotMatch(serialized, /PRIVATE_NAME|PRIVATE_TOKEN|PRIVATE_IP|employeeId|userId|role/);
  assert.ok(history.days.length <= 31);
  for (const row of history.days) assert.deepEqual(Object.keys(row).sort(), ['date', 'hold', 'result']);
});

test('requires explicit valid month, date and clock, and never uses implicit current time', () => {
  for (const month of ['2026-00', '2026-13', '26-10', '../2026-10', 202610, '0000-01'])
    assert.throws(() => buildPersonalMealHistory(fixture({ month })), /Invalid history month/);
  for (const today of ['2026-02-30', 'not-a-date', null])
    assert.throws(() => buildPersonalMealHistory(fixture({ today })), /Invalid history date/);
  for (const now of [undefined, null, new Date(NaN), NaN, '2026-10-19T16:00', '2026-02-30T09:00:00Z'])
    assert.throws(() => buildPersonalMealHistory(fixture({ now })), /Invalid history clock/);
  const history = buildPersonalMealHistory(fixture({ today: '2026-11-30', tapsDoc: { days: { '2026-10-20': ['12:00'] } } }));
  assert.ok(history.days.every(row => row.date <= '2026-10-19'));
});
