import { getLiveZaloWithdrawalService } from './_lib/zalo-webhook-runtime.mjs';
import { ZaloWithdrawalError } from '../miniapp/server/zalo-withdrawal.mjs';

interface Request {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
interface Response {
  setHeader(name: string, value: string): unknown;
  status(code: number): Response;
  json(body: unknown): unknown;
}
interface Service { handle(body: unknown, signature: string): Promise<unknown>; }
type Dependencies = {
  env?: Record<string, string | undefined>;
  getService?: () => Promise<Service> | Service;
};

export function createZaloWebhookHandler({ env = process.env, getService }: Dependencies = {}) {
  return async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const failure = (status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return failure(405, 'method_not_allowed', 'Webhook chỉ nhận yêu cầu POST.');
    }
    if (env.DKAN_ZALO_ENABLED !== 'true' || !env.ZALO_MINI_APP_API_KEY)
      return failure(503, 'not_configured', 'Webhook chưa được cấu hình.');
    const signature = req.headers['x-zevent-signature'];
    if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature))
      return failure(401, 'invalid_signature', 'Chữ ký webhook không hợp lệ.');
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType))
      return failure(415, 'invalid_request', 'Webhook yêu cầu dữ liệu JSON.');
    let body: unknown;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(body))) throw new Error();
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 8192)
        return failure(413, 'invalid_request', 'Yêu cầu quá lớn.');
    } catch { return failure(400, 'invalid_request', 'Thông tin webhook không hợp lệ.'); }
    try {
      const service = await (getService ? getService() : getLiveZaloWithdrawalService(env));
      return res.status(200).json(await service.handle(body, signature));
    } catch (error: unknown) {
      if (error instanceof ZaloWithdrawalError) return failure(error.status, error.code, error.message);
      return failure(503, 'service_unavailable', 'Chưa thể xử lý webhook. Zalo có thể thử lại.');
    }
  };
}

export default createZaloWebhookHandler();
