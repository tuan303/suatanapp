// Client for the personal account-link API. Tokens are passed by the caller
// and remain in memory: no cookies or browser/native persistent storage.
import { MEAL_ACTION_FIELDS } from '../../shared/meal-contract.mjs';
export type LinkedProfile = { fullName: string; employeeId: string; department: string; email: string };
export type LinkedSession = { sessionToken: string; expiresAt: number; profile: LinkedProfile };
export type LoginResult = { linked: false } | ({ linked: true } & LinkedSession);
export type ClaimResult = { claimToken: string; expiresAt: number };
export type ClaimState = { state: 'pending' | 'approved' | 'expired'; expiresAt: number };
export type OtpSent = { state: 'sent'; emailMasked: string; expiresAt: number; resendAt: number; replacesExisting: boolean };
export type OtpRequestResult = { state: 'linked' } | OtpSent;
export type ZaloSdkStage = 'sdk-load' | 'sdk-auth' | 'sdk-result';
export type ZaloSdkEnvironment = 'miniapp' | 'development' | 'web' | 'unknown';
export type ZaloSdkDiagnostic = { stage: ZaloSdkStage; environment: ZaloSdkEnvironment; sdkCode?: number };

const messages: Record<string, string> = {
  not_configured: 'Chưa cấu hình kết nối. Nhà trường cần hoàn tất cấu hình API trước khi liên kết.',
  service_unavailable: 'Máy chủ liên kết chưa xử lý được yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị nhà trường.',
  invalid_origin: 'Địa chỉ API chưa hợp lệ. Vui lòng liên hệ quản trị nhà trường.',
  zalo_required: 'Vui lòng mở Mini App trong Zalo và thử lại.',
  zalo_sdk_load_failed: 'Chưa tải được mô-đun xác thực Zalo. Kiểm tra mạng, đóng Mini App rồi mở lại bản thử nghiệm mới nhất.',
  zalo_auth_failed: 'Chưa lấy được phiên đăng nhập Zalo. Vui lòng đóng Mini App rồi mở lại bản thử nghiệm và thử lại.',
  zalo_token_missing: 'Zalo chưa trả về phiên đăng nhập hợp lệ. Vui lòng đóng Mini App rồi mở lại bản thử nghiệm và thử lại.',
  zalo_permission_denied: 'Thầy/Cô chưa đồng ý yêu cầu xác thực Zalo. Có thể thử lại và chọn đồng ý nếu muốn liên kết tài khoản.',
  zalo_permission_required: 'Phiên Mini App chưa được phép thực hiện xác thực Zalo. Vui lòng liên hệ quản trị để kiểm tra quyền của ứng dụng.',
  zalo_sdk_unsupported: 'API xác thực chưa được hỗ trợ trong phiên này. Hãy kiểm tra phiên bản Zalo và mở lại đúng bản Mini App thử nghiệm.',
  auth_required: 'Phiên xác thực đã hết hạn hoặc chưa hợp lệ. Vui lòng đăng nhập lại bằng Zalo.',
  recent_login_required: 'Vui lòng đăng nhập lại tài khoản Microsoft trên website trước khi tạo mã mới.',
  challenge_unavailable: 'Mã liên kết không còn sử dụng được. Hãy tạo mã mới trên website nhà trường.',
  link_conflict: 'Tài khoản đã có liên kết khác. Vui lòng kiểm tra trên website hoặc liên hệ quản trị.',
  rate_limited: 'Có quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại.',
  expired: 'Yêu cầu liên kết đã hết hạn. Hãy tạo mã mới trên website nhà trường.',
  invalid_code: 'Vui lòng dán đúng mã liên kết được tạo trên website nhà trường.',
  invalid_response: 'Dữ liệu xác thực trả về chưa hợp lệ. Vui lòng thử lại hoặc liên hệ quản trị.',
  link_not_confirmed: 'Chưa xác nhận được liên kết. Vui lòng đăng nhập lại bằng Zalo.',
  forbidden: 'Tài khoản chưa được phép sử dụng chức năng này.',
  account_unavailable: 'Tài khoản nhà trường chưa thể sử dụng. Vui lòng đăng nhập lại trên website hoặc liên hệ bộ phận CNTT.',
  email_verification_required: 'Vui lòng mở trang liên kết trên website để xác minh email nhà trường, sau đó đăng nhập lại bằng Zalo.',
  otp_invalid: 'Mã xác minh chưa đúng. Thầy/Cô kiểm tra lại mã trong thư.',
  otp_expired: 'Mã xác minh đã hết hạn hoặc nhập sai quá nhiều lần. Vui lòng gửi mã mới.',
  account_not_found: 'Chưa có tài khoản Suất ăn cho email này. Thầy/Cô đăng nhập website suất ăn của trường một lần bằng tài khoản Microsoft, rồi thử lại.',
  email_link_unavailable: 'Liên kết bằng email chưa được bật trên máy chủ. Vui lòng liên hệ bộ phận CNTT.',
  invalid_email: 'Email chưa đúng. Thầy/Cô nhập email nhà trường, ví dụ tenban@hoangmaistarschool.edu.vn.',
  invalid_request: 'Thông tin gửi chưa hợp lệ. Vui lòng kiểm tra lựa chọn và thử lại.',
  registration_closed: 'Đã hết hạn đăng ký hoặc điều chỉnh cho tháng này.',
  registration_blocked: 'Tài khoản đang bị hạn chế đăng ký. Vui lòng kiểm tra thông tin trên website hoặc liên hệ bộ phận phụ trách.',
  cancellation_closed: 'Một hoặc nhiều bữa đã quá hạn hủy. Vui lòng tải lại dữ liệu để kiểm tra.',
  event_closed: 'Sự kiện đã đóng đăng ký hoặc không còn phục vụ.',
  survey_closed: 'Khảo sát chưa mở hoặc đã hết hạn trả lời.',
  data_unavailable: 'Dữ liệu chưa sẵn sàng. Vui lòng tải lại hoặc liên hệ bộ phận phụ trách.',
  profile_incomplete: 'Hồ sơ nhà trường chưa đủ thông tin. Vui lòng cập nhật hồ sơ trên website.',
  already_registered: 'Đơn đăng ký tháng đã được ghi nhận. Vui lòng tải lại dữ liệu.',
  not_registered: 'Chưa đăng ký bữa ăn này hoặc bữa không thuộc thời gian phục vụ.',
  already_cancelled: 'Bữa này đã được báo hủy trước đó. Vui lòng tải lại dữ liệu.',
  already_responded: 'Lựa chọn sự kiện đã được ghi nhận trước đó. Vui lòng tải lại dữ liệu.',
  timeout: 'Kết nối quá thời gian chờ. Vui lòng thử lại.',
  network: 'Chưa kết nối được máy chủ. Kiểm tra kết nối mạng rồi thử lại.',
  cancelled: 'Yêu cầu đã được hủy.',
  request_failed: 'Chưa hoàn tất được yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị.',
};

