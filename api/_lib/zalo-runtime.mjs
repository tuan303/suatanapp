// SERVER ONLY. No credentials, Firebase admin token or role is sent to Mini App.
import { createHash, createHmac } from 'node:crypto';
import { createAccountLinkService, AccountLinkError } from '../../miniapp/server/account-links.mjs';
import { verifyZaloIdentity, ZaloIdentityError } from '../../miniapp/server/verify-zalo-identity.mjs';
import { createMealBusinessService } from '../../miniapp/server/meal-business.mjs';
import { MEAL_ACTION_FIELDS } from '../../miniapp/shared/meal-contract.mjs';
import { readZaloMailConfig, inspectZaloMailEnv, createZaloMailer, reportZaloMailFailure } from './zalo-mail.mjs';

const PROJECT = 'dkan-4b061';
const SCHOOL_EMAIL = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@hoangmaistarschool\.edu\.vn$/i;
const UID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
const NUMERIC_ID = /^[1-9][0-9]{0,39}$/;
const PRIVATE_COLLECTIONS = new Set(['zalo_link_challenges', 'zalo_link_claims', 'zalo_link_sessions',
  'zalo_links', 'zalo_link_owners', 'zalo_link_rate_limits', 'zalo_link_otps', 'zalo_link_otp_limits']);
// OTP code hashes and send counters belong to the link service alone. Business
// transactions only need the session/link/owner guards, so they cannot read them.
const LINK_ONLY_COLLECTIONS = new Set(['zalo_link_otps', 'zalo_link_otp_limits']);
// Versioned label: changing it (or ZALO_APP_SECRET_KEY) invalidates every
// pending code at once, which is the intended way to rotate the OTP key.
const OTP_SECRET_LABEL = 'dkan-zalo-email-otp-v1';
const unavailable = () => { throw new AccountLinkError(503, 'service_unavailable'); };
const accountUnavailable = () => { throw new AccountLinkError(403, 'account_unavailable'); };
const accountNotFound = () => { throw new AccountLinkError(404, 'account_not_found'); };
const safeText = (value, limit) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';

/** One fixed log line, with no identity, token, request, body or secret. */
export function reportZaloVerificationFailure(error, report = console.warn) {
  if (!(error instanceof ZaloIdentityError)) return;
  const source = error.diagnostic;
  const stages = ['transport', 'http', 'provider', 'response', 'timeout'];
  const diagnostic = { stage: source && stages.includes(source.stage) ? source.stage
    : error.code === 'invalid_config' ? 'configuration' : error.code === 'invalid_token' ? 'token-input' : 'unknown' };
  if (source && Number.isSafeInteger(source.providerCode) && source.providerCode >= -99999 && source.providerCode <= 99999)
    diagnostic.providerCode = source.providerCode;
  if (source && Number.isInteger(source.httpStatus) && source.httpStatus >= 100 && source.httpStatus <= 599)
    diagnostic.httpStatus = source.httpStatus;
  if (source && ['ip_restricted', 'app_inactive', 'invalid_proof', 'invalid_token', 'unknown'].includes(source.providerReason))
    diagnostic.providerReason = source.providerReason;
  try { report(`DKAN_ZALO_VERIFY_FAILED ${JSON.stringify(diagnostic)}`); }
  catch { /* Diagnostics must never change authentication or expose the error. */ }
}

export function sanitizeSchoolProfile(staff, user) {
  return { fullName: safeText(staff?.fullName, 160) || safeText(user?.displayName, 160) || 'CBGV-NV',
    employeeId: safeText(staff?.employeeId, 40), department: safeText(staff?.department, 160),
    email: typeof user?.email === 'string' ? user.email.toLowerCase() : '' };
}

