// Public RPC contract only. No credentials, identity selectors or admin actions.
export const MEAL_ACTION_FIELDS = Object.freeze({
  'meal.snapshot': Object.freeze(['month', 'weekId']),
  'meal.register': Object.freeze(['month', 'breakfast', 'lunch']),
  'meal.cancel': Object.freeze(['dates', 'meal', 'reason', 'canteen']),
  'meal.event': Object.freeze(['eventId', 'choice']),
  'meal.survey': Object.freeze(['weekId', 'answers']),
});

export const MEAL_ERROR_STATUS = Object.freeze({
  profile_incomplete: 403,
  registration_closed: 409,
  registration_blocked: 403,
  already_registered: 409,
  cancellation_closed: 409,
  not_registered: 409,
  already_cancelled: 409,
  event_closed: 409,
  already_responded: 409,
  survey_closed: 409,
});
