import { AccountLinkError, parseLinkedProfile, type AccountLinkClient, type LinkedProfile } from './accountLink';

export type MealCode = 'off_day' | 'excluded' | 'not_registered' | 'extra' | 'invalid_id' | 'ok' | 'missing' | 'pending';
export type MealResult = { code: MealCode; time: string | null; reason?: string };
export type DayResult = { date: string; offDay: boolean; meals: { breakfast: MealResult; lunch: MealResult }; unrecognized: string[]; unrecognizedCount?: number };
export type DayView = { date: string; hold: string | null; result: DayResult };
export type MenuDay = { date: string; breakfast: string; main: string; side: string; vegetable: string; soup: string; rice: string; dessert: string };
export type SurveyQuestion = { id: string; kind: 'choice'; label: string; required: boolean; options: Array<{ value: string; label: string; tone: string }> }
  | { id: string; kind: 'text'; label: string; required: boolean; maxLength: number; placeholder: string };
export type MealSnapshot = {
  version: 1; serverNow: number; today: string; month: string; monthOptions: string[]; profile: LinkedProfile;
  registration: { record: null | { month: string; breakfastCount: number; lunchCount: number; firstMealDate: string; timestamp: string | null };
    allowed: boolean; lockedReason: string | null; deadline: string | null; firstMealDate: string; weekdays: number };
  cancellations: { earliestDate: string; extendedUntil: string | null;
    records: Array<{ date: string; meal: string; reason: string; canteen: string; timestamp: string | null }>;
    dates: Array<{ date: string; breakfast: boolean; lunch: boolean; existing: boolean }> };
  menu: null | { weekId: string; version: 1; days: MenuDay[]; note: string };
  history: { month: string; days: DayView[]; updatedAt: string | null; closedFrom: string | null; conflict: boolean };
  todayMeals: DayView | null;
  events: Array<{ id: string; name: string; deadline: string | null; allowed: boolean; choice: 'yes' | 'no' | null; lockedReason: string | null }>;
  survey: null | { weekId: string; opensAt: number | null; closesAt: number | null; allowed: boolean; skipped: boolean;
    questions: SurveyQuestion[]; answers: Record<string, string> | null; submittedAt: string | null; updatedAt: string | null };
  sync: { lastRunAt: string | null; lastCompleteAt: string | null; lastRunComplete: boolean | null };
};

