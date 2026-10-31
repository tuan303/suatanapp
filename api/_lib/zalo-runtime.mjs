// SERVER ONLY. No credentials, Firebase admin token or role is sent to Mini App.
import { createHash } from 'node:crypto';
import { createAccountLinkService, AccountLinkError } from '../../miniapp/server/account-links.mjs';
import { verifyZaloIdentity, ZaloIdentityError } from '../../miniapp/server/verify-zalo-identity.mjs';

const PROJECT = 'dkan-4b061';
const SCHOOL_EMAIL = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@hoangmaistarschool\.edu\.vn$/i;
const UID = /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/;
const NUMERIC_ID = /^[1-9][0-9]{0,39}$/;
const PRIVATE_COLLECTIONS = new Set(['zalo_link_challenges', 'zalo_link_claims', 'zalo_link_sessions',
  'zalo_links', 'zalo_link_owners', 'zalo_link_rate_limits']);
const unavailable = () => { throw new AccountLinkError(503, 'service_unavailable'); };
const accountUnavailable = () => { throw new AccountLinkError(403, 'account_unavailable'); };
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

/** Verified SDK records only. Refreshing a JWT must not replace recent auth_time. */
export function validateSchoolAccount(decoded, user, { requireRecent = false, nowMs = Date.now() } = {}) {
  if (!decoded || !user || !UID.test(decoded.uid || '') || user.uid !== decoded.uid
    || user.disabled === true || user.emailVerified !== true || decoded.email_verified !== true
    || typeof decoded.email !== 'string' || !SCHOOL_EMAIL.test(decoded.email)
    || typeof user.email !== 'string' || user.email.toLowerCase() !== decoded.email.toLowerCase()
    || decoded.firebase?.sign_in_provider !== 'microsoft.com'
    || !Array.isArray(user.providerData) || !user.providerData.some(item => item.providerId === 'microsoft.com')) accountUnavailable();
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

let cachedFingerprint, cachedService;
export async function getLiveZaloService(env = process.env) {
  const config = readZaloRuntimeConfig(env);
  const fingerprint = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  if (cachedFingerprint === fingerprint && cachedService) return cachedService;
  cachedFingerprint = fingerprint;
  cachedService = (async () => {
    const [{ initializeApp, getApps, cert }, { getAuth }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/auth'), import('firebase-admin/firestore'),
    ]);
    const appName = `dkan-zalo-${fingerprint.slice(0, 16)}`;
    const firebase = getApps().find(app => app.name === appName)
      || initializeApp({ credential: cert(config.credential), projectId: PROJECT }, appName);
    const auth = getAuth(firebase), db = getFirestore(firebase);
    return createAccountLinkService({
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
        if (!UID.test(uid)) accountUnavailable();
        const user = await auth.getUser(uid);
        if (user.disabled || !user.emailVerified || !SCHOOL_EMAIL.test(user.email || '')
          || !user.providerData.some(provider => provider.providerId === 'microsoft.com')) accountUnavailable();
        const snapshot = await db.collection('staff').doc(uid).get();
        const staff = snapshot.exists ? snapshot.data() : {};
        return sanitizeSchoolProfile(staff, user);
      },
    });
  })().catch(() => { cachedService = null; unavailable(); });
  return cachedService;
}
