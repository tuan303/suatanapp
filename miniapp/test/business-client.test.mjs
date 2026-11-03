// Offline contract tests: fake transport only, no Zalo/Firebase/device access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createMealBusinessService } from '../server/meal-business.mjs';
const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/business.ts', import.meta.url))], bundle: true,
  write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const module = { exports: {} }; new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
const { parseMealSnapshot, createMealBusinessClient, businessReason } = module.exports;
const compiledAuth = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/accountLink.ts', import.meta.url))], bundle: true,
  write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const auth = { exports: {} }; new Function('require', 'module', 'exports', compiledAuth.outputFiles[0].text)(require, auth, auth.exports);
const { createAccountLinkClient, accountLinkMessage } = auth.exports;
const token = 'TEST_ONLY_OPAQUE_PERSONAL_SESSION';
const profile = { fullName: 'Nhân viên thử nghiệm', employeeId: '100001', department: 'Bộ phận mẫu', email: 'demo@hoangmaistarschool.edu.vn' };
const copy = value => JSON.parse(JSON.stringify(value));
const day = (date, code = 'ok') => ({ date, hold: null, result: { date, offDay: false,
  meals: { breakfast: { code, time: code === 'ok' ? '07:15' : null }, lunch: { code, time: code === 'ok' ? '12:05' : null } }, unrecognized: [], unrecognizedCount: 0 } });
const fixture = () => ({ version: 1, serverNow: Date.parse('2026-11-03T07:00:00Z'), today: '2026-11-03', month: '2026-11',
  monthOptions: ['2026-09', '2026-10', '2026-11', '2026-12'], profile: { ...profile },
  registration: { record: null, allowed: true, lockedReason: null, deadline: null, firstMealDate: '2026-11-04', weekdays: 20 },
  cancellations: { earliestDate: '2026-11-04', extendedUntil: null, records: [], dates: [{ date: '2026-11-04', breakfast: true, lunch: true, existing: false }] },
  menu: { weekId: '2026-11-02', version: 1, note: '', days: ['02','03','04','05','06'].map(d => ({ date: `2026-11-${d}`, breakfast: 'Phở', main: 'Cá', side: 'Đậu', vegetable: 'Rau', soup: 'Canh', rice: 'Cơm', dessert: 'Quả' })) },
  history: { month: '2026-11', days: [day('2026-11-03')], updatedAt: null, closedFrom: null, conflict: false }, todayMeals: day('2026-11-03'),
  events: [{ id: 'EVENT_TEST', name: 'Sự kiện thử nghiệm', deadline: null, allowed: true, choice: null, lockedReason: null }],
  survey: { weekId: '2026-11-02', opensAt: null, closesAt: null, allowed: false, skipped: false,
    questions: [{ id: 'taste', kind: 'choice', required: true, label: 'Cảm nhận?', options: [{ value: 'ngon', label: 'Ngon', tone: 'good' }] },
      { id: 'liked', kind: 'text', required: true, label: 'Món yêu thích?', maxLength: 500, placeholder: 'Chia sẻ món ăn…' }], answers: null, submittedAt: null, updatedAt: null },
  sync: { lastRunAt: null, lastCompleteAt: null, lastRunComplete: null } });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('personal DTO preserves real state and strips unreviewed role/admin/token fields', () => {
  const raw = fixture(); raw.profile.admin = true; raw.profile.role = 'admin'; raw.sessionToken = token;
  raw.history.days[0].result.unrecognized = ['08:05']; raw.history.days[0].result.unrecognizedCount = 25;
  const parsed = parseMealSnapshot(raw);
  assert.equal(parsed.profile.fullName, profile.fullName);
  assert.deepEqual(parsed.monthOptions, ['2026-09', '2026-10', '2026-11', '2026-12']);
  assert.equal(parsed.history.days[0].result.unrecognizedCount, 25);
  assert.equal(parsed.registration.allowed, true);
  assert.equal(parsed.survey.allowed, false);
  assert.ok(!JSON.stringify(parsed).includes(token)); assert.equal(parsed.profile.admin, undefined); assert.equal(parsed.profile.role, undefined);
});

test('invalid or mismatched dates, months, history and menu never become display data', () => {
  const mutations = [data => data.today = '2026-02-30', data => data.month = '2026-13', data => data.history.month = '2026-10',
    data => data.history.days[0].date = '2026-11-02', data => data.history.days.push(copy(data.history.days[0])),
    data => data.history.days = [day('2026-11-04')], data => data.todayMeals = day('2026-11-02'),
    data => data.menu.days[0].date = '2026-11-03', data => data.menu.days.pop(), data => data.menu.weekId = '2026-11-03',
    data => data.history.days[0].result.meals.breakfast.time = '25:01', data => data.history.days[0].result.meals.breakfast.code = 'FAKE_STATUS',
    data => data.survey.answers = { uid: 'FORGED' }, data => data.profile.email = 'a'.repeat(300), data => data.registration.allowed = 'true'];
  for (const mutate of mutations) { const data = fixture(); mutate(data); assert.throws(() => parseMealSnapshot(data), error => error.code === 'invalid_response'); }
});

