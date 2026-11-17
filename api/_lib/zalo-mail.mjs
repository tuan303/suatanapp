// SERVER ONLY. Pure ESM on purpose: esbuild bundles this into the Vietnam API
// server.cjs and Vercel functions import it directly, so do not import the
// TypeScript api/_lib/msgraph.ts from here. It mirrors that module's Graph
// flow (app-only client credentials from MS_GRAPH_SENDER, 10 s per request,
// saveToSentItems false) for exactly two Zalo link notices.
//
// Provider bodies are never read on failure: Entra/Graph errors can echo
// addresses, tenant details or request IDs, and none of that may reach a Mini
// App user or a log line. Errors carry only a fixed code and an HTTP status.
import { reportZaloDiagnostic } from './zalo-diagnostics.mjs';

const SCHOOL_ADDRESS = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@hoangmaistarschool\.edu\.vn$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN = /^(?=.{3,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Same heuristic as the Zalo secret check: values copied from .env.example
// ("your_client_secret_here") must disable mail, not reach Entra.
const PLACEHOLDER = /^(?:your|dien_|dan_|change|replace|placeholder)|[<>]|\$\{|\{\{/i;
const ACCESS_TOKEN = /^[\x21-\x7e]{1,16384}$/;
const SCOPE = 'https://graph.microsoft.com/.default';
const UNLINK_URL = 'https://suatanapp.vercel.app/lien-ket-zalo';
export const ZALO_MAIL_TIMEOUT_MS = 10_000;
// Refresh a cached app token this long before Entra says it expires, so a
// token never dies between the cache check and Graph accepting the mail.
const TOKEN_MARGIN_MS = 60_000;
const MAX_TOKEN_RESPONSE_BYTES = 32_768;
// Viet Nam has used UTC+7 without daylight saving since 1975; a fixed offset
// keeps the text identical on servers without full ICU time-zone data.
const VIETNAM_OFFSET_MS = 7 * 60 * 60_000;
const LATEST_TIME = Date.UTC(3000, 0, 1);

const ENV = Object.freeze({ tenantId: 'MS_GRAPH_TENANT_ID', clientId: 'MS_GRAPH_CLIENT_ID',
  clientSecret: 'MS_GRAPH_CLIENT_SECRET', sender: 'MS_GRAPH_SENDER' });
const VALID = Object.freeze({
  tenantId: value => GUID.test(value) || TENANT_DOMAIN.test(value),
  clientId: value => GUID.test(value),
  clientSecret: value => /^[\x21-\x7e]{8,1024}$/.test(value) && !PLACEHOLDER.test(value),
  // Mail must come from a school mailbox; a typo must not send OTPs as someone else.
  sender: value => value.length <= 254 && SCHOOL_ADDRESS.test(value),
});

const MESSAGES = Object.freeze({
  invalid_config: 'Zalo link mail is not configured correctly.',
  invalid_message: 'Zalo link mail message is invalid.',
  token_failed: 'Microsoft Graph token request failed.',
  token_timeout: 'Microsoft Graph token request timed out.',
  send_failed: 'Microsoft Graph did not accept the Zalo link mail.',
  send_timeout: 'Microsoft Graph mail request timed out.',
});

/** Fixed text only: never a provider body, address, code, token or secret. */
export class ZaloMailError extends Error {
  constructor(code, httpStatus) {
    const selected = Object.hasOwn(MESSAGES, code) ? code : 'send_failed';
    super(MESSAGES[selected]);
    this.name = 'ZaloMailError';
    this.code = selected;
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) this.httpStatus = httpStatus;
  }
}

function parseEnv(env) {
  const values = {}, missing = [], invalid = [];
  for (const [key, name] of Object.entries(ENV)) {
    let raw;
    try { raw = env?.[name]; } catch { raw = undefined; }
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === undefined || value === null || value === '') missing.push(name);
    else if (typeof value !== 'string' || !VALID[key](value)) invalid.push(name);
    else values[key] = value;
  }
  return { values, missing, invalid };
}

/** Missing OR invalid settings return null so only the OTP actions turn off. */
export function readZaloMailConfig(env = {}) {
  try {
    const { values, missing, invalid } = parseEnv(env);
    if (missing.length || invalid.length) return null;
    return Object.freeze({ tenantId: values.tenantId, clientId: values.clientId,
      clientSecret: values.clientSecret, sender: values.sender.toLowerCase() });
  } catch { return null; }
}

/** Variable NAMES only, for one operator log line; values never leave here. */
export function inspectZaloMailEnv(env = {}) {
  try { const { missing, invalid } = parseEnv(env); return { missing, invalid }; }
  catch { return { missing: Object.values(ENV), invalid: [] }; }
}

/** One fixed log line with a fixed code and bounded HTTP status only (throttled by default). */
export function reportZaloMailFailure(error, report = reportZaloDiagnostic) {
  try {
    const own = error instanceof ZaloMailError, code = own ? error.code : undefined, httpStatus = own ? error.httpStatus : undefined;
    const diagnostic = { code: typeof code === 'string' && Object.hasOwn(MESSAGES, code) ? code : 'unknown' };
    if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) diagnostic.httpStatus = httpStatus;
    report(`DKAN_ZALO_MAIL_FAILED ${JSON.stringify(diagnostic)}`);
  } catch { /* Diagnostics must never change the RPC result. */ }
}

const validConfig = config => !!config && typeof config === 'object' && Object.keys(ENV).every(key => {
  const value = config[key];
  return typeof value === 'string' && value === value.trim() && VALID[key](value);
});
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const timeValid = value => Number.isSafeInteger(value) && value > 0 && value < LATEST_TIME;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
// Control, zero-width and bidi-override characters could disguise a name in
// the greeting; the name is cosmetic, so drop them rather than reject the mail.
const cleanName = value => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f-\u009f\u{200b}-\u{200f}\u{2028}-\u{202e}\u{2060}-\u{2069}\u{feff}]/gu, ' ')
    .replace(/\s+/g, ' ').trim().slice(0, 160) : '';
