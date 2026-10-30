// Client for the personal account-link API. Tokens are passed by the caller
// and remain in memory: no cookies or browser/native persistent storage.
export type LinkedProfile = { fullName: string; employeeId: string; department: string; email: string };
export type LinkedSession = { sessionToken: string; expiresAt: number; profile: LinkedProfile };
export type LoginResult = { linked: false } | ({ linked: true } & LinkedSession);
export type ClaimResult = { claimToken: string; expiresAt: number };
export type ClaimState = { state: 'pending' | 'approved' | 'expired'; expiresAt: number };

const messages: Record<string, string> = {
  not_configured: 'Chưa cấu hình kết nối. Nhà trường cần hoàn tất cấu hình API trước khi liên kết.',
  invalid_origin: 'Địa chỉ API chưa hợp lệ. Vui lòng liên hệ quản trị nhà trường.',
  zalo_required: 'Vui lòng mở Mini App trong Zalo và bấm kiểm tra tài khoản lại.',
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

export class AccountLinkError extends Error {
  readonly code: string;
  constructor(code: string) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'request_failed';
    super(messages[safeCode]);
    this.name = 'AccountLinkError';
    this.code = safeCode;
  }
}

export function accountLinkMessage(error: unknown): string {
  return error instanceof AccountLinkError ? error.message : messages.request_failed;
}

/** Only the fixed school origin is allowed in builds distributed to users. */
export function resolveAccountApiOrigin(value: unknown, development = false): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new AccountLinkError('invalid_origin');
  const candidate = value.trim();
  if (!candidate) return null;
  let url: URL;
  try { url = new URL(candidate); } catch { throw new AccountLinkError('invalid_origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AccountLinkError('invalid_origin');
  const school = url.protocol === 'https:' && url.hostname === 'dkan.nshm.vn' && !url.port;
  const local = development && ['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!school && !local) throw new AccountLinkError('invalid_origin');
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
  return ({ 401: 'auth_required', 403: 'forbidden', 409: 'challenge_unavailable', 410: 'expired', 429: 'rate_limited', 503: 'not_configured' } as Record<number, string>)[status] || 'request_failed';
}

type ClientOptions = {
  origin?: unknown;
  development?: boolean;
  fetchImpl?: typeof fetch;
  tokenProvider?: () => Promise<string>;
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
    async getZaloToken(signal?: AbortSignal) {
      requireOrigin();
      cancelled(signal);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let abort: (() => void) | undefined;
      try {
        // The SDK is imported only after an explicit user action, never on load.
        const provider = async () => options.tokenProvider ? options.tokenProvider() : (await import('zmp-sdk')).getAccessToken();
        const interruption = new Promise<string>((_resolve, reject) => {
          abort = () => reject(new AccountLinkError('cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
          timer = setTimeout(() => reject(new AccountLinkError('timeout')), timeoutMs);
        });
        const token = await Promise.race([provider(), interruption]);
        cancelled(signal);
        if (!isToken(token)) throw new AccountLinkError('zalo_required');
        return token;
      } catch (error) {
        cancelled(signal);
        if (error instanceof AccountLinkError) throw error;
        throw new AccountLinkError('zalo_required');
      } finally {
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
