/** SERVER ONLY: links verified school/Zalo identities; never issues Firebase or admin tokens. */
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { ZaloIdentityError } from './verify-zalo-identity.mjs';
import { MEAL_ERROR_STATUS } from '../shared/meal-contract.mjs';

const FIVE_MINUTES = 5 * 60_000;
const TEN_MINUTES = 10 * 60_000;
const EIGHT_HOURS = 8 * 60 * 60_000;
const ONE_MINUTE = 60_000;
const ONE_HOUR = 60 * 60_000;
const ONE_DAY = 24 * ONE_HOUR;
const OTP_SENDS_PER_HOUR = 5;
// The daily caps bound every stored list, so documents stay small.
const OTP_SENDS_PER_DAY = 10;
const OTP_ATTEMPTS = 5;
// Wrong codes per school account per rolling day, across every Zalo user.
const OTP_FAILS_PER_DAY = 10;
// Upper bound on holding a verified reply for the "linked" notice mail.
const NOTICE_WAIT_MS = 2_000;
const SCHOOL_DOMAIN = '@hoangmaistarschool.edu.vn';
const ERRORS = Object.freeze({
  invalid_config: [500, 'Dịch vụ liên kết tài khoản chưa được cấu hình đúng.'],
  invalid_action: [400, 'Thao tác liên kết tài khoản không hợp lệ.'],
  invalid_request: [400, 'Thông tin yêu cầu không hợp lệ.'],
  unauthenticated: [401, 'Vui lòng đăng nhập lại để tiếp tục.'],
  recent_auth_required: [403, 'Vui lòng xác thực lại tài khoản nhà trường trước khi tiếp tục.'],
  email_verification_required: [403, 'Vui lòng xác minh địa chỉ email nhà trường trước khi liên kết Zalo.'],
  account_unavailable: [403, 'Tài khoản nhà trường hiện không thể sử dụng.'],
  challenge_unavailable: [409, 'Yêu cầu liên kết không còn khả dụng. Vui lòng tạo mã mới.'],
  link_conflict: [409, 'Tài khoản đã có liên kết khác. Vui lòng kiểm tra hoặc hủy liên kết của chính mình.'],
  rate_limited: [429, 'Bạn đã tạo quá nhiều mã liên kết. Vui lòng thử lại sau.'],
  session_expired: [401, 'Phiên Mini App đã hết hạn. Vui lòng đăng nhập lại.'],
  service_unavailable: [503, 'Chưa thể xử lý liên kết tài khoản. Vui lòng thử lại sau.'],
  otp_invalid: [422, 'Mã xác minh chưa đúng. Thầy/Cô kiểm tra lại mã trong thư.'],
  otp_expired: [410, 'Mã xác minh đã hết hạn hoặc nhập sai quá nhiều lần. Vui lòng gửi mã mới.'],
  account_not_found: [404, 'Chưa có tài khoản Suất ăn cho email này. Thầy/Cô đăng nhập website suất ăn của trường một lần bằng tài khoản Microsoft, rồi thử lại.'],
  email_link_unavailable: [503, 'Liên kết bằng email chưa được bật trên máy chủ. Vui lòng liên hệ bộ phận CNTT.'],
  profile_incomplete: [MEAL_ERROR_STATUS.profile_incomplete, 'Hồ sơ nhà trường chưa đủ thông tin để sử dụng suất ăn. Vui lòng liên hệ quản trị.'],
  registration_closed: [MEAL_ERROR_STATUS.registration_closed, 'Đã hết thời gian đăng ký suất ăn tháng này.'],
  registration_blocked: [MEAL_ERROR_STATUS.registration_blocked, 'Tài khoản đang bị hạn chế đăng ký suất ăn trong tháng này.'],
  already_registered: [MEAL_ERROR_STATUS.already_registered, 'Thầy/Cô đã đăng ký suất ăn tháng này. Vui lòng tải lại dữ liệu.'],
  cancellation_closed: [MEAL_ERROR_STATUS.cancellation_closed, 'Đã hết thời gian hủy suất ăn đã chọn.'],
  not_registered: [MEAL_ERROR_STATUS.not_registered, 'Không có suất ăn đã đăng ký phù hợp để hủy.'],
  already_cancelled: [MEAL_ERROR_STATUS.already_cancelled, 'Suất ăn đã được hủy trước đó. Vui lòng tải lại dữ liệu.'],
  event_closed: [MEAL_ERROR_STATUS.event_closed, 'Sự kiện không còn mở đăng ký suất ăn.'],
  already_responded: [MEAL_ERROR_STATUS.already_responded, 'Thầy/Cô đã gửi phản hồi trước đó. Vui lòng tải lại dữ liệu.'],
  survey_closed: [MEAL_ERROR_STATUS.survey_closed, 'Khảo sát hiện chưa mở hoặc đã hết thời gian trả lời.'],
});
const publicErrors = new WeakMap();

export class AccountLinkError extends Error {
  constructor(status, code) {
    const selected = Object.hasOwn(ERRORS, code) ? code : 'service_unavailable';
    super(ERRORS[selected][1]);
    this.name = 'AccountLinkError';
    this.status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : ERRORS[selected][0];
    this.code = selected;
    publicErrors.set(this, selected);
  }
}