const two = value => String(value).padStart(2, '0');
function vietnamTime(ms) {
  const date = new Date(ms + VIETNAM_OFFSET_MS);
  return { clock: `${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`,
    day: `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}`, year: date.getUTCFullYear() };
}

const P = 'margin:0 0 12px';
const layout = paragraphs => '<div style="max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e6ee;'
  + 'border-radius:12px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937">'
  + paragraphs.join('')
  + `<p style="margin:16px 0 0;font-size:13px;color:#6b7280">Thư được gửi tự động từ hệ thống Suất ăn Ngôi Sao Hoàng Mai. `
  + 'Vui lòng không trả lời thư này.</p></div>';

function compose(message) {
  const invalid = () => { throw new ZaloMailError('invalid_message'); };
  if (!plainObject(message)) invalid();
  // Only school mailboxes: this module must never become a mail relay.
  if (typeof message.to !== 'string' || message.to.length > 254 || !SCHOOL_ADDRESS.test(message.to)) invalid();
  if (message.name !== undefined && message.name !== null && typeof message.name !== 'string') invalid();
  const to = message.to.toLowerCase(), name = cleanName(message.name);
  const greeting = `<p style="${P}">Kính gửi Thầy/Cô${name ? ` ${escapeHtml(name)}` : ''},</p>`;
  if (message.kind === 'otp') {
    if (typeof message.code !== 'string' || !/^\d{6}$/.test(message.code) || !timeValid(message.expiresAt)) invalid();
    // Minutes are truncated, so the stated end is never later than the real one.
    const until = vietnamTime(message.expiresAt), code = escapeHtml(message.code);
    return { to, subject: `Mã xác minh liên kết Zalo: ${message.code}`, html: layout([greeting,
      `<p style="${P}">Mã xác minh để liên kết Zalo Mini App với tài khoản Suất ăn của Thầy/Cô là:</p>`,
      `<p style="margin:16px 0;font-size:32px;font-weight:700;letter-spacing:8px;color:#12264a">${code}</p>`,
      `<p style="${P}"><strong>Mã có hiệu lực đến ${until.clock} ngày ${until.day}</strong> (giờ Việt Nam). `
        + 'Thầy/Cô nhập mã này trong Zalo Mini App Suất ăn để hoàn tất liên kết.</p>',
      `<p style="${P}">Nếu Thầy/Cô không yêu cầu, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.</p>`]) };
  }
  if (message.kind === 'linked') {
    if (!timeValid(message.linkedAt)) invalid();
    const at = vietnamTime(message.linkedAt);
    return { to, subject: 'Tài khoản Suất ăn vừa liên kết với Zalo', html: layout([greeting,
      `<p style="${P}">Tài khoản Suất ăn <strong>${escapeHtml(to)}</strong> vừa được liên kết với Zalo Mini App lúc `
        + `<strong>${at.clock} ngày ${at.day}/${at.year}</strong> (giờ Việt Nam). Từ nay Thầy/Cô mở Mini App là tự đăng nhập.</p>`,
      `<p style="${P}">Nếu không phải Thầy/Cô, vào <a href="${UNLINK_URL}" style="color:#d21235">${UNLINK_URL}</a> `
        + 'để hủy liên kết và báo bộ phận CNTT.</p>']) };
  }
  return invalid();
}

// Release the connection without reading text a provider may have put there.
function discard(response) {
  try { const done = response?.body?.cancel?.(); if (done && typeof done.catch === 'function') done.catch(() => {}); }
  catch { /* Nothing from the body is needed. */ }
}

