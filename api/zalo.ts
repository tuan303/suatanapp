import { AccountLinkError } from '../miniapp/server/account-links.mjs';
import { getLiveZaloService } from './_lib/zalo-runtime.mjs';
import { getZaloUpstreamService } from './_lib/zalo-upstream.mjs';

export const config = { maxDuration: 30 };
const FIELDS: Record<string, string[]> = {
  'web.createChallenge': [], 'web.challengeStatus': ['challengeId'], 'web.confirmLink': ['challengeId'],
  'web.getLink': [], 'web.revokeLink': [], 'mini.login': [], 'mini.claim': ['code'],
  'mini.claimStatus': [], 'mini.me': [], 'mini.logout': [],
};
interface Request { method?: string; headers: Record<string, string | string[] | undefined>; body?: unknown; }
interface Response { setHeader(name: string, value: string): unknown; status(code: number): Response; json(body: unknown): unknown; end?(): unknown; }
interface Service { run(action: string, body: Record<string, unknown>, bearer: string): Promise<unknown>; }
type Dependencies = { env?: Record<string, string | undefined>; getService?: () => Promise<Service> | Service };

export function createZaloHandler({ env = process.env, getService }: Dependencies = {}) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const error = (status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
    const origins = new Set(['https://dkan.nshm.vn', 'https://suatanapp.vercel.app', 'https://h5.zdn.vn']);
    if (env.NODE_ENV !== 'production') for (const host of ['localhost', '127.0.0.1'])
      for (const port of [3000, 4930]) origins.add(`http://${host}:${port}`);
    const origin = req.headers.origin;
    if (origin !== undefined && (typeof origin !== 'string' || !origins.has(origin)))
      return error(403, 'forbidden', 'Nguồn yêu cầu không được phép.');
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204);
      return res.end?.();
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      return error(405, 'invalid_request', 'Chỉ chấp nhận yêu cầu POST.');
    }
    if (env.DKAN_ZALO_ENABLED !== 'true') return error(503, 'not_configured', 'Chức năng liên kết chưa được bật trên máy chủ.');
    const auth = req.headers.authorization;
    const match = typeof auth === 'string' && /^Bearer ([\x21-\x7e]{1,16384})$/.exec(auth);
    if (!match) return error(401, 'auth_required', 'Vui lòng đăng nhập lại để tiếp tục.');
    let action: string, body: Record<string, unknown>;
    try {
      const raw = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error();
      if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > 8192) return error(413, 'invalid_request', 'Yêu cầu quá lớn.');
      action = (raw as Record<string, unknown>).action as string;
      if (typeof action !== 'string' || !Object.hasOwn(FIELDS, action)) throw new Error();
      const allowed = new Set(['action', ...FIELDS[action]]);
      if (Object.keys(raw).some(key => !allowed.has(key))) throw new Error();
      body = Object.fromEntries(FIELDS[action].map(field => [field, (raw as Record<string, unknown>)[field]]));
    } catch { return error(400, 'invalid_request', 'Thông tin yêu cầu không hợp lệ.'); }
    try {
      const service = await (getService ? getService() : getZaloUpstreamService(env) ?? getLiveZaloService(env));
      return res.status(200).json(await service.run(action, body, match[1]));
    } catch (err: unknown) {
      if (err instanceof AccountLinkError) return error(err.status, err.code, err.message);
      return error(503, 'service_unavailable', 'Chưa thể xử lý liên kết tài khoản. Vui lòng thử lại sau.');
    }
  };
}

export default createZaloHandler();
