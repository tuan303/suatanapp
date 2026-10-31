// SERVER ONLY. The configured school server performs the full existing Zalo
// RPC, including identity verification, approval and session checks. A proxy
// response never substitutes a client-supplied identity for verification.
import { AccountLinkError } from '../../miniapp/server/account-links.mjs';

const UPSTREAM = 'https://api-suatan.nshm.vn/api/zalo';
const MAX_RESPONSE_BYTES = 16_384;
const FIELDS = Object.freeze({
  'web.createChallenge': [], 'web.challengeStatus': ['challengeId'], 'web.confirmLink': ['challengeId'],
  'web.getLink': [], 'web.revokeLink': [], 'mini.login': [], 'mini.claim': ['code'],
  'mini.claimStatus': [], 'mini.me': [], 'mini.logout': [],
});
const ERROR_CODES = Object.freeze({
  invalid_config: [500, 'invalid_config'], invalid_action: [400, 'invalid_action'],
  invalid_request: [400, 'invalid_request'], unauthenticated: [401, 'unauthenticated'],
  auth_required: [401, 'unauthenticated'], recent_auth_required: [403, 'recent_auth_required'],
  account_unavailable: [403, 'account_unavailable'], challenge_unavailable: [409, 'challenge_unavailable'],
  link_conflict: [409, 'link_conflict'], rate_limited: [429, 'rate_limited'],
  session_expired: [401, 'session_expired'], service_unavailable: [503, 'service_unavailable'],
  not_configured: [503, 'service_unavailable'],
});
const unavailable = () => new AccountLinkError(503, 'service_unavailable');
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

async function readJson(response, controller) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d{1,8}$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) throw unavailable();
  const contentType = response.headers?.get?.('content-type');
  if (contentType && !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i.test(contentType)) throw unavailable();
  // Native fetch always exposes a readable stream. Reading it incrementally
  // bounds memory even if an upstream ignores Content-Length or streams forever.
  if (!response.body || typeof response.body.getReader !== 'function') throw unavailable();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw unavailable();
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw unavailable();
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { reader.releaseLock(); }
  const body = JSON.parse(text);
  if (!plainObject(body)) throw unavailable();
  return body;
}

/**
 * Empty configuration keeps the existing local implementation. Only this
 * exact, school-owned HTTPS endpoint is eligible; URLs never come from clients.
 * Enabling the upstream is a separate cutover after DNS/TLS/backend validation.
 */
export function getZaloUpstreamService(env = process.env, options = {}) {
  let url, fetchImpl, timeoutMs;
  try {
    url = env.DKAN_ZALO_API_UPSTREAM_URL;
    if (url === undefined || url === '') return null;
    ({ fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = options);
    if (url !== UPSTREAM || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs)
      || timeoutMs < 1 || timeoutMs > 15_000) throw unavailable();
  } catch { throw unavailable(); }

  return {
    async run(action, body, bearer) {
      let payload;
      try {
        if (typeof action !== 'string' || !Object.hasOwn(FIELDS, action) || !plainObject(body)
          || Object.keys(body).some(key => !FIELDS[action].includes(key))
          || typeof bearer !== 'string' || !/^[\x21-\x7e]{1,16384}$/.test(bearer)) throw unavailable();
        payload = JSON.stringify({ action, ...body });
        if (Buffer.byteLength(payload, 'utf8') > 8192) throw unavailable();
      } catch { throw unavailable(); }

      const controller = new AbortController();
      let timer, trustedError;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(unavailable());
        }, timeoutMs);
      });
      const forward = async () => {
        const response = await fetchImpl(UPSTREAM, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json',
            authorization: `Bearer ${bearer}`, origin: 'https://suatanapp.vercel.app' },
          body: payload, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
        });
        if (!response || !Number.isInteger(response.status)
          || !(response.status === 200 && response.ok === true || response.status >= 400 && response.status <= 599)) throw unavailable();
        const result = await readJson(response, controller);
        if (response.status !== 200) {
          const code = plainObject(result.error) && result.error.code;
          const known = typeof code === 'string' && Object.hasOwn(ERROR_CODES, code) && ERROR_CODES[code];
          if (known && response.status === known[0]) trustedError = new AccountLinkError(known[0], known[1]);
          throw trustedError || unavailable();
        }
        if (Object.hasOwn(result, 'error')) throw unavailable();
        return result;
      };
      try { return await Promise.race([forward(), deadline]); }
      catch {
        // Never trust arbitrary transport errors, even if they imitate our
        // public error class. Only the fixed mapping above may cross the API.
        throw trustedError || unavailable();
      } finally { clearTimeout(timer); }
    },
  };
}