async function readBounded(response, limit, controller) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d{1,8}$/.test(length) || Number(length) > limit)) throw new Error('too large');
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error('bad chunk');
      size += value.byteLength;
      if (size > limit) {
        controller.abort();
        void reader.cancel().catch(() => {});
        throw new Error('too large');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function readToken(response, controller) {
  const body = JSON.parse(await readBounded(response, MAX_TOKEN_RESPONSE_BYTES, controller));
  // The token becomes an Authorization header: printable ASCII only, so a
  // broken proxy response can never inject a header line.
  if (!plainObject(body) || typeof body.access_token !== 'string' || !ACCESS_TOKEN.test(body.access_token)
    || (body.token_type !== undefined && (typeof body.token_type !== 'string' || body.token_type.toLowerCase() !== 'bearer')))
    throw new Error('bad token');
  const seconds = typeof body.expires_in === 'string' && /^\d{1,6}$/.test(body.expires_in) ? Number(body.expires_in) : body.expires_in;
  return { token: body.access_token,
    lifetimeMs: Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 86_400 ? seconds * 1000 : 0 };
}

/**
 * @param {{ tenantId: string, clientId: string, clientSecret: string, sender: string }} config from readZaloMailConfig
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, timeoutMs?: number }} [options]
 * @returns {{ send(message: { kind: 'otp', to: string, code: string, expiresAt: number, name?: string }
 *   | { kind: 'linked', to: string, linkedAt: number, name?: string }): Promise<void> }}
 */
export function createZaloMailer(config, options = {}) {
  let fetchImpl, now, timeoutMs;
  try { ({ fetchImpl = globalThis.fetch, now = () => Date.now(), timeoutMs = ZALO_MAIL_TIMEOUT_MS } = options ?? {}); }
  catch { throw new ZaloMailError('invalid_config'); }
  if (!validConfig(config) || typeof fetchImpl !== 'function' || typeof now !== 'function'
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > ZALO_MAIL_TIMEOUT_MS) throw new ZaloMailError('invalid_config');
  // Copy once: a caller mutating its config object later cannot redirect mail.
  const sender = config.sender.toLowerCase();
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  // Keep "@" literal like api/send-email.ts (proven live); encode everything else.
  const sendUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender).replace(/%40/g, '@')}/sendMail`;
  const tokenBody = new URLSearchParams({ client_id: config.clientId, scope: SCOPE,
    client_secret: config.clientSecret, grant_type: 'client_credentials' }).toString();
  const clock = () => { try { const value = now(); return Number.isSafeInteger(value) && value >= 0 ? value : NaN; } catch { return NaN; } };
  let cached = null, pending = null;

  async function request(url, init, stage, read) {
    const controller = new AbortController();
    let timer, timedOut = false, httpStatus;
    // Race as well as abort: a transport or body stream that ignores the
    // signal still cannot hold the RPC past its own deadline.
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout')); }, timeoutMs);
    });
    const run = async () => {
      const response = await fetchImpl(url, { ...init, redirect: 'error', cache: 'no-store',
        credentials: 'omit', signal: controller.signal });
      if (response && Number.isInteger(response.status)) httpStatus = response.status;
      if (!response || response.ok !== true || !(httpStatus >= 200 && httpStatus <= 299)) {
        discard(response);
        throw new Error('rejected');
      }
      return read(response, controller);
    };
    try { return await Promise.race([run(), deadline]); }
    catch {
      // Rebuilt from local state only. A transport error, even one imitating
      // this class, never carries its text or properties across.
      throw new ZaloMailError(`${stage}_${timedOut ? 'timeout' : 'failed'}`, httpStatus);
    } finally { clearTimeout(timer); }
  }

  function token() {
    const started = clock();
    if (cached && Number.isFinite(started) && started < cached.refreshAt) return Promise.resolve(cached.token);
    // Concurrent OTP requests share one token request instead of each asking Entra.
    pending ??= request(tokenUrl, { method: 'POST', headers: { accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded' }, body: tokenBody }, 'token', readToken)
      .then(({ token: value, lifetimeMs }) => {
        // Counted from before the request, so the cache errs towards refreshing early.
        cached = Number.isFinite(started) && lifetimeMs > TOKEN_MARGIN_MS
          ? { token: value, refreshAt: started + lifetimeMs - TOKEN_MARGIN_MS } : null;
        return value;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  return Object.freeze({
    async send(message) {
      const mail = compose(message);
      const accessToken = await token();
      const payload = JSON.stringify({ message: { subject: mail.subject, body: { contentType: 'HTML', content: mail.html },
        toRecipients: [{ emailAddress: { address: mail.to } }] }, saveToSentItems: false });
      try {
        // Graph answers 202 with no content; nothing in the body is needed.
        await request(sendUrl, { method: 'POST', headers: { authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json' }, body: payload }, 'send', response => { discard(response); });
      } catch (error) {
        // A revoked or early-expired app token must not be reused for the next code.
        if (error?.httpStatus === 401 && cached?.token === accessToken) cached = null;
        throw error;
      }
    },
  });
}
