// Offline contract test: Mini App LIVE-20261103.1, still open on phones that have not
// reloaded, must keep reading snapshots of the current API. No Zalo, Firebase or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createMealBusinessService } from '../server/meal-business.mjs';
import { EXEMPTION_HOLD } from '../server/meal-history.mjs';

const require = createRequire(import.meta.url);
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/business.ts', import.meta.url))], bundle: true,
  write: false, platform: 'node', format: 'cjs', packages: 'external', logLevel: 'silent' });
const current = { exports: {} }; new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, current, current.exports);
const { parseMealSnapshot } = current.exports;

// ---- Frozen LIVE-20261103.1 snapshot parser -------------------------------------
// Restored from the compiled bundle of that build: only names and layout differ, and
// it was checked equivalent to the minified code on generated valid and invalid
// snapshots. Do not update it with the current parser: it stands for old phones.
class LegacyResponseError extends Error { constructor(code) { super(code); this.code = code; } }
const invalid = () => { throw new LegacyResponseError('invalid_response'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : invalid();
const text = (value, max = 1000) => typeof value === 'string' && value.length <= max
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ? value : invalid();
const bool = value => typeof value === 'boolean' ? value : invalid();
const number = (value, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : invalid();
const nullableText = (value, max = 1000) => value === null ? null : text(value, max);
const array = (value, max) => Array.isArray(value) && value.length <= max ? value : invalid();
const nullableNumber = value => value === null ? null : number(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const date = value => validDate(value) ? value : invalid();
const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : invalid();
const time = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : invalid();
const profileText = (value, max, required = false) => {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new LegacyResponseError('invalid_response');
  return value;
};
const profile = value => {
  if (!(!!value && typeof value === 'object' && !Array.isArray(value))) throw new LegacyResponseError('invalid_response');
  return { fullName: profileText(value.fullName, 160, true), employeeId: profileText(value.employeeId, 80),
    department: profileText(value.department, 200), email: profileText(value.email, 254) };
};
// The only meal codes that build knows: any other code rejects the whole snapshot.
const LEGACY_CODES = ['off_day', 'excluded', 'not_registered', 'extra', 'invalid_id', 'ok', 'missing', 'pending'];
const dayView = value => {
  const day = object(value), result = object(day.result), meals = object(result.meals);
  const meal = raw => {
    const item = object(raw), code = text(item.code, 30);
    if (!LEGACY_CODES.includes(code)) invalid();
    return { code, time: item.time === null ? null : time(item.time), ...(item.reason === undefined ? {} : { reason: text(item.reason, 100) }) };
  };
  const resultDate = date(result.date), viewDate = date(day.date);
  if (resultDate !== viewDate) invalid();
  return { date: viewDate, hold: nullableText(day.hold, 80), result: { date: resultDate, offDay: bool(result.offDay),
    meals: { breakfast: meal(meals.breakfast), lunch: meal(meals.lunch) }, unrecognized: array(result.unrecognized, 150).map(time),
    ...(result.unrecognizedCount === undefined ? {} : { unrecognizedCount: number(result.unrecognizedCount, 100000) }) } };
};
function parseLegacySnapshot(value) {
  const root = object(value), registration = object(root.registration), cancellations = object(root.cancellations),
    history = object(root.history), sync = object(root.sync);
  if (root.version !== 1) invalid();
  const record = registration.record === null ? null : object(registration.record);
  const menu = root.menu === null ? null : object(root.menu);
  if (menu && menu.version !== 1) invalid();
  const survey = root.survey === null ? null : object(root.survey);
  const answers = survey?.answers === null ? null : survey ? object(survey.answers) : null;
  if (answers && Object.keys(answers).length > 30) invalid();
  const parsed = {
    version: 1, serverNow: number(root.serverNow), today: date(root.today), month: month(root.month),
    monthOptions: array(root.monthOptions, 12).map(month), profile: profile(root.profile),
    registration: { record: record ? { month: month(record.month), breakfastCount: number(record.breakfastCount, 31),
      lunchCount: number(record.lunchCount, 31), firstMealDate: date(record.firstMealDate), timestamp: nullableText(record.timestamp, 80) } : null,
    allowed: bool(registration.allowed), lockedReason: nullableText(registration.lockedReason, 160), deadline: nullableText(registration.deadline, 80),
    firstMealDate: date(registration.firstMealDate), weekdays: number(registration.weekdays, 31) },
    cancellations: { earliestDate: date(cancellations.earliestDate), extendedUntil: nullableText(cancellations.extendedUntil, 80),
      records: array(cancellations.records, 250).map(raw => { const item = object(raw); return { date: date(item.date), meal: text(item.meal, 30),
        reason: text(item.reason, 1000), canteen: text(item.canteen, 30), timestamp: nullableText(item.timestamp, 80) }; }),
      dates: array(cancellations.dates, 62).map(raw => { const item = object(raw); return { date: date(item.date), breakfast: bool(item.breakfast),
        lunch: bool(item.lunch), existing: bool(item.existing) }; }) },
    menu: menu ? { weekId: date(menu.weekId), version: 1, note: text(menu.note), days: array(menu.days, 5).map(raw => { const item = object(raw);
      return { date: date(item.date), breakfast: text(item.breakfast, 300), main: text(item.main, 300), side: text(item.side, 300),
        vegetable: text(item.vegetable, 300), soup: text(item.soup, 300), rice: text(item.rice, 300), dessert: text(item.dessert, 300) }; }) } : null,
    history: { month: month(history.month), days: array(history.days, 31).map(dayView), updatedAt: nullableText(history.updatedAt, 80),
      closedFrom: history.closedFrom === null ? null : date(history.closedFrom), conflict: bool(history.conflict) },
    todayMeals: root.todayMeals === null ? null : dayView(root.todayMeals),
    events: array(root.events, 100).map(raw => { const item = object(raw);
      if (item.choice !== null && item.choice !== 'yes' && item.choice !== 'no') invalid();
      return { id: text(item.id, 220), name: text(item.name, 500), deadline: nullableText(item.deadline, 80), allowed: bool(item.allowed),
        choice: item.choice, lockedReason: nullableText(item.lockedReason, 160) }; }),
    survey: survey ? { weekId: date(survey.weekId), opensAt: nullableNumber(survey.opensAt), closesAt: nullableNumber(survey.closesAt),
      allowed: bool(survey.allowed), skipped: bool(survey.skipped),
      questions: array(survey.questions, 30).map(raw => { const item = object(raw), base = { id: text(item.id, 60), label: text(item.label, 1000), required: bool(item.required) };
        if (item.kind === 'choice') return { ...base, kind: 'choice', options: array(item.options, 20).map(rawOption => { const option = object(rawOption);
          return { value: text(option.value, 100), label: text(option.label, 1000), tone: text(option.tone, 30) }; }) };
        if (item.kind === 'text') return { ...base, kind: 'text', maxLength: number(item.maxLength, 5000), placeholder: text(item.placeholder, 1000) };
        return invalid(); }),
      answers: answers ? Object.fromEntries(Object.entries(answers).map(([key, answer]) => [text(key, 60), text(answer, 5000)])) : null,
      submittedAt: nullableText(survey.submittedAt, 80), updatedAt: nullableText(survey.updatedAt, 80) } : null,
    sync: { lastRunAt: nullableText(sync.lastRunAt, 80), lastCompleteAt: nullableText(sync.lastCompleteAt, 80),
      lastRunComplete: sync.lastRunComplete === null ? null : bool(sync.lastRunComplete) },
  };
  if (!parsed.monthOptions.includes(parsed.month) || parsed.history.month !== parsed.month
    || (parsed.registration.record && parsed.registration.record.month !== parsed.month)
    || parsed.history.days.some(day => !day.date.startsWith(`${parsed.month}-`) || day.date > parsed.today)
    || new Set(parsed.history.days.map(day => day.date)).size !== parsed.history.days.length
    || (parsed.todayMeals && parsed.todayMeals.date !== parsed.today)
    || parsed.cancellations.dates.some(day => !day.date.startsWith(`${parsed.month}-`))) invalid();
  if (parsed.menu) {
    const monday = new Date(`${parsed.menu.weekId}T00:00:00Z`);
    if (monday.getUTCDay() !== 1 || parsed.menu.days.length !== 5
      || parsed.menu.days.some((day, index) => day.date !== new Date(monday.getTime() + index * 864e5).toISOString().slice(0, 10))) invalid();
  }
  if (parsed.survey && (new Date(`${parsed.survey.weekId}T00:00:00Z`).getUTCDay() !== 1
    || new Set(parsed.survey.questions.map(question => question.id)).size !== parsed.survey.questions.length
    || Object.keys(parsed.survey.answers || {}).some(key => !parsed.survey?.questions.some(question => question.id === key)))) invalid();
  return parsed;
}
// ---------------------------------------------------------------------------------

const UID = 'staff_A', WEEK = '2026-11-02';
const owner = { fullName: 'Nhân viên mẫu', employeeId: '100001', department: 'CNTT', email: 'demo@hoangmaistarschool.edu.vn' };
const documents = overrides => new Map(Object.entries({
  'settings/monthlyConfig': { '11': true, '12': true }, 'settings/mealOffDays': { dates: [] },
  // 15:30 VN on 03/11, both days synchronized after lunch: every meal is final.
  'settings/checkinSync': { coverage: { '2026-11-02': '2026-11-02T07:00:00Z', '2026-11-03': '2026-11-03T07:00:00Z' },
    lastRunAt: '2026-11-03T07:00:00Z', lastRunComplete: true },
  [`registrations/${UID}_2026-11`]: { userId: UID, employeeId: '100001', month: '2026-11', breakfastCount: 21, lunchCount: 21,
    firstMealDate: '2026-11-01', timestamp: '2026-10-25T00:00:00Z' },
  [`meal_taps/${UID}/months/2026-11`]: { updatedAt: '2026-11-03T07:00:00Z', days: { '2026-11-02': ['07:20', '12:10'], '2026-11-03': ['07:30'] } },
  [`weekly_menus/${WEEK}`]: { weekId: WEEK, version: 1, note: '', days: ['02', '03', '04', '05', '06'].map(day => ({ date: `2026-11-${day}`,
    breakfast: 'Phở', main: 'Cá', side: 'Đậu', vegetable: 'Rau', soup: 'Canh', rice: 'Cơm', dessert: 'Quả' })) },
  'events/open': { name: 'Sự kiện', isOpen: true }, [`meal_surveys/${WEEK}`]: { opensAt: '2026-11-03T00:00:00Z', closesAt: '2026-11-09T00:00:00Z' },
  ...overrides,
}));
const policy = data => ({ employeeId: '100001', email: owner.email, fullName: 'PRIVATE_EXEMPTION_NAME', periods: [{ from: '2026-11-01', to: null }], ...data });
async function snapshot(docs, selectedMonth = '2026-11') {
  // Exemption rows come back as { id, data } like the Firestore adapter; other lists are flattened.
  const store = { runTransaction: async work => work({
    get: async path => docs.has(path) ? structuredClone(docs.get(path)) : null,
    list: async (collection, limit) => [...docs].filter(([path]) => path.startsWith(`${collection}/`) && path.split('/').length === 2)
      .map(([path, data]) => collection === 'meal_checkin_exemptions' ? { id: path.slice(collection.length + 1), data: structuredClone(data) }
        : { ...structuredClone(data), id: path.slice(collection.length + 1) }).slice(0, limit),
    set: () => assert.fail('a snapshot never writes'),
  }) };
  const service = createMealBusinessService({ store, now: () => Date.parse('2026-11-03T08:30:00Z') });
  return service.run('meal.snapshot', { month: selectedMonth, weekId: WEEK }, { uid: UID, profile: { ...owner }, assertCurrent: async () => {} });
}
const holds = parsed => [parsed.todayMeals?.hold ?? null, ...parsed.history.days.map(day => day.hold)];

test('LIVE-20261103.1 and the current parser both read the exemption hold of a real snapshot unchanged', async () => {
  const raw = await snapshot(documents({ 'meal_checkin_exemptions/100001': policy({ periods: [] }) }));
  // 03/11: breakfast tapped, lunch registered without a tap, the record is broken -> held with the explanation.
  assert.deepEqual(raw.history.days.map(day => [day.date, day.hold]), [['2026-11-03', EXEMPTION_HOLD], ['2026-11-02', null]]);
  for (const parse of [parseLegacySnapshot, parseMealSnapshot]) {
    const parsed = parse(raw);
    assert.deepEqual(holds(parsed), [EXEMPTION_HOLD, EXEMPTION_HOLD, null]);
    assert.deepEqual(parsed.todayMeals.result.meals, { breakfast: { code: 'ok', time: '07:30' }, lunch: { code: 'pending', time: null } });
  }
  assert.doesNotMatch(JSON.stringify(raw), /PRIVATE_EXEMPTION_NAME/);
  // Snapshots without an exempt meal, such as a month without registration, stay readable by the old build too.
  const plain = await snapshot(documents({}));
  const unregistered = await snapshot(documents({ [`registrations/${UID}_2026-11`]: null, [`meal_taps/${UID}/months/2026-11`]: null }));
  for (const value of [plain, unregistered, await snapshot(documents({}), '2026-10')]) assert.deepEqual(parseLegacySnapshot(value), parseMealSnapshot(value));
  assert.equal(parseLegacySnapshot(unregistered).registration.record, null);
});

test('LIVE-20261103.1 rejects an exempt meal, so the exemption API may only run once every published and Testing build is LIVE-20261106.1 or later', async () => {
  const raw = await snapshot(documents({ 'meal_checkin_exemptions/100001': policy({}) }));
  assert.deepEqual(parseMealSnapshot(raw).todayMeals.result.meals.lunch, { code: 'exempt', time: null });
  assert.throws(() => parseLegacySnapshot(raw), error => error.code === 'invalid_response');
});
