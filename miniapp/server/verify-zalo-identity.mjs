/**
 * SERVER ONLY. Never import this module or ZALO_APP_SECRET_KEY into Mini App code.
 *
 * A client-supplied Zalo ID, nickname, phone number or school email is not proof
 * of identity. Resolve the access token through Zalo before linking an account.
 * This helper does not create sessions, Firebase tokens, accounts or links.
 *
 * Official authentication protocol (checked 30/10/2026):
 * https://docs.zaloplatforms.com/docs/MA/intro/best-practices/authen-user
 */
import { createHmac } from 'node:crypto';

const PROFILE_URL = 'https://graph.zalo.me/v2.0/me?fields=id';
const NON_PRINTABLE_ASCII = /[^\x21-\x7e]/;
const USER_ID = /^[1-9][0-9]{0,39}$/;
const SECRET_PLACEHOLDER = /^(?:your(?:_|-|$)|change[_-]?me|replace[_-]?me|placeholder|zalo_app_secret(?:_key)?$|app_secret(?:_key)?$|secret$|(?:dien|dan)[_-])|[<>]|\$\{|\{\{/i;

const MESSAGES = Object.freeze({
  invalid_config: 'Zalo identity verification is not configured correctly.',
  invalid_token: 'A valid Zalo access token is required.',
  verification_failed: 'Zalo identity could not be verified.',
  timeout: 'Zalo identity verification timed out.',
});

/** Fixed public errors only: provider bodies, tokens and secrets never escape. */
export class ZaloIdentityError extends Error {
  constructor(code) {
    super(MESSAGES[code] || MESSAGES.verification_failed);
    this.name = 'ZaloIdentityError';
    this.code = code;
  }
}

const boundedAscii = (value, maximum) => typeof value === 'string'
  && value.length > 0 && value.length <= maximum && !NON_PRINTABLE_ASCII.test(value);

/**
 * @param {{
 *   accessToken: string,
 *   appSecret: string,
 *   fetchImpl?: typeof globalThis.fetch,
 *   timeoutMs?: number,
 * }} options
 * @returns {Promise<{ zaloUserId: string }>}
 */
export async function verifyZaloIdentity(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new ZaloIdentityError('invalid_config');
  }
  const { accessToken, appSecret, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = options;
  if (!boundedAscii(appSecret, 1024) || SECRET_PLACEHOLDER.test(appSecret)
    || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new ZaloIdentityError('invalid_config');
  }
  if (!boundedAscii(accessToken, 4096)) throw new ZaloIdentityError('invalid_token');

  // Both values are headers, never URL parameters. Ask only for the ID needed
  // for linking; there is no reason to retrieve names, birthdays or pictures.
  const proof = createHmac('sha256', appSecret).update(accessToken).digest('hex');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new ZaloIdentityError('timeout'));
      controller.abort();
    }, timeoutMs);
  });

  const verify = async () => {
    const response = await fetchImpl(PROFILE_URL, {
      method: 'GET',
      headers: { accept: 'application/json', access_token: accessToken, appsecret_proof: proof },
      // A redirect must not forward credential headers to another host.
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!response || response.ok !== true || typeof response.json !== 'function') {
      throw new ZaloIdentityError('verification_failed');
    }
    const body = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || (Object.hasOwn(body, 'error') && body.error !== 0)
      || !Object.hasOwn(body, 'id') || !boundedAscii(body.id, 40) || !USER_ID.test(body.id)) {
      throw new ZaloIdentityError('verification_failed');
    }
    // The numeric string is an app-scoped Zalo user ID, not a Mini App ID.
    return { zaloUserId: body.id };
  };

  try {
    // The deadline covers fetch AND body parsing, including a fetch mock or
    // transport that ignores AbortSignal. Never fall back to a client ID.
    return await Promise.race([verify(), timeout]);
  } catch {
    // Do not attach `cause`, provider messages, response bodies or request data.
    // Even an injected transport throwing our Error class must not be trusted.
    throw new ZaloIdentityError(controller.signal.aborted ? 'timeout' : 'verification_failed');
  } finally {
    clearTimeout(timer);
  }
}