const invalid = (): never => { throw new AccountLinkError('invalid_response'); };
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : invalid();
const text = (v: unknown, max = 1000): string => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v) ? v : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const number = (v: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max ? v : invalid();
const nullableText = (v: unknown, max = 1000): string | null => v === null ? null : text(v, max);
const array = (v: unknown, max: number): unknown[] => Array.isArray(v) && v.length <= max ? v : invalid();
const nullableNumber = (v: unknown) => v === null ? null : number(v);
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
const date = (v: unknown): string => validDate(v) ? v : invalid();
const month = (v: unknown): string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : invalid();
const time = (v: unknown): string => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : invalid();
const dayView = (v: unknown): DayView => {
  const day = object(v), result = object(day.result), meals = object(result.meals);
  const meal = (v: unknown): MealResult => {
    const item = object(v), code = text(item.code, 30);
    if (!['off_day', 'excluded', 'not_registered', 'extra', 'invalid_id', 'ok', 'missing', 'pending'].includes(code)) invalid();
    return { code: code as MealCode, time: item.time === null ? null : time(item.time), ...(item.reason === undefined ? {} : { reason: text(item.reason, 100) }) };
  };
  const resultDate = date(result.date), viewDate = date(day.date);
  if (resultDate !== viewDate) invalid();
  return { date: viewDate, hold: nullableText(day.hold, 80), result: { date: resultDate, offDay: bool(result.offDay),
    meals: { breakfast: meal(meals.breakfast), lunch: meal(meals.lunch) }, unrecognized: array(result.unrecognized, 150).map(time),
    ...(result.unrecognizedCount === undefined ? {} : { unrecognizedCount: number(result.unrecognizedCount, 100000) }) } };
};

/** Copy only reviewed personal fields; never accept role/UID/token fields from data. */
export function parseMealSnapshot(value: unknown): MealSnapshot {
  const root = object(value), registration = object(root.registration), cancellations = object(root.cancellations), history = object(root.history), sync = object(root.sync);
  if (root.version !== 1) invalid();
  const record = registration.record === null ? null : object(registration.record);
  const menu = root.menu === null ? null : object(root.menu);
  if (menu && menu.version !== 1) invalid();
  const survey = root.survey === null ? null : object(root.survey);
  const answers = survey?.answers === null ? null : survey ? object(survey.answers) : null;
  if (answers && Object.keys(answers).length > 30) invalid();
  const parsed: MealSnapshot = {
    version: 1, serverNow: number(root.serverNow), today: date(root.today), month: month(root.month), monthOptions: array(root.monthOptions, 12).map(month), profile: parseLinkedProfile(root.profile),
    registration: { record: record ? { month: month(record.month), breakfastCount: number(record.breakfastCount, 31), lunchCount: number(record.lunchCount, 31), firstMealDate: date(record.firstMealDate), timestamp: nullableText(record.timestamp, 80) } : null,
      allowed: bool(registration.allowed), lockedReason: nullableText(registration.lockedReason, 160), deadline: nullableText(registration.deadline, 80), firstMealDate: date(registration.firstMealDate), weekdays: number(registration.weekdays, 31) },
    cancellations: { earliestDate: date(cancellations.earliestDate), extendedUntil: nullableText(cancellations.extendedUntil, 80),
      records: array(cancellations.records, 250).map(v => { const item = object(v); return { date: date(item.date), meal: text(item.meal, 30), reason: text(item.reason, 1000), canteen: text(item.canteen, 30), timestamp: nullableText(item.timestamp, 80) }; }),
      dates: array(cancellations.dates, 62).map(v => { const item = object(v); return { date: date(item.date), breakfast: bool(item.breakfast), lunch: bool(item.lunch), existing: bool(item.existing) }; }) },
    menu: menu ? { weekId: date(menu.weekId), version: 1, note: text(menu.note), days: array(menu.days, 5).map(v => {
      const item = object(v); return { date: date(item.date), breakfast: text(item.breakfast, 300), main: text(item.main, 300), side: text(item.side, 300), vegetable: text(item.vegetable, 300), soup: text(item.soup, 300), rice: text(item.rice, 300), dessert: text(item.dessert, 300) };
    }) } : null,
    history: { month: month(history.month), days: array(history.days, 31).map(dayView), updatedAt: nullableText(history.updatedAt, 80), closedFrom: history.closedFrom === null ? null : date(history.closedFrom), conflict: bool(history.conflict) },
    todayMeals: root.todayMeals === null ? null : dayView(root.todayMeals),
    events: array(root.events, 100).map(v => { const item = object(v); if (item.choice !== null && item.choice !== 'yes' && item.choice !== 'no') invalid(); return { id: text(item.id, 220), name: text(item.name, 500), deadline: nullableText(item.deadline, 80), allowed: bool(item.allowed), choice: item.choice as 'yes' | 'no' | null, lockedReason: nullableText(item.lockedReason, 160) }; }),
    survey: survey ? { weekId: date(survey.weekId), opensAt: nullableNumber(survey.opensAt), closesAt: nullableNumber(survey.closesAt), allowed: bool(survey.allowed), skipped: bool(survey.skipped),
      questions: array(survey.questions, 30).map(v => { const item = object(v), base = { id: text(item.id, 60), label: text(item.label, 1000), required: bool(item.required) };
        if (item.kind === 'choice') return { ...base, kind: 'choice' as const, options: array(item.options, 20).map(v => { const option = object(v); return { value: text(option.value, 100), label: text(option.label, 1000), tone: text(option.tone, 30) }; }) };
        if (item.kind === 'text') return { ...base, kind: 'text' as const, maxLength: number(item.maxLength, 5000), placeholder: text(item.placeholder, 1000) };
        return invalid(); }),
      answers: answers ? Object.fromEntries(Object.entries(answers).map(([key, value]) => [text(key, 60), text(value, 5000)])) : null,
      submittedAt: nullableText(survey.submittedAt, 80), updatedAt: nullableText(survey.updatedAt, 80) } : null,
    sync: { lastRunAt: nullableText(sync.lastRunAt, 80), lastCompleteAt: nullableText(sync.lastCompleteAt, 80), lastRunComplete: sync.lastRunComplete === null ? null : bool(sync.lastRunComplete) },
  };
  if (!parsed.monthOptions.includes(parsed.month) || parsed.history.month !== parsed.month
    || (parsed.registration.record && parsed.registration.record.month !== parsed.month)
    || parsed.history.days.some(day => !day.date.startsWith(`${parsed.month}-`) || day.date > parsed.today)
    || new Set(parsed.history.days.map(day => day.date)).size !== parsed.history.days.length
    || (parsed.todayMeals && parsed.todayMeals.date !== parsed.today)
    || parsed.cancellations.dates.some(day => !day.date.startsWith(`${parsed.month}-`))) invalid();
  if (parsed.menu) {
    const monday = new Date(`${parsed.menu.weekId}T00:00:00Z`);
    if (monday.getUTCDay() !== 1 || parsed.menu.days.length !== 5 || parsed.menu.days.some((day, index) =>
      day.date !== new Date(monday.getTime() + index * 86400000).toISOString().slice(0, 10))) invalid();
  }
  if (parsed.survey && (new Date(`${parsed.survey.weekId}T00:00:00Z`).getUTCDay() !== 1
    || new Set(parsed.survey.questions.map(q => q.id)).size !== parsed.survey.questions.length
    || Object.keys(parsed.survey.answers || {}).some(key => !parsed.survey?.questions.some(q => q.id === key)))) invalid();
  return parsed;
}

export function createMealBusinessClient(account: AccountLinkClient) {
  const save = async (action: string, token: string, fields: Record<string, unknown>, signal?: AbortSignal) => {
    const result = await account.business(action, token, fields, signal);
    if (result.saved !== true || (result.unchanged !== undefined && typeof result.unchanged !== 'boolean')) invalid();
    return { saved: true, unchanged: result.unchanged === true };
  };
  return {
    async snapshot(token: string, selectedMonth: string, weekId: string, signal?: AbortSignal) {
      const result = parseMealSnapshot(await account.business('meal.snapshot', token, { month: selectedMonth, weekId }, signal));
      if (result.month !== selectedMonth || result.history.month !== selectedMonth || (result.menu && result.menu.weekId !== weekId)) invalid();
      return result;
    },
    register: (token: string, selectedMonth: string, breakfast: boolean, lunch: boolean, signal?: AbortSignal) => save('meal.register', token, { month: selectedMonth, breakfast, lunch }, signal),
    cancel: (token: string, dates: string[], meal: 'breakfast' | 'lunch' | 'both', reason: string, canteen: 'tieuhoc' | 'trunghoc', signal?: AbortSignal) => save('meal.cancel', token, { dates, meal, reason, canteen }, signal),
    event: (token: string, eventId: string, choice: 'yes' | 'no', signal?: AbortSignal) => save('meal.event', token, { eventId, choice }, signal),
    survey: (token: string, weekId: string, answers: Record<string, string>, signal?: AbortSignal) => save('meal.survey', token, { weekId, answers }, signal),
  };
}

export const mealLabels: Record<MealCode, string> = { off_day: 'Ngày nghỉ / ăn sự kiện', excluded: 'Không tính đối soát', not_registered: 'Không đăng ký', extra: 'Có chấm, chưa đăng ký', invalid_id: 'Cần kiểm tra mã NV', ok: 'Đã chấm ăn', missing: 'Chưa có lượt chấm', pending: 'Chưa chốt dữ liệu' };
export const businessReason = (reason: string | null) => ({ registration_closed: 'Đã hết hạn đăng ký hoặc điều chỉnh cho tháng này.', registration_blocked: 'Tài khoản đang bị hạn chế đăng ký.', already_registered: 'Đơn tháng này đã được ghi nhận. Liên hệ bộ phận phụ trách nếu cần điều chỉnh.', cancellation_closed: 'Đã hết thời gian báo hủy bữa này.', not_registered: 'Chưa đăng ký bữa ăn này.', already_cancelled: 'Bữa này đã được báo hủy.', event_closed: 'Đã hết hạn đăng ký sự kiện.', already_responded: 'Lựa chọn sự kiện đã được ghi nhận.', survey_closed: 'Khảo sát chưa mở hoặc đã hết hạn trả lời.', profile_incomplete: 'Hồ sơ chưa đủ thông tin để đăng ký. Vui lòng cập nhật trên website.' } as Record<string, string>)[reason || ''] || 'Chức năng hiện chưa mở. Vui lòng xem thông tin trên website hoặc liên hệ bộ phận phụ trách.';
