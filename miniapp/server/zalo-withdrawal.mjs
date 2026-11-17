/** SERVER ONLY: verify Zalo Mini App consent events before touching linked data. */
import { createHash, timingSafeEqual } from 'node:crypto';

const NUMERIC_ID = /^[1-9][0-9]{0,39}$/;
const MAX_FUTURE_SKEW = 5 * 60_000;
const ONE_DAY = 24 * 60 * 60_000;
// Same as the per-Zalo daily e-mail code cap in account-links.mjs.
const OTP_SEND_HISTORY = 10;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && NUMERIC_ID.test(value);
const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;

export class ZaloWithdrawalError extends Error {
  constructor(status, code) {
    super('Unable to process Mini App consent event.');
    this.name = 'ZaloWithdrawalError';
    this.status = status;
    this.code = code;
  }
}

const fail = (status, code) => { throw new ZaloWithdrawalError(status, code); };

/** The opaque document key contains no raw Zalo identifier. */
export function zaloRevocationPath(appId, miniAppId, zaloUserId) {
  const digest = createHash('sha256').update(`${miniAppId}:${zaloUserId}`).digest('hex');
  return `zalo_link_revocations/${appId}_${digest}`;
}

/**
 * Send times of this Zalo user's school-email codes that cleanup moves onto
 * its withdrawal marker before deleting the code document (which names the
 * address and uid). Without them, withdrawing consent and granting it again
 * would restart the per-Zalo send caps, letting one person mail many
 * colleagues. Only times of the last day, at most ten, oldest first, each once;
 * anything malformed is dropped so cleanup never fails on it.
 */
export function keptZaloOtpSends(lists, at) {
  const times = lists.flatMap(list => Array.isArray(list)
    ? list.filter(sent => validTime(sent) && validTime(at) && at - sent < ONE_DAY) : []);
  return [...new Set(times)].sort((a, b) => a - b).slice(-OTP_SEND_HISTORY);
}

export function isZaloLinkWithdrawn(revocation, appId, miniAppId, linkedAt) {
  if (!revocation) return false;
  if (revocation.appId !== appId || revocation.miniAppId !== miniAppId
    || !validTime(revocation.withdrawnAt)) return true;
  return !validTime(linkedAt) || linkedAt <= revocation.withdrawnAt;
}

/**
 * The store revokes links atomically, then removes Zalo-only temporary records.
 * A pending marker makes a failed cleanup retryable without restoring access.
 */