const fail = code => { throw new AccountLinkError(ERRORS[code][0], code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const ascii = (value, maximum) => typeof value === 'string' && value.length > 0
  && value.length <= maximum && !/[^\x21-\x7e]/.test(value);
const uidValid = value => ascii(value, 128) && /^[A-Za-z0-9_-]+$/.test(value) && !/^__.*__$/.test(value);
const numericId = value => ascii(value, 40) && /^[1-9][0-9]*$/.test(value);
const challengeIdValid = value => typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/.test(value);
const codeValid = value => typeof value === 'string' && value.length === 24 && /^[A-Za-z0-9_-]+$/.test(value);
const tokenValid = value => typeof value === 'string' && value.length === 43 && /^[A-Za-z0-9_-]+$/.test(value);
const timeValid = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const versionValid = value => typeof value === 'string' && value.length === 32 && /^[a-f0-9]+$/.test(value);
const schoolEmail = value => typeof value === 'string' && value.length <= 254
  && /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@hoangmaistarschool\.edu\.vn$/i.test(value);
const text = (value, limit) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
// Teachers usually type only the part before "@"; the school domain is the
// only mailbox that can prove ownership of a school account.
const normalizeEmail = value => {
  if (typeof value !== 'string' || value.length > 254) return null;
  const trimmed = value.trim().toLowerCase(), email = trimmed.includes('@') ? trimmed : `${trimmed}${SCHOOL_DOMAIN}`;
  return schoolEmail(email) ? email : null;
};
const maskEmail = email => {
  const at = email.lastIndexOf('@'), local = email.slice(0, at);
  return `${local[0]}***${local.length > 2 ? local.at(-1) : ''}${email.slice(at)}`;
};
const otpCodeValid = value => typeof value === 'string' && /^\d{6}$/.test(value);
const timesValid = (value, maximum) => Array.isArray(value) && value.length <= maximum
  && value.every((at, index) => timeValid(at) && (index === 0 || at >= value[index - 1]));
const sendsValid = value => timesValid(value, OTP_SENDS_PER_DAY);
// Optional: a limit document written before the wrong-code cap has none.
const failsValid = value => value === undefined || timesValid(value, OTP_FAILS_PER_DAY);
const fields = Object.freeze({
  'web.createChallenge': [], 'web.challengeStatus': ['challengeId'], 'web.confirmLink': ['challengeId'],
  'web.getLink': [], 'web.revokeLink': [], 'mini.login': [], 'mini.claim': ['code'],
  'mini.claimStatus': [], 'mini.me': [], 'mini.logout': [], 'mini.requestOtp': ['email'], 'mini.verifyOtp': ['code'],
});

/**
 * Store methods receive exact document paths and plain data only. Firestore
 * adapters must implement atomic runTransaction; every transaction reads all
 * documents before writing any. No raw code, email OTP, claim token or session
 * is stored.
 */
export function createAccountLinkService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('invalid_config');
  const { store, verifySchoolToken, verifyZaloToken, getSchoolProfile,
    now = () => Date.now(), appId, miniAppId,
    findSchoolAccountByEmail, markEmailVerified, sendLinkEmail, otpSecret } = options;
  if (!numericId(appId) || !numericId(miniAppId) || !store || typeof store.get !== 'function'
    || typeof store.runTransaction !== 'function' || typeof verifySchoolToken !== 'function'
    || typeof verifyZaloToken !== 'function' || typeof getSchoolProfile !== 'function' || typeof now !== 'function') {
    fail('invalid_config');
  }
  // Email OTP is optional: without all four dependencies only the two OTP
  // actions are disabled, so web/QR linking and meal sessions keep working.
  const emailLinkReady = typeof findSchoolAccountByEmail === 'function' && typeof markEmailVerified === 'function'
    && typeof sendLinkEmail === 'function' && typeof otpSecret === 'string' && otpSecret.length >= 32 && otpSecret.length <= 4096;
  const path = {
    challenge: id => `zalo_link_challenges/${id}`,
    claim: id => `zalo_link_claims/${id}`,
    session: id => `zalo_link_sessions/${id}`,
    link: id => `zalo_links/${appId}_${id}`,
    owner: uid => `zalo_link_owners/${appId}_${uid}`,
    rate: uid => `zalo_link_rate_limits/${appId}_${uid}`,
    otp: id => `zalo_link_otps/${appId}_${id}`,
    otpLimit: uid => `zalo_link_otp_limits/${appId}_${uid}`,
  };
  const clock = () => { const value = now(); if (!timeValid(value)) fail('service_unavailable'); return value; };
  const scope = value => !!value && typeof value === 'object' && value.appId === appId && value.miniAppId === miniAppId;
  const identityLink = (value, uid, zaloId) => scope(value) && value.uid === uid && value.zaloUserId === zaloId
    && uidValid(value.uid) && numericId(value.zaloUserId) && versionValid(value.version) && timeValid(value.linkedAt);
  const samePair = (owner, link, uid, zaloId) => identityLink(owner, uid, zaloId) && identityLink(link, uid, zaloId)
    && owner.version === link.version && owner.linkedAt === link.linkedAt;
  const validChallenge = value => scope(value) && uidValid(value.uid) && timeValid(value.createdAt)
    && timeValid(value.expiresAt) && value.expiresAt === value.createdAt + FIVE_MINUTES
    && ['waiting', 'pending', 'approved', 'expired'].includes(value.state)
    && (!['pending', 'approved'].includes(value.state) || (numericId(value.zaloUserId) && challengeIdValid(value.claimId)))
    && (value.state !== 'approved' || (versionValid(value.linkVersion) && timeValid(value.approvedAt)));
  const publicLink = link => ({ linked: true, zaloUserIdSuffix: link.zaloUserId.slice(-4), linkedAt: link.linkedAt });
  // The digest binds the code to one request, Zalo user and uid, so a leaked
  // document cannot be replayed for another pair and the 10^6 codes cannot be
  // precomputed without the server secret.
  const otpDigest = (otpId, zaloId, uid, code) => createHmac('sha256', otpSecret)
    .update(`${otpId}:${zaloId}:${uid}:${code}`).digest();
  const validOtp = (value, zaloId) => scope(value) && value.zaloUserId === zaloId && versionValid(value.otpId)
    && uidValid(value.uid) && schoolEmail(value.email) && challengeIdValid(value.codeHash)
    && timeValid(value.createdAt) && timeValid(value.expiresAt) && value.expiresAt === value.createdAt + TEN_MINUTES
    && Number.isSafeInteger(value.attempts) && value.attempts >= 0 && value.attempts <= OTP_ATTEMPTS
    && (value.verifiedAt === undefined || timeValid(value.verifiedAt)) && sendsValid(value.sentAt);
  // A code verifyOtp would still compare (not verified, expired or used up).
  const activeOtp = (value, zaloId, at) => validOtp(value, zaloId) && value.verifiedAt === undefined
    && value.createdAt <= at && value.expiresAt > at && value.attempts < OTP_ATTEMPTS;
  // The same request repeated within its cooldown (a reply lost to a slow
  // network, a second tap) is answered with the code already in the mailbox:
  // a "wait" error would leave a delivered code with nowhere to type it.
  const replayable = (value, zaloId, email, at) => activeOtp(value, zaloId, at) && value.email === email
    && at - value.sentAt.at(-1) < ONE_MINUTE;
  // Retired code: no otpId or hash, so it never verifies, but this Zalo
  // user's send history stays. Deleting it would reset the cooldown and caps.
  const retiredOtp = (value, zaloId) => ({ appId, miniAppId, zaloUserId: zaloId, sentAt: value.sentAt });
  const limitValid = (value, uid) => scope(value) && value.uid === uid && sendsValid(value.sentAt) && failsValid(value.failedAt);
  const recentFails = (limit, at) => (limit?.failedAt ?? []).filter(failed => at - failed < ONE_DAY);
  // Rolling day and hour plus the resend cooldown. A malformed counter fails
  // closed: silently resetting it would reopen a mailbox to unlimited codes.
  // Returns the sends of the last day, the history to store with this send.
  function allowSend(sends, at) {
    const day = sends.filter(sent => at - sent < ONE_DAY), hour = day.filter(sent => at - sent < ONE_HOUR);
    if (day.length >= OTP_SENDS_PER_DAY || hour.length >= OTP_SENDS_PER_HOUR
      || (hour.length > 0 && at - hour.at(-1) < ONE_MINUTE)) fail('rate_limited');
    return day;
  }
  // Same rule as getLink/revoke: a malformed owner mirror is never overwritten.
  function ownerZaloId(owner, uid) {
    if (!owner) return null;
    if (!scope(owner) || owner.uid !== uid || !numericId(owner.zaloUserId)) fail('link_conflict');
    return owner.zaloUserId;
  }

  async function school(bearer, requireRecent) {
    if (!ascii(bearer, 16_384)) fail('unauthenticated');
    let identity;
    try { identity = await verifySchoolToken(bearer, { requireRecent }); }
    catch (error) {
      if (error?.code === 'recent_auth_required' || error?.code === 'auth/requires-recent-login') fail('recent_auth_required');
      if (error?.code === 'email_verification_required') fail('email_verification_required');
      if (error?.code === 'account_unavailable' || error?.code === 'auth/user-disabled') fail('account_unavailable');
      fail('unauthenticated');
    }
    if (!identity || !uidValid(identity.uid) || !schoolEmail(identity.email)) fail('unauthenticated');
    return { uid: identity.uid, email: identity.email.toLowerCase() };
  }
  async function zalo(bearer) {
    if (!ascii(bearer, 4096)) fail('unauthenticated');
    let identity;
    try { identity = await verifyZaloToken(bearer); }
    catch (error) {
      // A documented server IP restriction is an availability problem. Asking
      // the user to refresh a valid Zalo session cannot fix the server region.
      if (error instanceof ZaloIdentityError && error.code === 'ip_restricted') fail('service_unavailable');
      fail('unauthenticated');
    }
    if (!identity || !numericId(identity.zaloUserId)) fail('unauthenticated');
    return identity.zaloUserId;
  }
  async function profile(uid) {
    let value;
    try { value = await getSchoolProfile(uid); } catch (error) {
      if (error?.code === 'email_verification_required') fail('email_verification_required');
      fail('account_unavailable');
    }
    if (!value || !schoolEmail(value.email)) fail('account_unavailable');
    return { fullName: text(value.fullName, 160), employeeId: text(value.employeeId, 40),
      department: text(value.department, 160), email: value.email.toLowerCase() };
  }
  async function schoolAccount(email) {
    let value;
    try { value = await findSchoolAccountByEmail(email); } catch (error) {
      if (error?.code === 'account_not_found' || error?.code === 'auth/user-not-found') fail('account_not_found');
      if (error?.code === 'account_unavailable' || error?.code === 'auth/user-disabled') fail('account_unavailable');
      fail('service_unavailable');
    }
    // The code goes to this address and the link to this uid: a lookup that
    // answers for another mailbox must never redirect either of them.
    if (!value || !uidValid(value.uid) || !schoolEmail(value.email) || value.email.toLowerCase() !== email) fail('account_unavailable');
    return { uid: value.uid, email, name: text(value.name, 160) };
  }
  function availableChallenge(value, uid, at) {
    if (!validChallenge(value) || (uid && value.uid !== uid) || value.createdAt > at
      || value.expiresAt <= at || value.state === 'expired') {
      fail('challenge_unavailable');
    }
  }
  function validSession(value, at) {
    return scope(value) && uidValid(value.uid) && numericId(value.zaloUserId) && versionValid(value.linkVersion)
      && timeValid(value.createdAt) && timeValid(value.expiresAt) && value.expiresAt > at && value.createdAt <= at;
  }

  async function createChallenge(bearer) {
    const { uid } = await school(bearer, true);
    const code = randomBytes(18).toString('base64url'), challengeId = hash(code);
    return store.runTransaction(async tx => {
      const at = clock();
      const [rate, collision] = await Promise.all([tx.get(path.rate(uid)), tx.get(path.challenge(challengeId))]);
      if (collision) fail('service_unavailable');
      if (rate && (!scope(rate) || rate.uid !== uid || !timeValid(rate.windowStartedAt)
        || !Number.isSafeInteger(rate.count) || rate.count < 0 || rate.count > 5
        || (rate.activeChallengeId !== null && !challengeIdValid(rate.activeChallengeId)))) fail('service_unavailable');
      const withinWindow = !!rate && at - rate.windowStartedAt < TEN_MINUTES;
      const count = withinWindow ? rate.count : 0;
      if (count >= 5) fail('rate_limited');
      const previousId = rate?.activeChallengeId;
      const previous = previousId ? await tx.get(path.challenge(previousId)) : null;
      const expiresAt = at + FIVE_MINUTES;
      // All reads are complete. A new request retires the prior pending code.
      if (previous && validChallenge(previous) && previous.uid === uid && previous.state !== 'approved') {
        tx.set(path.challenge(previousId), { ...previous, state: 'expired' });
      }
      tx.set(path.challenge(challengeId), { appId, miniAppId, uid, createdAt: at, expiresAt, state: 'waiting' });
      tx.set(path.rate(uid), { appId, miniAppId, uid, count: count + 1,
        windowStartedAt: withinWindow ? rate.windowStartedAt : at, activeChallengeId: challengeId });
      return { challengeId, code, expiresAt };
    });
  }

  async function claim(code, bearer) {
    if (!codeValid(code)) fail('challenge_unavailable');
    const zaloUserId = await zalo(bearer), challengeId = hash(code);
    const claimToken = opaque(), claimId = hash(claimToken);
    return store.runTransaction(async tx => {
      const at = clock(), challenge = await tx.get(path.challenge(challengeId));
      availableChallenge(challenge, null, at);
      if (challenge.state !== 'waiting') fail('challenge_unavailable');
      const [owner, link, collision] = await Promise.all([tx.get(path.owner(challenge.uid)),
        tx.get(path.link(zaloUserId)), tx.get(path.claim(claimId))]);
      if (collision) fail('service_unavailable');
      if ((owner || link) && !samePair(owner, link, challenge.uid, zaloUserId)) fail('link_conflict');
      tx.set(path.challenge(challengeId), { ...challenge, state: 'pending', zaloUserId, claimId });
      tx.set(path.claim(claimId), { appId, miniAppId, uid: challenge.uid, zaloUserId, challengeId,
        createdAt: at, expiresAt: challenge.expiresAt });
      return { claimToken, expiresAt: challenge.expiresAt };
    });
  }

  async function stateOfChallenge(challengeId, expectedUid = null) {
    const challenge = await store.get(path.challenge(challengeId));
    if (!validChallenge(challenge) || (expectedUid && challenge.uid !== expectedUid)) fail('challenge_unavailable');
    let state = challenge.state;
    if (challenge.expiresAt <= clock()) state = 'expired';
    if (state === 'approved') {
      if (!numericId(challenge.zaloUserId)) fail('challenge_unavailable');
      const [owner, link] = await Promise.all([store.get(path.owner(challenge.uid)), store.get(path.link(challenge.zaloUserId))]);
      if (!samePair(owner, link, challenge.uid, challenge.zaloUserId) || link.version !== challenge.linkVersion) state = 'expired';
    }
    return { state, expiresAt: challenge.expiresAt,
      ...((state === 'pending' || state === 'approved') && numericId(challenge.zaloUserId)
        ? { zaloUserIdSuffix: challenge.zaloUserId.slice(-4) } : {}) };
  }

  async function confirm(challengeId, bearer) {
    const { uid } = await school(bearer, true);
    return store.runTransaction(async tx => {
      const at = clock(), challenge = await tx.get(path.challenge(challengeId));
      availableChallenge(challenge, uid, at);
      if (!['pending', 'approved'].includes(challenge.state) || !numericId(challenge.zaloUserId)
        || !challengeIdValid(challenge.claimId)) fail('challenge_unavailable');
      const zaloUserId = challenge.zaloUserId;
      const [owner, link, claimed] = await Promise.all([tx.get(path.owner(uid)), tx.get(path.link(zaloUserId)),
        tx.get(path.claim(challenge.claimId))]);
      if (!scope(claimed) || claimed.uid !== uid || claimed.zaloUserId !== zaloUserId
        || claimed.challengeId !== challengeId || claimed.expiresAt !== challenge.expiresAt) fail('challenge_unavailable');
      if (challenge.state === 'approved') {
        if (!samePair(owner, link, uid, zaloUserId) || link.version !== challenge.linkVersion) fail('challenge_unavailable');
        return publicLink(link); // Retry by the same owner does not rotate sessions.
      }
      if ((owner || link) && !samePair(owner, link, uid, zaloUserId)) fail('link_conflict');
      const nextLink = link || { appId, miniAppId, uid, zaloUserId, version: randomBytes(16).toString('hex'), linkedAt: at };
      tx.set(path.owner(uid), nextLink);
      tx.set(path.link(zaloUserId), nextLink);
      tx.set(path.challenge(challengeId), { ...challenge, state: 'approved', approvedAt: at, linkVersion: nextLink.version });
      return publicLink(nextLink);
    });
  }

  async function getLink(bearer) {
    const { uid } = await school(bearer, false), owner = await store.get(path.owner(uid));
    if (!owner) return { linked: false };
    if (!scope(owner) || owner.uid !== uid || !numericId(owner.zaloUserId)) fail('link_conflict');
    const link = await store.get(path.link(owner.zaloUserId));
    if (!samePair(owner, link, uid, owner.zaloUserId)) fail('link_conflict');
    return publicLink(link);
  }

  async function revoke(bearer) {
    const { uid } = await school(bearer, true);
    return store.runTransaction(async tx => {
      const [owner, rate] = await Promise.all([tx.get(path.owner(uid)), tx.get(path.rate(uid))]);
      if (owner && (!scope(owner) || owner.uid !== uid || !numericId(owner.zaloUserId))) fail('link_conflict');
      const activeId = scope(rate) && rate.uid === uid && challengeIdValid(rate.activeChallengeId) ? rate.activeChallengeId : null;
      const [link, challenge] = await Promise.all([owner ? tx.get(path.link(owner.zaloUserId)) : Promise.resolve(null),
        activeId ? tx.get(path.challenge(activeId)) : Promise.resolve(null)]);
      if (owner) tx.delete(path.owner(uid));
      if (owner && scope(link) && link.uid === uid && link.zaloUserId === owner.zaloUserId) tx.delete(path.link(owner.zaloUserId));
      if (activeId && validChallenge(challenge) && challenge.uid === uid) {
        tx.set(path.challenge(activeId), { ...challenge, state: 'expired' });
        tx.set(path.rate(uid), { ...rate, activeChallengeId: null });
      }
      // No session scan is needed: each request checks the current link/version.
      return { revoked: true, linked: false };
    });
  }

  async function login(bearer) {
    const zaloUserId = await zalo(bearer), link = await store.get(path.link(zaloUserId));
    if (!link) return { linked: false };
    if (!scope(link) || !uidValid(link.uid) || !identityLink(link, link.uid, zaloUserId)) fail('link_conflict');
    const schoolProfile = await profile(link.uid), sessionToken = opaque(), sessionId = hash(sessionToken);
    return store.runTransaction(async tx => {
      const at = clock(), [current, owner, collision] = await Promise.all([tx.get(path.link(zaloUserId)),
        tx.get(path.owner(link.uid)), tx.get(path.session(sessionId))]);
      if (collision) fail('service_unavailable');
      if (!samePair(owner, current, link.uid, zaloUserId) || current.version !== link.version) fail('link_conflict');
      const expiresAt = at + EIGHT_HOURS;
      tx.set(path.session(sessionId), { appId, miniAppId, uid: link.uid, zaloUserId,
        linkVersion: link.version, createdAt: at, expiresAt });
      return { linked: true, sessionToken, expiresAt, profile: schoolProfile };
    });
  }

  async function requestOtp(email, bearer) {
    const zaloUserId = await zalo(bearer), current = await store.get(path.link(zaloUserId));
    // An existing pair signs in through mini.login: no lookup, no mail.
    if (current && identityLink(current, current.uid, zaloUserId)
      && samePair(await store.get(path.owner(current.uid)), current, current.uid, zaloUserId)) return { state: 'linked' };
    // This Zalo user's own limit runs before the account lookup: during its
    // cooldown or once its sends are used up, every address gets the same 429
    // with no Auth call, so probing addresses costs a real mail each time.
    // Read-only and fail-fast; the transaction below repeats it race-safely.
    const pending = await store.get(path.otp(zaloUserId));
    if (pending) {
      if (!scope(pending) || pending.zaloUserId !== zaloUserId || !sendsValid(pending.sentAt)) fail('service_unavailable');
      const at = clock();
      if (!replayable(pending, zaloUserId, email, at)) allowSend(pending.sentAt, at);
    }
    const account = await schoolAccount(email), { uid } = account;
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0'), otpId = randomBytes(16).toString('hex');
    const sent = await store.runTransaction(async tx => {
      const at = clock();
      const [otp, limit, link, owner] = await Promise.all([tx.get(path.otp(zaloUserId)), tx.get(path.otpLimit(uid)),
        tx.get(path.link(zaloUserId)), tx.get(path.owner(uid))]);
      const linkOwner = link && identityLink(link, link.uid, zaloUserId)
        ? (link.uid === uid ? owner : await tx.get(path.owner(link.uid))) : null;
      if (link && samePair(linkOwner, link, link.uid, zaloUserId)) return { linked: true }; // Linked meanwhile.
      // verifyOtp would refuse these pairs, so do not mail a code that cannot work.
      if (link && !identityLink(link, uid, zaloUserId)) fail('link_conflict');
      const previousZalo = ownerZaloId(owner, uid);
      const previous = previousZalo && previousZalo !== zaloUserId ? await tx.get(path.link(previousZalo)) : null;
      if (otp && (!scope(otp) || otp.zaloUserId !== zaloUserId || !sendsValid(otp.sentAt))) fail('service_unavailable');
      if (limit && !limitValid(limit, uid)) fail('service_unavailable');
      const replacesExisting = !!previous && samePair(owner, previous, uid, previousZalo);
      // verifyOtp refuses every code of this account while its wrong-code cap
      // is full, so do not mail one.
      const fails = recentFails(limit, at);
      if (fails.length >= OTP_FAILS_PER_DAY) fail('rate_limited');
      // A repeat writes and mails nothing; the cooldown still holds for others.
      if (replayable(otp, zaloUserId, account.email, at) && otp.uid === uid) {
        return { linked: false, replay: true, expiresAt: otp.expiresAt, resendAt: otp.sentAt.at(-1) + ONE_MINUTE, replacesExisting };
      }
      // Per Zalo user: one person cannot mail many colleagues. Per uid: many
      // Zalo accounts cannot flood one mailbox. The per-uid caps are shared,
      // so anyone who knows the address can use them up and keep the owner
      // from getting a code here for up to a day. That is the price of
      // bounding mail and guesses per mailbox; the owner then links through
      // the website, which these limits do not cover (the panel says so).
      const zaloSends = allowSend(otp ? otp.sentAt : [], at), uidSends = allowSend(limit ? limit.sentAt : [], at);
      const expiresAt = at + TEN_MINUTES;
      // All reads are complete. Replacing the document retires any earlier code.
      tx.set(path.otp(zaloUserId), { appId, miniAppId, otpId, zaloUserId, uid, email: account.email,
        codeHash: otpDigest(otpId, zaloUserId, uid, code).toString('hex'), createdAt: at, expiresAt, attempts: 0,
        sentAt: [...zaloSends, at] });
      tx.set(path.otpLimit(uid), { appId, miniAppId, uid, sentAt: [...uidSends, at], failedAt: fails });
      return { linked: false, replay: false, expiresAt, resendAt: at + ONE_MINUTE, replacesExisting };
    });
    if (sent.linked) return { state: 'linked' };
    if (!sent.replay) {
      try { await sendLinkEmail({ kind: 'otp', to: account.email, code, expiresAt: sent.expiresAt, name: account.name }); }
      catch {
        // A code that may never arrive must not stay usable. Send counters
        // (per uid and, in the retired document, per Zalo user) are kept: the
        // provider may have delivered the mail before failing.
        try {
          await store.runTransaction(async tx => {
            const otp = await tx.get(path.otp(zaloUserId));
            // Never a newer request's code.
            if (otp && otp.otpId === otpId) tx.set(path.otp(zaloUserId), retiredOtp(otp, zaloUserId));
          });
        } catch { /* Best effort; the code still expires in ten minutes. */ }
        fail('service_unavailable');
      }
    }
    return { state: 'sent', emailMasked: maskEmail(account.email), expiresAt: sent.expiresAt,
      resendAt: sent.resendAt, replacesExisting: sent.replacesExisting };
  }

  async function verifyOtp(code, bearer) {
    const zaloUserId = await zalo(bearer);
    const checked = await store.runTransaction(async tx => {
      const at = clock(), otp = await tx.get(path.otp(zaloUserId));
      if (!validOtp(otp, zaloUserId) || otp.createdAt > at || otp.expiresAt <= at || otp.attempts >= OTP_ATTEMPTS) fail('otp_expired');
      const limit = await tx.get(path.otpLimit(otp.uid));
      if (limit && !limitValid(limit, otp.uid)) fail('service_unavailable');
      // Five tries per code alone would let many Zalo accounts keep guessing
      // at one mailbox. Wrong codes also add up per school account, whoever
      // sends them: about ten guesses a day in total, then every code of the
      // account is refused before comparing (its owner links on the website).
      const fails = recentFails(limit, at);
      if (fails.length >= OTP_FAILS_PER_DAY) fail('otp_expired');
      // Compared inside the transaction that counts the attempt: parallel
      // guesses serialize on these documents, so both caps are hard.
      if (!timingSafeEqual(otpDigest(otp.otpId, zaloUserId, otp.uid, code), Buffer.from(otp.codeHash, 'hex'))) {
        tx.set(path.otp(zaloUserId), { ...otp, attempts: otp.attempts + 1 });
        tx.set(path.otpLimit(otp.uid), { appId, miniAppId, uid: otp.uid, sentAt: limit ? limit.sentAt : [], failedAt: [...fails, at] });
        return { matched: false }; // Returned, not thrown, so the counts commit.
      }
      // Keep the document: retrying the same code after a transient Auth or
      // profile failure must still succeed until the code expires.
      if (otp.verifiedAt === undefined) tx.set(path.otp(zaloUserId), { ...otp, verifiedAt: at });
      return { matched: true, otpId: otp.otpId, uid: otp.uid, email: otp.email };
    });
    if (!checked.matched) fail('otp_invalid');
    const { otpId, uid, email } = checked;
    // The mailbox proof covers the uid that owns this address now; an address
    // moved to another account since the request must not verify the old one.
    if ((await schoolAccount(email)).uid !== uid) fail('account_unavailable');
    // Every Mini App profile read re-checks emailVerified; control of the
    // mailbox was just proven, so this is the one place that may set it. The
    // address is passed so an implementation can refuse a changed account.
    try { await markEmailVerified(uid, email); } catch (error) {
      if (['account_unavailable', 'auth/user-disabled', 'auth/user-not-found'].includes(error?.code)) fail('account_unavailable');
      fail('service_unavailable');
    }
    const schoolProfile = await profile(uid);
    if (schoolProfile.email !== email) fail('account_unavailable');
    const sessionToken = opaque(), sessionId = hash(sessionToken);
    const result = await store.runTransaction(async tx => {
      const at = clock();
      const [otp, owner, link, collision] = await Promise.all([tx.get(path.otp(zaloUserId)), tx.get(path.owner(uid)),
        tx.get(path.link(zaloUserId)), tx.get(path.session(sessionId))]);
      if (!validOtp(otp, zaloUserId) || otp.otpId !== otpId || otp.uid !== uid || otp.email !== email
        || otp.verifiedAt === undefined || otp.createdAt > at || otp.expiresAt <= at) fail('otp_expired');
      if (collision) fail('service_unavailable');
      if (link && !identityLink(link, uid, zaloUserId)) fail('link_conflict'); // Never take over another uid's Zalo.
      const previousZalo = ownerZaloId(owner, uid);
      const previous = previousZalo && previousZalo !== zaloUserId ? await tx.get(path.link(previousZalo)) : null;
      // All reads are complete. An intact pair (a parallel retry) keeps its
      // version so the session that retry already issued stays valid.
      const kept = samePair(owner, link, uid, zaloUserId);
      const nextLink = kept ? link : { appId, miniAppId, uid, zaloUserId, version: randomBytes(16).toString('hex'), linkedAt: at };
      if (!kept) { tx.set(path.owner(uid), nextLink); tx.set(path.link(zaloUserId), nextLink); }
      // Moving the link: no session scan is needed, the old Zalo user's
      // sessions fail the owner/version check on their next request.
      if (scope(previous) && previous.uid === uid && previous.zaloUserId === previousZalo) tx.delete(path.link(previousZalo));
      tx.set(path.otp(zaloUserId), retiredOtp(otp, zaloUserId)); // Single use; the send history stays.
      const expiresAt = at + EIGHT_HOURS;
      tx.set(path.session(sessionId), { appId, miniAppId, uid, zaloUserId, linkVersion: nextLink.version, createdAt: at, expiresAt });
      return { expiresAt, linkedAt: nextLink.linkedAt, changed: !kept };
    });
    if (result.changed) {
      // The link is committed: a lost notice must not fail or undo it, and a
      // slow Graph call must not hold the reply past the Mini App/proxy
      // deadline (the code is already retired, so a lost reply would look like
      // "code expired"). Wait briefly, then let the long-running API finish it.
      let timer;
      const notice = Promise.resolve()
        .then(() => sendLinkEmail({ kind: 'linked', to: email, linkedAt: result.linkedAt, name: schoolProfile.fullName }))
        .catch(() => { /* Best effort only. */ });
      await Promise.race([notice, new Promise(resolve => { timer = setTimeout(resolve, NOTICE_WAIT_MS); })]);
      clearTimeout(timer);
    }
    return { linked: true, sessionToken, expiresAt: result.expiresAt, profile: schoolProfile };
  }

  async function claimStatus(bearer) {
    if (!tokenValid(bearer)) fail('unauthenticated');
    const claimed = await store.get(path.claim(hash(bearer)));
    if (!scope(claimed) || !uidValid(claimed.uid) || !numericId(claimed.zaloUserId)
      || !challengeIdValid(claimed.challengeId) || !timeValid(claimed.expiresAt)) fail('unauthenticated');
    if (claimed.expiresAt <= clock()) return { state: 'expired', expiresAt: claimed.expiresAt };
    const challenge = await store.get(path.challenge(claimed.challengeId));
    if (!validChallenge(challenge) || challenge.uid !== claimed.uid || challenge.zaloUserId !== claimed.zaloUserId
      || challenge.claimId !== hash(bearer) || challenge.expiresAt !== claimed.expiresAt) fail('unauthenticated');
    const status = await stateOfChallenge(claimed.challengeId, claimed.uid);
    return { state: status.state, expiresAt: status.expiresAt }; // Never returns a session or another identity.
  }

  async function authorizeMiniSession(bearer) {
    if (!tokenValid(bearer)) fail('unauthenticated');
    const sessionId = hash(bearer), session = await store.get(path.session(sessionId));
    if (!validSession(session, clock())) fail('session_expired');
    const schoolProfile = await profile(session.uid);
    // A business transaction must use its own transaction-backed getter here.
    // This makes revocation/session changes conflict with the same write rather
    // than authorizing one transaction and mutating data in a later unchecked one.
    const assertCurrent = async readPrivate => {
      if (typeof readPrivate !== 'function') fail('service_unavailable');
      const [current, link, owner] = await Promise.all([readPrivate(path.session(sessionId)),
        readPrivate(path.link(session.zaloUserId)), readPrivate(path.owner(session.uid))]);
      if (!validSession(current, clock()) || current.uid !== session.uid || current.zaloUserId !== session.zaloUserId
        || current.linkVersion !== session.linkVersion || !samePair(owner, link, session.uid, session.zaloUserId)
        || link.version !== session.linkVersion) fail('session_expired');
    };
    await store.runTransaction(tx => assertCurrent(key => tx.get(key)));
    return Object.freeze({ uid: session.uid, profile: Object.freeze(schoolProfile), assertCurrent });
  }

  async function me(bearer) {
    const context = await authorizeMiniSession(bearer);
    return { profile: context.profile };
  }

  async function logout(bearer) {
    if (!tokenValid(bearer)) fail('unauthenticated');
    const sessionPath = path.session(hash(bearer));
    return store.runTransaction(async tx => {
      const session = await tx.get(sessionPath);
      if (session && scope(session)) tx.delete(sessionPath);
      return { loggedOut: true };
    });
  }

  return {
    // Internal server API. This context is never an RPC response or a Firebase
    // custom token, and it contains no role or permission claims.
    async authorizeMiniSession(bearer) {
      try { return await authorizeMiniSession(bearer); }
      catch (error) {
        const code = publicErrors.get(error);
        if (code) throw new AccountLinkError(ERRORS[code][0], code);
        throw new AccountLinkError(503, 'service_unavailable');
      }
    },
    async run(action, body, bearer) {
      try {
        if (!Object.hasOwn(fields, action)) fail('invalid_action');
        const allowed = fields[action];
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || ![Object.prototype, null].includes(Object.getPrototypeOf(body))
          || Object.keys(body).length !== allowed.length || allowed.some(key => !Object.hasOwn(body, key))) fail('invalid_request');
        if (allowed.includes('challengeId') && !challengeIdValid(body.challengeId)) fail('invalid_request');
        switch (action) {
          case 'web.createChallenge': return await createChallenge(bearer);
          case 'web.challengeStatus': {
            const { uid } = await school(bearer, false);
            return await stateOfChallenge(body.challengeId, uid);
          }
          case 'web.confirmLink': return await confirm(body.challengeId, bearer);
          case 'web.getLink': return await getLink(bearer);
          case 'web.revokeLink': return await revoke(bearer);
          case 'mini.login': return await login(bearer);
          case 'mini.claim': return await claim(body.code, bearer);
          case 'mini.claimStatus': return await claimStatus(bearer);
          case 'mini.me': return await me(bearer);
          case 'mini.logout': return await logout(bearer);
          case 'mini.requestOtp': {
            const email = normalizeEmail(body.email);
            if (!email) fail('invalid_request');
            if (!emailLinkReady) fail('email_link_unavailable');
            return await requestOtp(email, bearer);
          }
          case 'mini.verifyOtp':
            if (!otpCodeValid(body.code)) fail('otp_invalid');
            if (!emailLinkReady) fail('email_link_unavailable');
            return await verifyOtp(body.code, bearer);
          default: fail('invalid_action');
        }
      } catch (error) {
        // Only re-create fixed public errors; never expose store/Auth/Graph text.
        const code = publicErrors.get(error);
        if (code) {
          throw new AccountLinkError(ERRORS[code][0], code);
        }
        throw new AccountLinkError(503, 'service_unavailable');
      }
    },
  };
}
