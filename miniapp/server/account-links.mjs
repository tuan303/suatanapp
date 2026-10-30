/** SERVER ONLY: links verified school/Zalo identities; never issues Firebase or admin tokens. */
import { createHash, randomBytes } from 'node:crypto';

const FIVE_MINUTES = 5 * 60_000;
const TEN_MINUTES = 10 * 60_000;
const EIGHT_HOURS = 8 * 60 * 60_000;
const ERRORS = Object.freeze({
  invalid_config: [500, 'Dịch vụ liên kết tài khoản chưa được cấu hình đúng.'],
  invalid_action: [400, 'Thao tác liên kết tài khoản không hợp lệ.'],
  invalid_request: [400, 'Thông tin yêu cầu không hợp lệ.'],
  unauthenticated: [401, 'Vui lòng đăng nhập lại để tiếp tục.'],
  recent_auth_required: [403, 'Vui lòng xác thực lại tài khoản nhà trường trước khi tiếp tục.'],
  account_unavailable: [403, 'Tài khoản nhà trường hiện không thể sử dụng.'],
  challenge_unavailable: [409, 'Yêu cầu liên kết không còn khả dụng. Vui lòng tạo mã mới.'],
  link_conflict: [409, 'Tài khoản đã có liên kết khác. Vui lòng kiểm tra hoặc hủy liên kết của chính mình.'],
  rate_limited: [429, 'Bạn đã tạo quá nhiều mã liên kết. Vui lòng thử lại sau.'],
  session_expired: [401, 'Phiên Mini App đã hết hạn. Vui lòng đăng nhập lại.'],
  service_unavailable: [503, 'Chưa thể xử lý liên kết tài khoản. Vui lòng thử lại sau.'],
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
const fields = Object.freeze({
  'web.createChallenge': [], 'web.challengeStatus': ['challengeId'], 'web.confirmLink': ['challengeId'],
  'web.getLink': [], 'web.revokeLink': [], 'mini.login': [], 'mini.claim': ['code'],
  'mini.claimStatus': [], 'mini.me': [], 'mini.logout': [],
});

/**
 * Store methods receive exact document paths and plain data only. Firestore
 * adapters must implement atomic runTransaction; every transaction reads all
 * documents before writing any. No raw code, claim token or session is stored.
 */
export function createAccountLinkService(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('invalid_config');
  const { store, verifySchoolToken, verifyZaloToken, getSchoolProfile,
    now = () => Date.now(), appId, miniAppId } = options;
  if (!numericId(appId) || !numericId(miniAppId) || !store || typeof store.get !== 'function'
    || typeof store.runTransaction !== 'function' || typeof verifySchoolToken !== 'function'
    || typeof verifyZaloToken !== 'function' || typeof getSchoolProfile !== 'function' || typeof now !== 'function') {
    fail('invalid_config');
  }
  const path = {
    challenge: id => `zalo_link_challenges/${id}`,
    claim: id => `zalo_link_claims/${id}`,
    session: id => `zalo_link_sessions/${id}`,
    link: id => `zalo_links/${appId}_${id}`,
    owner: uid => `zalo_link_owners/${appId}_${uid}`,
    rate: uid => `zalo_link_rate_limits/${appId}_${uid}`,
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

  async function school(bearer, requireRecent) {
    if (!ascii(bearer, 16_384)) fail('unauthenticated');
    let identity;
    try { identity = await verifySchoolToken(bearer, { requireRecent }); }
    catch (error) {
      if (error?.code === 'recent_auth_required' || error?.code === 'auth/requires-recent-login') fail('recent_auth_required');
      if (error?.code === 'account_unavailable' || error?.code === 'auth/user-disabled') fail('account_unavailable');
      fail('unauthenticated');
    }
    if (!identity || !uidValid(identity.uid) || !schoolEmail(identity.email)) fail('unauthenticated');
    return { uid: identity.uid, email: identity.email.toLowerCase() };
  }
  async function zalo(bearer) {
    if (!ascii(bearer, 4096)) fail('unauthenticated');
    let identity;
    try { identity = await verifyZaloToken(bearer); } catch { fail('unauthenticated'); }
    if (!identity || !numericId(identity.zaloUserId)) fail('unauthenticated');
    return identity.zaloUserId;
  }
  async function profile(uid) {
    let value;
    try { value = await getSchoolProfile(uid); } catch { fail('account_unavailable'); }
    if (!value || !schoolEmail(value.email)) fail('account_unavailable');
    return { fullName: text(value.fullName, 160), employeeId: text(value.employeeId, 40),
      department: text(value.department, 160), email: value.email.toLowerCase() };
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

  async function me(bearer) {
    if (!tokenValid(bearer)) fail('unauthenticated');
    const sessionId = hash(bearer), session = await store.get(path.session(sessionId));
    if (!validSession(session, clock())) fail('session_expired');
    const schoolProfile = await profile(session.uid);
    await store.runTransaction(async tx => {
      const [current, link, owner] = await Promise.all([tx.get(path.session(sessionId)),
        tx.get(path.link(session.zaloUserId)), tx.get(path.owner(session.uid))]);
      if (!validSession(current, clock()) || current.uid !== session.uid || current.zaloUserId !== session.zaloUserId
        || current.linkVersion !== session.linkVersion || !samePair(owner, link, session.uid, session.zaloUserId)
        || link.version !== session.linkVersion) fail('session_expired');
    });
    return { profile: schoolProfile };
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
