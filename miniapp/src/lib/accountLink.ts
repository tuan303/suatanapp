// Client for the personal account-link API. Tokens are passed by the caller
// and remain in memory: no cookies or browser/native persistent storage.
export type LinkedProfile = { fullName: string; employeeId: string; department: string; email: string };
export type LinkedSession = { sessionToken: string; expiresAt: number; profile: LinkedProfile };
export type LoginResult = { linked: false } | ({ linked: true } & LinkedSession);
export type ClaimResult = { claimToken: string; expiresAt: number };
export type ClaimState = { state: 'pending' | 'approved' | 'expired'; expiresAt: number };
export type ZaloSdkStage = 'sdk-load' | 'sdk-auth' | 'sdk-result';
export type ZaloSdkEnvironment = 'miniapp' | 'development' | 'web' | 'unknown';
export type ZaloSdkDiagnostic = { stage: ZaloSdkStage; environment: ZaloSdkEnvironment; sdkCode?: number };

const messages: Record<string, string> = {
  not_configured: 'Chưa cấu hình kết nối. Nhà trường cần hoàn tất cấu hình API trước khi liên kết.',
  service_unavailable: 'Máy chủ liên kết chưa xử lý được yêu cầu. Vui lòng thử lại hoặc liên hệ quản trị nhà trường.',
  invalid_origin: 'Địa chỉ API chưa hợp lệ. Vui lòng liên hệ quản trị nhà trường.',
  zalo_required: 'Vui lòng mở Mini App trong Zalo và bấm kiểm tra tài khoản lại.',
  zalo_sdk_load_failed: 'Chưa tải được mô-đun xác thực Zalo. Kiểm tra mạng, đóng Mini App rồi mở lại bản thử nghiệm mới nhất.',
  zalo_auth_failed: 'Chưa lấy được phiên đăng nhập Zalo. Vui lòng đóng Mini App rồi mở lại bản thử nghiệm và kiểm tra tài khoản lần nữa.',
  zalo_token_missing: 'Zalo chưa trả về phiên đăng nhập hợp lệ. Vui lòng đóng Mini App rồi mở lại bản thử nghiệm và thử lại.',
  zalo_permission_denied: 'Bạn chưa đồng ý yêu cầu xác thực Zalo. Có thể bấm kiểm tra lại và xác nhận nếu muốn liên kết tài khoản.',
  zalo_permission_required: 'Phiên Mini App chưa được phép thực hiện xác thực Zalo. Vui lòng liên hệ quản trị để kiểm tra quyền của ứng dụng.',
  zalo_sdk_unsupported: 'API xác thực chưa được hỗ trợ trong phiên này. Hãy kiểm tra phiên bản Zalo và mở lại đúng bản Mini App thử nghiệm.',
  auth_required: 'Phiên xác thực đã hết hạn hoặc chưa hợp lệ. Vui lòng kiểm tra tài khoản Zalo lại.',
  recent_login_required: 'Vui lòng đăng nhập lại tài khoản Microsoft trên website trước khi tạo mã mới.',
  challenge_unavailable: 'Mã liên kết không còn sử dụng được. Hãy tạo mã mới trên website nhà trường.',
  link_conflict: 'Tài khoản đã có liên kết khác. Vui lòng kiểm tra trên website hoặc liên hệ quản trị.',
  rate_limited: 'Có quá nhiều yêu cầu. Vui lòng đợi một lát rồi thử lại.',
  expired: 'Yêu cầu liên kết đã hết hạn. Hãy tạo mã mới trên website nhà trường.',
  invalid_code: 'Vui lòng dán đúng mã liên kết được tạo trên website nhà trường.',
  invalid_response: 'Dữ liệu xác thực trả về chưa hợp lệ. Vui lòng thử lại hoặc liên hệ quản trị.',
  link_not_confirmed: 'Chưa xác nhận được liên kết. Vui lòng kiểm tra tài khoản Zalo lại.',
  forbidden: 'Tài khoản chưa được phép sử dụng chức năng này.',
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

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isToken = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 8192 && /^[\x21-\x7e]+$/.test(value);
const validExpiry = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
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

  async function post(action: string, token: string, fields: Record<string, string> = {}, signal?: AbortSignal) {
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
        // The SDK is imported only after an explicit user action, never on load.
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
      if (data.linked !== true || !isToken(data.sessionToken)) throw new AccountLinkError('invalid_response');
      return { linked: true, sessionToken: data.sessionToken, expiresAt: freshExpiry(data.expiresAt), profile: parseLinkedProfile(data.profile) };
    },
    async claim(token: string, rawCode: string, signal?: AbortSignal): Promise<ClaimResult> {
      const code = rawCode.trim();
      if (!/^[A-Za-z0-9_-]{6,80}$/.test(code)) throw new AccountLinkError('invalid_code');
      const data = await post('mini.claim', token, { code }, signal);
      if (!isToken(data.claimToken)) throw new AccountLinkError('invalid_response');
      return { claimToken: data.claimToken, expiresAt: freshExpiry(data.expiresAt) };
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
  };
}

export type AccountLinkClient = ReturnType<typeof createAccountLinkClient>;