function boundedSdkCode(value: unknown): number | undefined {
  const number = typeof value === 'string' && /^-?\d{1,5}$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= -99999 && number <= 99999 ? number : undefined;
}

function safeSdkDiagnostic(value: unknown): ZaloSdkDiagnostic | undefined {
  if (!value || typeof value !== 'object') return undefined;
  try {
    const source = value as Record<string, unknown>;
    const stage = source.stage, environment = source.environment;
    if (typeof stage !== 'string' || !['sdk-load', 'sdk-auth', 'sdk-result'].includes(stage)
      || typeof environment !== 'string' || !['miniapp', 'development', 'web', 'unknown'].includes(environment)) return undefined;
    const sdkCode = boundedSdkCode(source.sdkCode);
    return Object.freeze({ stage: stage as ZaloSdkStage, environment: environment as ZaloSdkEnvironment,
      ...(sdkCode === undefined ? {} : { sdkCode }) });
  } catch { return undefined; }
}

/** Support context only. This classification never proves identity or grants access. */
export function classifyZaloSdkEnvironment(locationLike: unknown = typeof location === 'undefined' ? undefined : location): ZaloSdkEnvironment {
  if (!locationLike || typeof locationLike !== 'object') return 'unknown';
  try {
    const source = locationLike as { hostname?: unknown; pathname?: unknown; search?: unknown };
    if (typeof source.hostname !== 'string' || typeof source.pathname !== 'string') return 'unknown';
    const host = source.hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '[::1]'].includes(host)) return 'development';
    const testingLocal = typeof source.search === 'string' && new URLSearchParams(source.search).get('env') === 'TESTING_LOCAL';
    if (host === 'h5.zdn.vn' && (source.pathname === '/zapps' || source.pathname.startsWith('/zapps/') || testingLocal)) return 'miniapp';
    return 'web';
  } catch { return 'unknown'; }
}

