// SERVER ONLY. Identity is supplied by the verified, revocable Mini App session.
import { AccountLinkError } from './account-links.mjs';
import { MEAL_ACTION_FIELDS, MEAL_ERROR_STATUS } from '../shared/meal-contract.mjs';
import { isIsoDate, monthDates, addDays } from '../../agent/lib/common.mjs';
import { isMealDay, isWeekday, normalizeRegistration, registrationEffectiveFrom, vnParts } from '../../agent/lib/meal-rules.mjs';
import { isWeekId, isSurveyOpen, toMillis, validateSurveyAnswers, SURVEY_QUESTIONS, SURVEY_VERSION } from '../../agent/lib/survey.mjs';
import { normalizeWeeklyMenu, hasMenuContent } from '../../agent/lib/weekly-menu.mjs';
import { buildPersonalMealHistory } from './meal-history.mjs';

const fail = code => { throw new AccountLinkError(MEAL_ERROR_STATUS[code] || (code === 'invalid_request' ? 400 : 503), code); };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
const realMonth = value => typeof value === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(value) && isIsoDate(`${value}-01`);
const eventId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

/** Admin datetime-local values are Vietnam wall time, regardless of the VPS timezone. */
export function mealDeadlineMillis(value) {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) {
      if (!isIsoDate(value.slice(0, 10)) || !/T(?:[01]\d|2[0-3]):[0-5]\d/.test(value)) return null;
      const milliseconds = Date.parse(`${value}+07:00`);
      return Number.isFinite(milliseconds) ? milliseconds : null;
    }
    if (!isIsoDate(value.slice(0, 10))
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return null;
  }
  const milliseconds = toMillis(value);
  return typeof milliseconds === 'number' && Number.isFinite(milliseconds) ? milliseconds : null;
}
const isoTime = value => { const millis = mealDeadlineMillis(value); return millis === null ? null : new Date(millis).toISOString(); };
export function mealMonthOptions(today) {
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  return [-2, -1, 0, 1].map(offset => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)).toISOString().slice(0, 7));
}
function completeProfile(profile) {
  return !!text(profile?.fullName, 160) && /^10\d{4}$/.test(profile?.employeeId || '') && !!text(profile?.department, 160);
}
function owned(record, uid, field = 'userId') {
  if (record && record[field] !== uid) fail('service_unavailable');
  return record;
}
function metadata(identity) {
  return { userId: identity.uid, fullName: identity.profile.fullName, employeeId: identity.profile.employeeId,
    department: identity.profile.department, email: identity.profile.email };
}
function registrationView(record, month) {
  if (!record) return null;
  const normalized = normalizeRegistration(record);
  const effective = registrationEffectiveFrom(normalized);
  return { month, breakfastCount: Math.max(0, normalized.breakfastCount || 0), lunchCount: Math.max(0, normalized.lunchCount || 0),
    firstMealDate: isIsoDate(effective) ? effective : `${month}-01`, timestamp: isoTime(record.timestamp) };
}
function registrationPolicy({ month, today, at, monthly, expiry, blocked, record, profile }) {
  const firstMealDate = month === today.slice(0, 7) ? today : `${month}-01`;
  const weekdays = monthDates(month).filter(date => date >= firstMealDate && isWeekday(date)).length;
  const rawDeadline = expiry?.[month.slice(5)], deadlineMs = mealDeadlineMillis(rawDeadline);
  let lockedReason = null;
  if (record) lockedReason = 'already_registered';
  else if (!completeProfile(profile)) lockedReason = 'profile_incomplete';
  else if (strings(blocked?.emails).some(email => email.trim().toLowerCase() === profile.email.toLowerCase())) lockedReason = 'registration_blocked';
  else if (month < today.slice(0, 7) || monthly?.[month.slice(5)] !== true || !weekdays
    || (rawDeadline && (deadlineMs === null || at >= deadlineMs))) lockedReason = 'registration_closed';
  return { record: registrationView(record, month), allowed: !lockedReason, lockedReason,
    deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(), firstMealDate, weekdays };
}
function earliestCancellation(today, at, config) {
  const extension = mealDeadlineMillis(config?.extendUntil);
  const beforeCutoff = (vnParts(new Date(at))?.time || '23:59') < '16:00';
  return { earliestDate: addDays(today, beforeCutoff || (extension !== null && at < extension) ? 1 : 2),
    extendedUntil: extension === null ? null : new Date(extension).toISOString() };
}
function canCancelMeal(record, date, meal, offDays) {
  if (!record || !isMealDay(date, offDays)) return false;
  const normalized = normalizeRegistration(record), effective = registrationEffectiveFrom(normalized);
  if (effective && date < effective) return false;
  return (meal !== 'lunch' ? normalized.breakfastCount > 0 : true) && (meal !== 'breakfast' ? normalized.lunchCount > 0 : true);
}
function chooseSurvey(rows, at) {
  const valid = rows.filter(row => isWeekId(row.id));
  return valid.find(row => row.email?.status !== 'skipped' && isSurveyOpen(row, new Date(at)))
    || valid.filter(row => (toMillis(row.opensAt) ?? -1) > at).sort((a, b) => toMillis(a.opensAt) - toMillis(b.opensAt))[0]
    || valid[0] || null;
}
const menuView = (record, weekId) => {
  if (!record) return null;
  try { const normalized = normalizeWeeklyMenu(record, weekId); return hasMenuContent(normalized) ? normalized : null; }
  catch { return null; }
};