test('business transport sends opaque session only in bearer, with exact action fields and explicit booleans', async () => {
  const calls = [];
  const account = createAccountLinkClient({ origin: 'https://suatanapp.vercel.app', fetchImpl: async (url, request) => {
    calls.push({ url, request }); return response(JSON.parse(request.body).action === 'meal.snapshot' ? fixture() : { saved: true }); } });
  const client = createMealBusinessClient(account);
  await client.snapshot(token, '2026-11', '2026-11-02');
  await client.register(token, '2026-12', false, true);
  await client.cancel(token, ['2026-11-04'], 'both', 'Nghỉ phép', 'tieuhoc');
  await client.event(token, 'EVENT_TEST', 'yes');
  await client.survey(token, '2026-11-02', { taste: 'ngon', liked: 'Phở' });
  assert.deepEqual(calls.map(call => JSON.parse(call.request.body)), [
    { action: 'meal.snapshot', month: '2026-11', weekId: '2026-11-02' },
    { action: 'meal.register', month: '2026-12', breakfast: false, lunch: true },
    { action: 'meal.cancel', dates: ['2026-11-04'], meal: 'both', reason: 'Nghỉ phép', canteen: 'tieuhoc' },
    { action: 'meal.event', eventId: 'EVENT_TEST', choice: 'yes' }, { action: 'meal.survey', weekId: '2026-11-02', answers: { taste: 'ngon', liked: 'Phở' } },
  ]);
  for (const {url, request} of calls) {
    assert.equal(url, 'https://suatanapp.vercel.app/api/zalo'); assert.equal(request.headers.Authorization, `Bearer ${token}`);
    assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error');
    assert.ok(!request.body.includes(token)); assert.ok(!request.body.includes(profile.email)); assert.ok(!request.body.includes('uid'));
  }
  const before = calls.length;
  await assert.rejects(account.business('meal.snapshot', token, { month: '2026-11', weekId: '2026-11-02', uid: 'other-person' }), error => error.code === 'invalid_request');
  await assert.rejects(account.business('admin.delete', token, {}), error => error.code === 'invalid_request');
  await assert.rejects(account.business('meal.snapshot', token, { month: '2026-11' }), error => error.code === 'invalid_request');
  await assert.rejects(account.business('meal.register', token, { month: '2026-12', lunch: true }), error => error.code === 'invalid_request');
  assert.equal(calls.length, before);
});

test('real business service snapshots and saved registration conform to the client DTO', async () => {
  const records = new Map([
    ['settings/monthlyConfig', { '11': true, '12': true }], ['settings/monthlyExpiry', {}], ['settings/mealOffDays', { dates: [] }],
    ['weekly_menus/2026-11-02', fixture().menu], ['meal_surveys/2026-11-02', { opensAt: '2026-11-06T08:00:00Z', closesAt: '2026-11-09T05:00:00Z' }],
  ]);
  const store = { runTransaction: async callback => callback({
    get: async path => records.has(path) ? copy(records.get(path)) : null,
    list: async name => [...records].filter(([path]) => path.startsWith(`${name}/`) && path.split('/').length === 2).map(([path, data]) => ({ ...copy(data), id: path.slice(name.length + 1) })),
    set: (path, data) => records.set(path, copy(data)),
  }) };
  const service = createMealBusinessService({ store, now: () => Date.parse('2026-11-03T02:00:00Z') });
  const identity = { uid: 'TEST_SCHOOL_USER', profile: { ...profile }, assertCurrent: async () => {} };
  const before = parseMealSnapshot(await service.run('meal.snapshot', { month: '2026-11', weekId: '2026-11-02' }, identity));
  assert.equal(before.registration.allowed, true); assert.equal(before.registration.record, null);
  assert.equal(before.survey.questions.length, 8); assert.equal(before.menu.days[0].breakfast, 'Phở');
  assert.deepEqual(await service.run('meal.register', { month: '2026-11', breakfast: true, lunch: true }, identity), { saved: true });
  const after = parseMealSnapshot(await service.run('meal.snapshot', { month: '2026-11', weekId: '2026-11-02' }, identity));
  assert.equal(after.registration.allowed, false); assert.equal(after.registration.lockedReason, 'already_registered');
  assert.ok(after.registration.record.breakfastCount > 0); assert.equal(after.registration.record.breakfastCount, after.registration.record.lunchCount);
  assert.equal(after.registration.record.month, '2026-11');
});

test('API failure or missing stored receipt never reports a successful mutation', async () => {
  for (const result of [{}, { saved: false }, { saved: true, unchanged: 'yes' }]) {
    const account = createAccountLinkClient({ origin: 'https://suatanapp.vercel.app', fetchImpl: async () => response(result) });
    await assert.rejects(createMealBusinessClient(account).register(token, '2026-12', false, true), error => error.code === 'invalid_response');
  }
  for (const [code, status] of [['registration_closed', 409], ['profile_incomplete', 403], ['already_cancelled', 409], ['survey_closed', 409]]) {
    const account = createAccountLinkClient({ origin: 'https://suatanapp.vercel.app', fetchImpl: async () => response({ error: { code, message: token } }, status) });
    await assert.rejects(createMealBusinessClient(account).register(token, '2026-12', false, true), error => error.code === code && !accountLinkMessage(error).includes(token));
  }
});

test('selected period is bound to snapshot request; aborted requests do not reach backend', async () => {
  const account = createAccountLinkClient({ origin: 'https://suatanapp.vercel.app', fetchImpl: async () => response(fixture()) });
  await assert.rejects(createMealBusinessClient(account).snapshot(token, '2026-10', '2026-11-02'), error => error.code === 'invalid_response');
  await assert.rejects(createMealBusinessClient(account).snapshot(token, '2026-11', '2026-10-26'), error => error.code === 'invalid_response');
  let calls = 0; const inactive = createAccountLinkClient({ origin: 'https://suatanapp.vercel.app', fetchImpl: async () => { calls++; throw Error('must not fetch'); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createMealBusinessClient(inactive).snapshot(token, '2026-11', '2026-11-02', controller.signal), error => error.code === 'cancelled');
  assert.equal(calls, 0); assert.ok(!businessReason(token).includes(token));
});