export class AccountLinkError extends Error {
  readonly code: string;
  readonly diagnostic?: ZaloSdkDiagnostic;
  constructor(code: string, diagnostic?: unknown) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'request_failed';
    super(messages[safeCode]);
    this.name = 'AccountLinkError';
    this.code = safeCode;
    this.diagnostic = safeSdkDiagnostic(diagnostic);
  }
}

export function accountLinkMessage(error: unknown): string {
  if (!(error instanceof AccountLinkError)) return messages.request_failed;
  const diagnostic = safeSdkDiagnostic(error.diagnostic);
  if (!diagnostic) return error.message;
  return `${error.message} Mã hỗ trợ: ${diagnostic.stage}/${diagnostic.environment}${diagnostic.sdkCode === undefined ? '' : `/Zalo ${diagnostic.sdkCode}`}.`;
}

function sdkErrorCode(error: unknown): number | undefined {
  try { return error && typeof error === 'object' ? boundedSdkCode((error as { code?: unknown }).code) : undefined; }
  catch { return undefined; }
}

function sdkFailure(error: unknown, stage: ZaloSdkStage, environment: ZaloSdkEnvironment): AccountLinkError {
  const sdkCode = sdkErrorCode(error);
  let code = 'zalo_auth_failed';
  if (stage === 'sdk-load') code = 'zalo_sdk_load_failed';
  else if ([-201, -202, -2002].includes(sdkCode ?? NaN)) code = 'zalo_permission_denied';
  else if (sdkCode === -1403) code = 'zalo_permission_required';
  else if (sdkCode === -1404) code = 'zalo_sdk_unsupported';
  else if (sdkCode === -1408) code = 'timeout';
  else if (sdkCode === -203) code = 'rate_limited';
  return new AccountLinkError(code, { stage, environment, sdkCode });
}

/** Only the reviewed production origins are allowed in distributed builds. */
export function resolveAccountApiOrigin(value: unknown, development = false): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AccountLinkError('invalid_origin');
  const candidate = value.trim();
  if (!candidate) return null;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new AccountLinkError('invalid_origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AccountLinkError('invalid_origin');
  const production = url.protocol === 'https:'
    && ['dkan.nshm.vn', 'suatanapp.vercel.app'].includes(url.hostname) && !url.port;
  const local = development && ['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!production && !local) throw new AccountLinkError('invalid_origin');
  return url.origin;
}

export const SCHOOL_EMAIL_DOMAIN = 'hoangmaistarschool.edu.vn';
// Same pattern as miniapp/server/account-links.mjs; the server stays authoritative.
const SCHOOL_EMAIL = /^[A-Za-z0-9][A-Za-z0-9._%+-]{0,63}@hoangmaistarschool\.edu\.vn$/i;
// The server reveals only the first and last character of the local part.
// Any other shape (e.g. a full address or provider text) is never displayed.
const MASKED_EMAIL = /^[A-Za-z0-9]\*{3}[A-Za-z0-9._%+-]?@hoangmaistarschool\.edu\.vn$/i;

/** Same rule as the server: "tenban" means tenban@<school domain>. Null when it cannot be a school address. */
export function normalizeSchoolEmail(input: string): string | null {
  if (typeof input !== 'string' || input.length > 254) return null;
  let email = input.trim().toLowerCase();
  if (!email.includes('@')) email = `${email}@${SCHOOL_EMAIL_DOMAIN}`;
  return email.length <= 254 && SCHOOL_EMAIL.test(email) ? email : null;
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isToken = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value);
const validExpiry = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value)
  && value > 0 && value <= 8_640_000_000_000_000;
const profileText = (value: unknown, maximum: number, required = false): string => {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || (required && !value.trim())) {
    throw new AccountLinkError('invalid_response');
  }
  return value;
};
export function parseLinkedProfile(value: unknown): LinkedProfile {
  if (!isObject(value)) throw new AccountLinkError('invalid_response');
  return {
    fullName: profileText(value.fullName, 160, true),
    employeeId: profileText(value.employeeId, 80),
    department: profileText(value.department, 200),
    email: profileText(value.email, 254),
  };
}

