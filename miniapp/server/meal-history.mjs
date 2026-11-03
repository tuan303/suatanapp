// Pure personal-history projection. Callers supply only the linked user's
// registration, cancellations and meal_taps document; never all-school taps.
import { isIsoDate } from '../../agent/lib/common.mjs';
import { evaluatePersonDay, mealDaysOfMonth, vnParts } from '../../agent/lib/meal-rules.mjs';

const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const UID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const count = value => ['number', 'string'].includes(typeof value) && Number.isFinite(Number(value)) && Number(value) > 0
  ? Math.min(1000, Number(value)) : 0;

// Agent timestamps include a timezone. Reject ambiguous local strings rather
// than interpreting them in the timezone of the API host.
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 64
    || !isIsoDate(value.slice(0, 10))
    || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function ownRegistration(value, month) {
  if (!record(value) || (value.month !== undefined && value.month !== month)) return null;
  const result = {
    employeeId: text(value.employeeId, 40),
    breakfastCount: count(value.breakfastCount),
    lunchCount: count(value.lunchCount),
  };
  if (typeof value.userId === 'string' && UID.test(value.userId)) result.userId = value.userId;
  if (isIsoDate(value.firstMealDate)) result.firstMealDate = value.firstMealDate;
  const at = timestamp(value.timestamp);
  if (at) result.timestamp = at;
  return result;
}

/**
 * Personal history using the same meal decisions as the web and HAC agent.
 * No implicit clock, Firebase access, identity lookup or untrusted metadata is
 * exposed. The caller authorizes ownership before supplying these documents.
 */
export function buildPersonalMealHistory({ month, today, now, registration, tapsDoc, cancelations = [], sync, offDays = [], excludedIds = [] }) {
  if (typeof month !== 'string' || !MONTH.test(month) || Number(month.slice(0, 4)) < 100 || !isIsoDate(`${month}-01`))
    throw new TypeError('Invalid history month');
  if (!isIsoDate(today)) throw new TypeError('Invalid history date');
  const clock = now instanceof Date ? new Date(now.getTime())
    : typeof now === 'string' ? new Date(timestamp(now) || NaN)
      : typeof now === 'number' ? new Date(now) : new Date(NaN);
  if (!Number.isFinite(clock.getTime())) throw new TypeError('Invalid history clock');
  // A caller's stale date cannot make future tap rows appear in the history.
  const until = [today, vnParts(clock).date].sort()[0];
  const rawTaps = record(tapsDoc) ? tapsDoc : {};
  const rawDays = record(rawTaps.days) ? rawTaps.days : {};
  const taps = {};
  for (const [date, times] of Object.entries(rawDays)) {
    if (!isIsoDate(date) || !date.startsWith(`${month}-`) || date > until || !Array.isArray(times)) continue;
    const clean = [...new Set(times.filter(time => typeof time === 'string' && TIME.test(time)))].sort();
    if (clean.length) taps[date] = clean;
  }
  const rawSync = record(sync) ? sync : {};
  const rawCoverage = record(rawSync.coverage) ? rawSync.coverage : {};
  const coverage = {};
  for (const [date, value] of Object.entries(rawCoverage)) {
    const at = timestamp(value);
    if (isIsoDate(date) && at && Date.parse(at) <= clock.getTime()) coverage[date] = at;
  }
  const closedFrom = Object.keys(coverage).sort()[0] || null;
  const held = record(rawSync.alerts) ? rawSync.alerts : {};
  const updatedAt = timestamp(rawTaps.updatedAt);
  const conflict = rawTaps.conflict === true;
  const conflictFrom = !conflict ? null : Object.hasOwn(rawTaps, 'conflictSince')
    ? isIsoDate(rawTaps.conflictSince) ? rawTaps.conflictSince : null
    : updatedAt ? vnParts(updatedAt).date : null;
  const off = Array.isArray(offDays) ? [...new Set(offDays.filter(isIsoDate))] : [];
  const excludes = Array.isArray(excludedIds) ? excludedIds.filter(id => typeof id === 'string' && id.length <= 40) : [];
  const reg = ownRegistration(registration, month);
  const cancels = Array.isArray(cancelations) ? cancelations.flatMap(cancel => {
    if (!record(cancel) || !isIsoDate(cancel.cancelDate) || !cancel.cancelDate.startsWith(`${month}-`)
      || !['breakfast', 'lunch', 'both'].includes(cancel.cancelMeal)
      || (cancel.userId !== undefined && cancel.userId !== null && cancel.userId !== ''
        && (typeof cancel.userId !== 'string' || !UID.test(cancel.userId)))) return [];
    const item = { cancelDate: cancel.cancelDate, cancelMeal: cancel.cancelMeal, employeeId: text(cancel.employeeId, 40) };
    if (typeof cancel.userId === 'string' && UID.test(cancel.userId)) item.userId = cancel.userId;
    return [item];
  }) : [];
  const dates = [...new Set([...mealDaysOfMonth(month, off, until), ...Object.keys(taps)])].sort().reverse();
  return { month, updatedAt, closedFrom, conflict, days: dates.map(date => {
    const hold = conflict && (!conflictFrom || date >= conflictFrom) ? 'conflict'
      : record(held[date]) && held[date].held === true ? 'guarded'
        : !coverage[date] && closedFrom && date < closedFrom ? 'expired' : null;
    const result = evaluatePersonDay({ date, registration: reg, cancelations: cancels,
      times: taps[date] || [], offDays: off, excludedIds: excludes,
      coverageAt: hold === 'conflict' || hold === 'guarded' ? null : coverage[date] || null, now: clock });
    // Bound display-only outside-window details after every tap has contributed
    // to meal classification, so truncation cannot create a false missing meal.
    return { date, hold, result: { ...result, unrecognized: result.unrecognized.slice(0, 20),
      unrecognizedCount: result.unrecognized.length } };
  }) };
}