export function readZaloRuntimeConfig(env = {}) {
  if (env.DKAN_ZALO_ENABLED !== 'true') unavailable();
  const appId = env.ZALO_APP_ID, miniAppId = env.ZALO_MINI_APP_ID, appSecret = env.ZALO_APP_SECRET_KEY;
  if (typeof appId !== 'string' || !NUMERIC_ID.test(appId) || typeof miniAppId !== 'string' || !NUMERIC_ID.test(miniAppId)
    || typeof appSecret !== 'string' || appSecret.length < 16 || appSecret.length > 1024
    || /[^\x21-\x7e]/.test(appSecret) || /^(?:your|dien_|dan_|change|replace|placeholder)|[<>]|\$\{/i.test(appSecret)) unavailable();
  let credential;
  try { credential = JSON.parse(env.FIREBASE_ADMIN_CREDENTIALS_JSON || ''); } catch { unavailable(); }
  if (!credential || credential.type !== 'service_account' || credential.project_id !== PROJECT
    || typeof credential.client_email !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(credential.client_email)
    || typeof credential.private_key !== 'string' || !credential.private_key.startsWith('-----BEGIN PRIVATE KEY-----')
    || credential.private_key.length > 16_384) unavailable();
  return { appId, miniAppId, appSecret, credential };
}

function validateSchoolRecord(uid, user) {
  if (typeof uid !== 'string' || !UID.test(uid) || !user || user.uid !== uid || user.disabled === true
    || typeof user.email !== 'string' || !SCHOOL_EMAIL.test(user.email)
    || !Array.isArray(user.providerData) || !user.providerData.some(item => item?.providerId === 'microsoft.com')) accountUnavailable();
}

const emailVerificationRequired = () => { throw new AccountLinkError(403, 'email_verification_required'); };

/** Recheck the current Admin SDK account on every linked Mini App profile read. */
export function validateSchoolProfileAccount(uid, user) {
  validateSchoolRecord(uid, user);
  if (user.emailVerified !== true) emailVerificationRequired();
  return { uid, email: user.email.toLowerCase() };
}

/** Verified SDK records only. Refreshing a JWT must not replace recent auth_time. */
export function validateSchoolAccount(decoded, user, { requireRecent = false, nowMs = Date.now() } = {}) {
  validateSchoolRecord(decoded?.uid, user);
  if (typeof decoded.email !== 'string' || !SCHOOL_EMAIL.test(decoded.email)
    || user.email.toLowerCase() !== decoded.email.toLowerCase()
    || decoded.firebase?.sign_in_provider !== 'microsoft.com') accountUnavailable();
  // Microsoft sign-in for a school-owned domain does not automatically verify
  // its mailbox in Firebase. Keep the verification requirement and surface the
  // next step separately from a disabled, mismatched or non-school identity.
  if (user.emailVerified !== true || decoded.email_verified !== true) emailVerificationRequired();
  if (requireRecent && (!Number.isSafeInteger(decoded.auth_time) || decoded.auth_time * 1000 > nowMs + 60_000
    || nowMs - decoded.auth_time * 1000 > 10 * 60_000)) throw new AccountLinkError(403, 'recent_auth_required');
  return { uid: decoded.uid, email: user.email.toLowerCase() };
}

export function createFirestoreLinkStore(db) {
  const ref = path => {
    const parts = typeof path === 'string' ? path.split('/') : [];
    if (parts.length !== 2 || !PRIVATE_COLLECTIONS.has(parts[0]) || !/^[A-Za-z0-9_-]{1,220}$/.test(parts[1])) unavailable();
    return db.collection(parts[0]).doc(parts[1]);
  };
  const data = snapshot => snapshot.exists ? snapshot.data() : null;
  return {
    async get(path) { return data(await ref(path).get()); },
    runTransaction(callback) {
      return db.runTransaction(transaction => callback({
        async get(path) { return data(await transaction.get(ref(path))); },
        set(path, value) { transaction.set(ref(path), value); },
        delete(path) { transaction.delete(ref(path)); },
      }));
    },
  };
}

/** Business access is bound to one server-verified UID, including inside retries. */
export function createFirestoreMealStore(db, uid) {
  if (typeof uid !== 'string' || !UID.test(uid)) unavailable();
  const month = /^\d{4}-(?:0[1-9]|1[0-2])$/;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  const id = /^[A-Za-z0-9_-]{1,128}$/;
  const settings = new Set(['monthlyConfig', 'monthlyExpiry', 'cancelConfig', 'checkinSync', 'mealOffDays', 'reconcileExcludes']);
  const ownSuffix = value => typeof value === 'string' && value.startsWith(`${uid}_`) ? value.slice(uid.length + 1) : '';
  const allowed = (path, writing = false) => {
    const parts = typeof path === 'string' ? path.split('/') : [];
    if (parts.length === 2) {
      const [collection, key] = parts;
      if (!writing && PRIVATE_COLLECTIONS.has(collection) && !LINK_ONLY_COLLECTIONS.has(collection)
        && /^[A-Za-z0-9_-]{1,220}$/.test(key)) return true;
      if (!writing && collection === 'settings' && settings.has(key)) return true;
      if (!writing && collection === 'blocked_users' && month.test(key)) return true;
      if (!writing && collection === 'weekly_menus' && date.test(key)) return true;
      if (!writing && collection === 'events' && id.test(key)) return true;
      if (!writing && collection === 'meal_surveys' && date.test(key)) return true;
      if (collection === 'registrations' && month.test(ownSuffix(key))) return true;
      if (collection === 'cancel_registrations' && date.test(ownSuffix(key))) return true;
      if (collection === 'event_registrations' && id.test(ownSuffix(key))) return true;
    }
    return parts.length === 4 && ((parts[0] === 'meal_taps' && !writing && parts[1] === uid && parts[2] === 'months' && month.test(parts[3]))
      || (parts[0] === 'meal_surveys' && date.test(parts[1]) && parts[2] === 'responses' && parts[3] === uid));
  };
  const ref = (path, writing = false) => { if (!allowed(path, writing)) unavailable(); return db.doc(path); };
  return { runTransaction(callback) {
    return db.runTransaction(transaction => callback({
      async get(path) { const snapshot = await transaction.get(ref(path)); return snapshot.exists ? snapshot.data() : null; },
      async list(name, count) {
        const maximum = name === 'events' ? 20 : name === 'meal_surveys' ? 12 : 0;
        if (!Number.isInteger(count) || count < 1 || count > maximum) unavailable();
        const query = db.collection(name).orderBy(name === 'events' ? 'createdAt' : 'weekId', 'desc').limit(count);
        const snapshot = await transaction.get(query);
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      },
      set(path, value) {
        if (!value || typeof value !== 'object' || (path.startsWith('meal_surveys/') ? value.uid : value.userId) !== uid) unavailable();
        transaction.set(ref(path, true), value);
      },
    }));
  } };
}

/** No new secret env: a labelled HMAC of the Zalo app secret, never the secret itself. */
export function deriveZaloOtpSecret(appSecret) {
  if (typeof appSecret !== 'string' || appSecret.length < 16) return undefined;
  return createHmac('sha256', appSecret).update(OTP_SECRET_LABEL).digest('hex');
}

/** Admin SDK lookups for the e-mail OTP link; every answer is rechecked here. */
export function createSchoolAccountDirectory(auth, db) {
  return {
    async findSchoolAccountByEmail(email) {
      if (typeof email !== 'string' || email.length > 254 || !SCHOOL_EMAIL.test(email)) accountUnavailable();
      const normalized = email.toLowerCase();
      let user;
      try { user = await auth.getUserByEmail(normalized); }
      catch (error) {
        if (error?.code === 'auth/user-not-found') accountNotFound();
        // Never forward Auth text; the service turns this into service_unavailable.
        throw new Error('School account lookup failed.');
      }
      // Same record checks as every profile read: enabled, school domain and a
      // Microsoft sign-in. emailVerified is NOT required: the code proves it.
      validateSchoolRecord(user?.uid, user);
      if (user.email.toLowerCase() !== normalized) accountUnavailable();
      let staff = {};
      // The name only personalises the e-mail greeting; it never blocks a code.
      try { const snapshot = await db.collection('staff').doc(user.uid).get(); staff = snapshot.exists ? snapshot.data() : {}; }
      catch { staff = {}; }
      return { uid: user.uid, email: normalized, name: safeText(staff?.fullName, 160) || safeText(user.displayName, 160) };
    },
    // Called only after the mailbox code matched. Profile reads re-check
    // emailVerified, so the proven mailbox must be recorded in Firebase Auth.
    // An optional expected address refuses to verify an account whose e-mail
    // was changed between sending and entering the code.
    async markEmailVerified(uid, expectedEmail) {
      if (typeof uid !== 'string' || !UID.test(uid)) accountUnavailable();
      let user;
      try { user = await auth.getUser(uid); }
      catch (error) {
        if (error?.code === 'auth/user-not-found') accountUnavailable();
        throw new Error('School account lookup failed.');
      }
      validateSchoolRecord(uid, user);
      if (expectedEmail !== undefined && (typeof expectedEmail !== 'string'
        || user.email.toLowerCase() !== expectedEmail.toLowerCase())) accountUnavailable();
      if (user.emailVerified === true) return;
      try { await auth.updateUser(uid, { emailVerified: true }); }
      catch { throw new Error('School account update failed.'); }
    },
  };
}

/**
 * Optional e-mail OTP options for createAccountLinkService. Missing or invalid
 * MS_GRAPH_* settings only omit sendLinkEmail, so the service answers the two
 * OTP actions with email_link_unavailable; website linking, Zalo login and
 * meal actions keep starting exactly as before. This never throws.
 */
export function createZaloEmailLinkOptions(input = {}) {
  try {
    const { env = {}, appSecret, auth, db, fetchImpl, report = console.warn } = input;
    const options = { otpSecret: deriveZaloOtpSecret(appSecret), ...createSchoolAccountDirectory(auth, db) };
    let mailer = null;
    try {
      const mail = readZaloMailConfig(env);
      mailer = mail ? createZaloMailer(mail, fetchImpl ? { fetchImpl } : {}) : null;
    } catch { mailer = null; }
    if (!mailer) {
      // Variable names only, once per service build, so IT can see why.
      try { report(`DKAN_ZALO_MAIL_UNAVAILABLE ${JSON.stringify(inspectZaloMailEnv(env))}`); } catch { /* Logging is optional. */ }
      return options;
    }
    options.sendLinkEmail = async message => {
      try { await mailer.send(message); }
      catch (error) { reportZaloMailFailure(error, report); throw error; }
    };
    return options;
  } catch { return {}; }
}

export function createZaloBusinessDispatcher(links, db) {
  return { async run(action, body, bearer) {
    if (!Object.hasOwn(MEAL_ACTION_FIELDS, action)) return links.run(action, body, bearer);
    const identity = await links.authorizeMiniSession(bearer);
    const business = createMealBusinessService({ store: createFirestoreMealStore(db, identity.uid) });
    return business.run(action, body, identity);
  } };
}

let cachedFingerprint, cachedService;
export async function getLiveZaloService(env = process.env) {
  const config = readZaloRuntimeConfig(env);
  const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  // Mail settings change the service but not the Firebase app it opens.
  const serviceKey = createHash('sha256').update(JSON.stringify({ fingerprint, mail: readZaloMailConfig(env) })).digest('hex');
  if (cachedFingerprint === serviceKey && cachedService) return cachedService;
  cachedFingerprint = serviceKey;
  cachedService = (async () => {
    const [{ initializeApp, getApps, cert }, { getAuth }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'),
    ]);
    const appName = `dkan-zalo-${fingerprint.slice(0, 16)}`;
    const firebase = getApps().find(app => app.name === appName)
      || initializeApp({ credential: cert(config.credential), projectId: PROJECT }, appName);
    const auth = getAuth(firebase), db = getFirestore(firebase);
    const links = createAccountLinkService({
      appId: config.appId, miniAppId: config.miniAppId, store: createFirestoreLinkStore(db),
      async verifySchoolToken(token, options) {
        const decoded = await auth.verifyIdToken(token, true);
        const user = await auth.getUser(decoded.uid);
        return validateSchoolAccount(decoded, user, options);
      },
      async verifyZaloToken(token) {
        try { return await verifyZaloIdentity({ accessToken: token, appSecret: config.appSecret }); }
        catch (error) { reportZaloVerificationFailure(error); throw error; }
      },
      async getSchoolProfile(uid) {
        if (typeof uid !== 'string' || !UID.test(uid)) accountUnavailable();
        const user = await auth.getUser(uid);
        validateSchoolProfileAccount(uid, user);
        const snapshot = await db.collection('staff').doc(uid).get();
        const staff = snapshot.exists ? snapshot.data() : {};
        return sanitizeSchoolProfile(staff, user);
      },
      ...createZaloEmailLinkOptions({ env, appSecret: config.appSecret, auth, db }),
    });
    return createZaloBusinessDispatcher(links, db);
  })().catch(() => { cachedService = null; unavailable(); });
  return cachedService;
}