export function createMealBusinessService({ store, now = Date.now } = {}) {
  if (!store || typeof store.runTransaction !== 'function' || typeof now !== 'function') fail('service_unavailable');
  const clock = () => { const at = now(); if (!Number.isSafeInteger(at) || at < 0) fail('service_unavailable'); return at; };
  const context = at => { const today = vnParts(new Date(at))?.date; if (!today) fail('service_unavailable'); return { today, months: mealMonthOptions(today) }; };
  const checkMonth = (month, months) => { if (!realMonth(month) || !months.includes(month)) fail('invalid_request'); };
  const privateGuard = (identity, tx) => identity.assertCurrent(path => tx.get(path));

  async function snapshot(body, identity) {
    const started = clock(), { today, months } = context(started), month = body.month, weekId = body.weekId;
    checkMonth(month, months);
    if (!isIsoDate(weekId) || !isWeekId(weekId)) fail('invalid_request');
    return store.runTransaction(async tx => {
      await privateGuard(identity, tx);
      const uid = identity.uid, currentMonth = today.slice(0, 7);
      const [monthly, expiry, cancelConfig, sync, off, excluded, blocked, registration, tapsDoc, rawMenu, eventRows, surveyRows] = await Promise.all([
        tx.get('settings/monthlyConfig'), tx.get('settings/monthlyExpiry'), tx.get('settings/cancelConfig'),
        tx.get('settings/checkinSync'), tx.get('settings/mealOffDays'), tx.get('settings/reconcileExcludes'),
        tx.get(`blocked_users/${month}`), tx.get(`registrations/${uid}_${month}`),
        tx.get(`meal_taps/${uid}/months/${month}`), tx.get(`weekly_menus/${weekId}`),
        tx.list('events', 20), tx.list('meal_surveys', 12),
      ]);
      owned(registration, uid);
      const cancelDates = [...new Set([...monthDates(month), ...monthDates(currentMonth)])];
      const [cancels, eventRegistrations, currentRegistration, currentTaps] = await Promise.all([
        Promise.all(cancelDates.map(async date => owned(await tx.get(`cancel_registrations/${uid}_${date}`), uid))).then(rows => rows.filter(Boolean)),
        Promise.all(eventRows.map(async event => eventId(event.id) ? owned(await tx.get(`event_registrations/${uid}_${event.id}`), uid) : null)),
        month === currentMonth ? registration : tx.get(`registrations/${uid}_${currentMonth}`),
        month === currentMonth ? tapsDoc : tx.get(`meal_taps/${uid}/months/${currentMonth}`),
      ]);
      owned(currentRegistration, uid);
      const selectedSurvey = chooseSurvey(surveyRows, started);
      const response = selectedSurvey ? owned(await tx.get(`meal_surveys/${selectedSurvey.id}/responses/${uid}`), uid, 'uid') : null;
      await privateGuard(identity, tx);
      const at = clock(), fresh = context(at);
      if (fresh.today !== today) fail('service_unavailable'); // A midnight rollover needs a fresh snapshot.
      const offDays = strings(off?.dates).filter(isIsoDate);
      const historyArgs = { today, now: new Date(at), cancelations: cancels, sync, offDays, excludedIds: strings(excluded?.employeeIds) };
      const history = buildPersonalMealHistory({ ...historyArgs, month, registration, tapsDoc });
      const todayHistory = month === currentMonth ? history : buildPersonalMealHistory({ ...historyArgs, month: currentMonth, registration: currentRegistration, tapsDoc: currentTaps });
      const cutoff = earliestCancellation(today, at, cancelConfig);
      const events = eventRows.filter(event => eventId(event.id)).map(event => {
        const existing = eventRegistrations.find(record => record?.eventId === event.id);
        const deadlineMs = mealDeadlineMillis(event.expiresAt);
        const reason = existing ? 'already_responded' : !completeProfile(identity.profile) ? 'profile_incomplete'
          : event.isOpen !== true || (event.expiresAt && (deadlineMs === null || at >= deadlineMs)) ? 'event_closed' : null;
        return { id: event.id, name: text(event.name, 200), deadline: deadlineMs === null ? null : new Date(deadlineMs).toISOString(),
          allowed: !reason, choice: ['yes', 'no'].includes(existing?.choice) ? existing.choice : null, lockedReason: reason };
      });
      const survey = selectedSurvey ? {
        weekId: selectedSurvey.id, opensAt: toMillis(selectedSurvey.opensAt), closesAt: toMillis(selectedSurvey.closesAt),
        allowed: completeProfile(identity.profile) && selectedSurvey.email?.status !== 'skipped' && isSurveyOpen(selectedSurvey, new Date(at)),
        skipped: selectedSurvey.email?.status === 'skipped', questions: SURVEY_QUESTIONS,
        answers: response ? validateSurveyAnswers(response.answers).clean : null,
        submittedAt: isoTime(response?.submittedAt), updatedAt: isoTime(response?.updatedAt),
      } : null;
      return { version: 1, serverNow: at, today, month, monthOptions: months, profile: identity.profile,
        registration: registrationPolicy({ month, today, at, monthly, expiry, blocked, record: registration, profile: identity.profile }),
        cancellations: { ...cutoff, records: cancels.filter(record => record.cancelDate?.startsWith(`${month}-`)).map(record => ({
          date: record.cancelDate, meal: ['breakfast', 'lunch', 'both'].includes(record.cancelMeal) ? record.cancelMeal : 'both',
          reason: text(record.cancelReason, 200), canteen: ['tieuhoc', 'trunghoc'].includes(record.cancelCanteen) ? record.cancelCanteen : 'tieuhoc', timestamp: isoTime(record.timestamp),
        })), dates: monthDates(month).filter(date => date >= cutoff.earliestDate && canCancelMeal(registration, date, 'lunch', offDays)).map(date => ({
          date, breakfast: canCancelMeal(registration, date, 'breakfast', offDays), lunch: canCancelMeal(registration, date, 'lunch', offDays),
          existing: cancels.some(record => record.cancelDate === date),
        })) },
        menu: menuView(rawMenu, weekId), history, todayMeals: todayHistory.days.find(day => day.date === today) || null, events, survey,
        sync: { lastRunAt: isoTime(sync?.lastRunAt), lastCompleteAt: isoTime(sync?.lastCompleteAt),
          lastRunComplete: typeof sync?.lastRunComplete === 'boolean' ? sync.lastRunComplete : null },
      };
    });
  }

  async function register(body, identity) {
    if (typeof body.breakfast !== 'boolean' || typeof body.lunch !== 'boolean' || !body.lunch) fail('invalid_request');
    const { today, months } = context(clock()); checkMonth(body.month, months);
    return store.runTransaction(async tx => {
      await privateGuard(identity, tx);
      const path = `registrations/${identity.uid}_${body.month}`;
      const [monthly, expiry, blocked, record] = await Promise.all([tx.get('settings/monthlyConfig'), tx.get('settings/monthlyExpiry'), tx.get(`blocked_users/${body.month}`), tx.get(path)]);
      owned(record, identity.uid);
      await privateGuard(identity, tx);
      const at = clock(); if (context(at).today !== today) fail('registration_closed');
      if (record) {
        const reg = normalizeRegistration(record);
        if ((reg.breakfastCount > 0) === body.breakfast && (reg.lunchCount > 0) === body.lunch) return { saved: true, unchanged: true };
        fail('already_registered');
      }
      const policy = registrationPolicy({ month: body.month, today, at, monthly, expiry, blocked, record, profile: identity.profile });
      if (!policy.allowed) fail(policy.lockedReason);
      tx.set(path, { ...metadata(identity), month: body.month, breakfastCount: body.breakfast ? policy.weekdays : 0,
        lunchCount: policy.weekdays, firstMealDate: policy.firstMealDate, weekdaysCounted: policy.weekdays,
        fullMonthWeekdays: monthDates(body.month).filter(isWeekday).length, timestamp: new Date(at).toISOString() });
      return { saved: true };
    });
  }

  async function cancel(body, identity) {
    if (!Array.isArray(body.dates) || body.dates.length < 1 || body.dates.length > 31 || !body.dates.every(isIsoDate)
      || new Set(body.dates).size !== body.dates.length || !['breakfast', 'lunch', 'both'].includes(body.meal)
      || !['tieuhoc', 'trunghoc'].includes(body.canteen) || typeof body.reason !== 'string' || !body.reason.trim()
      || body.reason.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(body.reason)) fail('invalid_request');
    const initial = context(clock()); for (const date of body.dates) checkMonth(date.slice(0, 7), initial.months);
    return store.runTransaction(async tx => {
      await privateGuard(identity, tx);
      const months = [...new Set(body.dates.map(date => date.slice(0, 7)))];
      const [config, off, registrations, existing] = await Promise.all([tx.get('settings/cancelConfig'), tx.get('settings/mealOffDays'),
        Promise.all(months.map(async month => [month, owned(await tx.get(`registrations/${identity.uid}_${month}`), identity.uid)])),
        Promise.all(body.dates.map(async date => owned(await tx.get(`cancel_registrations/${identity.uid}_${date}`), identity.uid))),
      ]);
      await privateGuard(identity, tx);
      const at = clock(), { today } = context(at), cutoff = earliestCancellation(today, at, config), regs = new Map(registrations);
      const reason = body.reason.trim();
      for (let index = 0; index < body.dates.length; index++) {
        const date = body.dates[index];
        // A committed request can be retried after the cutoff without creating
        // a second cancellation or reporting that the original write failed.
        if (existing[index]) {
          if (existing[index].cancelMeal !== body.meal || existing[index].cancelReason !== reason || existing[index].cancelCanteen !== body.canteen) fail('already_cancelled');
          continue;
        }
        if (!completeProfile(identity.profile)) fail('profile_incomplete');
        if (date < cutoff.earliestDate) fail('cancellation_closed');
        if (!canCancelMeal(regs.get(date.slice(0, 7)), date, body.meal, strings(off?.dates))) fail('not_registered');
      }
      for (let index = 0; index < body.dates.length; index++) if (!existing[index]) {
        const date = body.dates[index];
        tx.set(`cancel_registrations/${identity.uid}_${date}`, { ...metadata(identity), cancelDate: date,
          formattedDate: `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`, cancelMeal: body.meal,
          cancelReason: reason, cancelCanteen: body.canteen, timestamp: new Date(at).toISOString() });
      }
      return { saved: true, ...(existing.every(Boolean) ? { unchanged: true } : {}) };
    });
  }

  async function event(body, identity) {
    if (!eventId(body.eventId) || !['yes', 'no'].includes(body.choice)) fail('invalid_request');
    return store.runTransaction(async tx => {
      await privateGuard(identity, tx);
      const path = `event_registrations/${identity.uid}_${body.eventId}`;
      const [event, record] = await Promise.all([tx.get(`events/${body.eventId}`), tx.get(path)]);
      owned(record, identity.uid); await privateGuard(identity, tx);
      const at = clock(), deadline = mealDeadlineMillis(event?.expiresAt);
      if (!completeProfile(identity.profile)) fail('profile_incomplete');
      if (record) { if (record.choice === body.choice) return { saved: true, unchanged: true }; fail('already_responded'); }
      if (!event || event.isOpen !== true || (event.expiresAt && (deadline === null || at >= deadline))) fail('event_closed');
      tx.set(path, { ...metadata(identity), eventId: body.eventId, eventName: text(event.name, 200), choice: body.choice, timestamp: new Date(at).toISOString() });
      return { saved: true };
    });
  }

  async function survey(body, identity) {
    if (!isIsoDate(body.weekId) || !isWeekId(body.weekId) || !object(body.answers)
      || Object.keys(body.answers).some(key => !SURVEY_QUESTIONS.some(question => question.id === key))) fail('invalid_request');
    const validation = validateSurveyAnswers(body.answers);
    if (!validation.ok) fail('invalid_request');
    return store.runTransaction(async tx => {
      await privateGuard(identity, tx);
      const path = `meal_surveys/${body.weekId}/responses/${identity.uid}`;
      const [week, existing] = await Promise.all([tx.get(`meal_surveys/${body.weekId}`), tx.get(path)]);
      owned(existing, identity.uid, 'uid'); await privateGuard(identity, tx);
      const at = clock();
      if (!completeProfile(identity.profile)) fail('profile_incomplete');
      if (!week || week.email?.status === 'skipped' || !isSurveyOpen(week, new Date(at))) fail('survey_closed');
      const { userId: _userId, ...profile } = metadata(identity);
      tx.set(path, { ...profile, uid: identity.uid, weekId: body.weekId, version: SURVEY_VERSION, answers: validation.clean,
        submittedAt: isoTime(existing?.submittedAt) || new Date(at).toISOString(), updatedAt: new Date(at).toISOString() });
      return { saved: true };
    });
  }

  return { async run(action, body, identity) {
    if (!Object.hasOwn(MEAL_ACTION_FIELDS, action) || !object(body)
      || Object.keys(body).length !== MEAL_ACTION_FIELDS[action].length || MEAL_ACTION_FIELDS[action].some(key => !Object.hasOwn(body, key))) fail('invalid_request');
    if (!identity || typeof identity.uid !== 'string' || !/^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/.test(identity.uid)
      || !object(identity.profile) || typeof identity.assertCurrent !== 'function') fail('service_unavailable');
    try {
      const result = await ({ 'meal.snapshot': snapshot, 'meal.register': register, 'meal.cancel': cancel, 'meal.event': event, 'meal.survey': survey })[action](body, identity);
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 131072) fail('service_unavailable');
      return result;
    } catch (error) { if (error instanceof AccountLinkError) throw error; fail('service_unavailable'); }
  } };
}