function errorCode(body: unknown, status: number) {
  const candidate = isObject(body) && isObject(body.error) ? body.error.code
    : isObject(body) && typeof body.error === 'string' ? body.error : isObject(body) ? body.code : null;
  if (typeof candidate === 'string' && Object.hasOwn(messages, candidate)) return candidate;
  return ({ 401: 'auth_required', 403: 'forbidden', 409: 'challenge_unavailable', 410: 'expired', 429: 'rate_limited', 503: 'service_unavailable' } as Record<number, string>)[status] || 'request_failed';
}

type ClientOptions = {
  origin?: unknown;
  development?: boolean;
  fetchImpl?: typeof fetch;
  tokenProvider?: () => Promise<string>;
  sdkLoader?: () => Promise<{ getAccessToken: () => Promise<string> }>;
  now?: () => number;
  timeoutMs?: number;
};

export function createAccountLinkClient(options: ClientOptions = {}) {
  const origin = resolveAccountApiOrigin(options.origin, options.development);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || Date.now;
  const timeoutMs = options.timeoutMs ?? 12000;
  const requireOrigin = () => { if (!origin) throw new AccountLinkError('not_configured'); return origin; };
  const cancelled = (signal?: AbortSignal) => { if (signal?.aborted) throw new AccountLinkError('cancelled'); };
  const freshExpiry = (value: unknown) => {
    if (!validExpiry(value) || value <= now() || value > now() + 86400000) throw new AccountLinkError('invalid_response');
    return value;
  };

  function linkedSession(data: Record<string, unknown>): LinkedSession & { linked: true } {
    if (data.linked !== true || !isToken(data.sessionToken)) throw new AccountLinkError('invalid_response');
    return { linked: true, sessionToken: data.sessionToken, expiresAt: freshExpiry(data.expiresAt), profile: parseLinkedProfile(data.profile) };
  }

  async function post(action: string, token: string, fields: Record<string, unknown> = {}, signal?: AbortSignal) {
    const endpoint = `${requireOrigin()}/api/zalo`;
    cancelled(signal);
    if (!isToken(token)) throw new AccountLinkError('auth_required');
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST', credentials: 'omit', mode: 'cors', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, ...fields }), signal: controller.signal,
      });
      cancelled(signal);
      let data: unknown;
      try { data = await response.json(); }
      catch { throw new AccountLinkError(response.ok ? 'invalid_response' : errorCode(null, response.status)); }
      cancelled(signal);
      if (!response.ok) throw new AccountLinkError(errorCode(data, response.status));
      if (!isObject(data)) throw new AccountLinkError('invalid_response');
      return data;
    } catch (error) {
      cancelled(signal);
      if (timedOut) throw new AccountLinkError('timeout');
      if (error instanceof AccountLinkError) throw error;
      throw new AccountLinkError('network');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    configured: !!origin,
    websiteUrl: origin ? `${origin}/lien-ket-zalo` : null,
    async getZaloToken(signal?: AbortSignal) {
      requireOrigin();
      cancelled(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      let stage: ZaloSdkStage = options.tokenProvider ? 'sdk-auth' : 'sdk-load';
      const environment = classifyZaloSdkEnvironment();
      let timedOut = false, closed = false;
      const active = () => {
        cancelled(signal);
        if (timedOut) throw new AccountLinkError('timeout', { stage, environment });
        if (closed) throw new AccountLinkError('cancelled');
      };
      const provider = async () => {
        let getToken = options.tokenProvider;
        if (!getToken) {
          let sdk;
          try { sdk = await (options.sdkLoader ? options.sdkLoader() : import('zmp-sdk')); }
          catch (error) { active(); throw sdkFailure(error, 'sdk-load', environment); }
          // Import may finish after a timeout/unmount: do not call getAccessToken then.
          active();
          if (!sdk || typeof sdk.getAccessToken !== 'function') throw new AccountLinkError('zalo_sdk_load_failed', { stage, environment });
          getToken = () => sdk.getAccessToken();
        }
        active();
        stage = 'sdk-auth';
        let token;
        try { token = await getToken(); }
        catch (error) { active(); throw sdkFailure(error, stage, environment); }
        active();
        stage = 'sdk-result';
        return token;
      };
      try {
        // The SDK is imported only when a token is needed: automatically on open
        // inside Zalo (App.tsx silent sign-in) or after a user action. Outside
        // Zalo nothing imports it on load.
        const interruption = new Promise<string>((_resolve, reject) => {
          abort = () => reject(new AccountLinkError('cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => { timedOut = true; reject(new AccountLinkError('timeout', { stage, environment })); }, timeoutMs);
        });
        const token = await Promise.race([provider(), interruption]);
        active();
        if (!isToken(token)) throw new AccountLinkError('zalo_token_missing', { stage: 'sdk-result', environment });
        return token;
      } catch (error) {
        cancelled(signal);
        if (error instanceof AccountLinkError) throw error;
        throw sdkFailure(error, stage, environment);
      } finally {
        closed = true;
        if (timer !== undefined) clearTimeout(timer);
        if (abort) signal?.removeEventListener('abort', abort);
      }
    },
    async login(token: string, signal?: AbortSignal): Promise<LoginResult> {
      const data = await post('mini.login', token, {}, signal);
      if (data.linked === false) return { linked: false };
      return linkedSession(data);
    },
    async requestOtp(token: string, email: string, signal?: AbortSignal): Promise<OtpRequestResult> {
      const normalized = normalizeSchoolEmail(email);
      if (!normalized) throw new AccountLinkError('invalid_email');
      const data = await post('mini.requestOtp', token, { email: normalized }, signal);
      // An existing link sends no mail; the caller continues with mini.login.
      if (data.state === 'linked') return { state: 'linked' };
      if (data.state !== 'sent' || typeof data.emailMasked !== 'string' || !MASKED_EMAIL.test(data.emailMasked)
        || !validExpiry(data.expiresAt) || !validExpiry(data.resendAt) || data.resendAt > data.expiresAt
        || typeof data.replacesExisting !== 'boolean') throw new AccountLinkError('invalid_response');
      // Server clock values: the device only displays them. The server enforces expiry and cooldown.
      return { state: 'sent', emailMasked: data.emailMasked, expiresAt: data.expiresAt, resendAt: data.resendAt, replacesExisting: data.replacesExisting };
    },
    async verifyOtp(token: string, rawCode: string, signal?: AbortSignal): Promise<LinkedSession & { linked: true }> {
      const code = typeof rawCode === 'string' ? rawCode.trim() : '';
      if (!/^\d{6}$/.test(code)) throw new AccountLinkError('otp_invalid');
      // A correct code always links; any other success shape is not a session.
      return linkedSession(await post('mini.verifyOtp', token, { code }, signal));
    },
    async claim(token: string, rawCode: string, signal?: AbortSignal): Promise<ClaimResult> {
      const code = rawCode.trim();
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(code)) throw new AccountLinkError('invalid_code');
      const data = await post('mini.claim', token, { code }, signal);
      if (!isToken(data.claimToken) || !validExpiry(data.expiresAt)) throw new AccountLinkError('invalid_response');
      // The device clock only displays the deadline. The server decides claim expiry.
      return { claimToken: data.claimToken, expiresAt: data.expiresAt };
    },
    async claimStatus(token: string, signal?: AbortSignal): Promise<ClaimState> {
      const data = await post('mini.claimStatus', token, {}, signal);
      if (!['pending', 'approved', 'expired'].includes(String(data.state)) || !validExpiry(data.expiresAt)) throw new AccountLinkError('invalid_response');
      return { state: data.state as ClaimState['state'], expiresAt: data.expiresAt };
    },
    async me(token: string, signal?: AbortSignal): Promise<LinkedProfile> {
      const data = await post('mini.me', token, {}, signal);
      return parseLinkedProfile(data.profile);
    },
    async logout(token: string, signal?: AbortSignal) {
      await post('mini.logout', token, {}, signal);
    },
    async business(action: string, token: string, fields: Record<string, unknown>, signal?: AbortSignal) {
      if (!Object.hasOwn(MEAL_ACTION_FIELDS, action) || !isObject(fields)
        || Object.keys(fields).length !== MEAL_ACTION_FIELDS[action].length
        || MEAL_ACTION_FIELDS[action].some(key => !Object.hasOwn(fields, key))) throw new AccountLinkError('invalid_request');
      return post(action, token, fields, signal);
    },
  };
}

export type AccountLinkClient = ReturnType<typeof createAccountLinkClient>;