export function createZaloWithdrawalService({ store, appId, miniAppId, apiKey, now = () => Date.now() } = {}) {
  if (!store || typeof store.runTransaction !== 'function' || typeof store.cleanupZaloData !== 'function'
    || !validId(appId) || !validId(miniAppId) || typeof apiKey !== 'string'
    || apiKey.length < 16 || apiKey.length > 1024 || /[^\x21-\x7e]/.test(apiKey)
    || /^(?:your|dien_|dan_|change|replace|placeholder)|[<>]|\$\{/i.test(apiKey) || typeof now !== 'function') {
    fail(503, 'not_configured');
  }

  function authenticate(body, signature) {
    if (!plainObject(body) || Object.keys(body).length > 16
      || Object.keys(body).some(key => /^(?:__proto__|prototype|constructor)$/.test(key))) fail(400, 'invalid_request');
    let encoded, content;
    try {
      encoded = JSON.stringify(body);
      if (Buffer.byteLength(encoded, 'utf8') > 8192) fail(413, 'invalid_request');
      content = Object.keys(body).sort().map(key => {
        const value = body[key];
        if (value === undefined || typeof value === 'function' || typeof value === 'symbol') fail(400, 'invalid_request');
        return value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
      }).join('');
    } catch (error) {
      if (error instanceof ZaloWithdrawalError) throw error;
      fail(400, 'invalid_request');
    }
    if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature)) fail(401, 'invalid_signature');
    const expected = createHash('sha256').update(content).update(apiKey).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) fail(401, 'invalid_signature');
  }

  async function handle(body, signature) {
    authenticate(body, signature);
    if (body.event !== 'user.revoke.consent') return { received: true };
    const allowed = ['event', 'appId', 'userId', 'timestamp'];
    const required = ['event', 'appId', 'userId', 'timestamp'];
    const receivedAt = now();
    // Without an event time, a repeated real withdrawal and a replay after
    // fresh consent have the same signature. Require time before deletion.
    if (Object.keys(body).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(body, key))
      || !validId(body.appId) || !validId(body.userId) || !validTime(receivedAt)
      || !validTime(body.timestamp) || body.timestamp > receivedAt + MAX_FUTURE_SKEW) fail(400, 'invalid_request');
    if (body.appId !== miniAppId) fail(403, 'wrong_app');
    const revocationPath = zaloRevocationPath(appId, miniAppId, body.userId);
    const eventDigest = createHash('sha256').update(signature.toLowerCase()).digest('hex');
    const eventPath = `zalo_webhook_events/${eventDigest}`;
    const linkPath = `zalo_links/${appId}_${body.userId}`;
    try {
      const state = await store.runTransaction(async tx => {
        const receipt = await tx.get(eventPath);
        if (receipt) {
          if (receipt.appId !== appId || receipt.miniAppId !== miniAppId || !validTime(receipt.cutoff)) {
            fail(503, 'service_unavailable');
          }
          return { cutoff: receipt.cutoff, pending: receipt.cleanupPending === true };
        }
        const [previous, link] = await Promise.all([tx.get(revocationPath), tx.get(linkPath)]);
        if (previous && (previous.appId !== appId || previous.miniAppId !== miniAppId
          || !validTime(previous.withdrawnAt))) fail(503, 'service_unavailable');
        const cutoff = body.timestamp;
        const withdrawnAt = Math.max(previous?.withdrawnAt ?? 0, cutoff);
        const uid = link && link.appId === appId && link.miniAppId === miniAppId
          && link.zaloUserId === body.userId && typeof link.uid === 'string'
          && /^(?!__.*__$)[A-Za-z0-9_-]{1,128}$/.test(link.uid) ? link.uid : null;
        const ownerPath = uid ? `zalo_link_owners/${appId}_${uid}` : null;
        const owner = ownerPath ? await tx.get(ownerPath) : null;
        if (link && uid && isZaloLinkWithdrawn({ appId, miniAppId, withdrawnAt }, appId, miniAppId, link.linkedAt)) {
          tx.delete(linkPath);
          if (owner?.appId === appId && owner.miniAppId === miniAppId && owner.uid === uid
            && owner.zaloUserId === body.userId && owner.version === link.version) tx.delete(ownerPath);
        }
        if (!previous || withdrawnAt > previous.withdrawnAt) {
          // A later withdrawal keeps the code send times an earlier cleanup moved here.
          tx.set(revocationPath, { ...(previous?.otpSentAt === undefined ? {} : { otpSentAt: previous.otpSentAt }),
            appId, miniAppId, withdrawnAt, receivedAt, cleanupPending: true });
        }
        tx.set(eventPath, { appId, miniAppId, cutoff, receivedAt, cleanupPending: true });
        return { cutoff, pending: true };
      });
      if (state.pending) {
        await store.cleanupZaloData({ appId, miniAppId, zaloUserId: body.userId, cutoff: state.cutoff, at: receivedAt });
        await store.runTransaction(async tx => {
          const [current, receipt] = await Promise.all([tx.get(revocationPath), tx.get(eventPath)]);
          if (current?.appId === appId && current.miniAppId === miniAppId
            && current.withdrawnAt === state.cutoff && current.cleanupPending === true) {
            tx.set(revocationPath, { ...current, cleanupPending: false });
          }
          if (receipt?.appId === appId && receipt.miniAppId === miniAppId && receipt.cutoff === state.cutoff) {
            tx.set(eventPath, { ...receipt, cleanupPending: false });
          }
        });
      }
      return { received: true };
    } catch (error) {
      if (error instanceof ZaloWithdrawalError) throw error;
      fail(503, 'service_unavailable');
    }
  }

  return { handle };
}
