// API-only process for a trusted server with a Vietnam egress IP.
// Keep this separate from server.ts: no mail, GAS, static files or Vite routes.
import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { createZaloHandler } from '../../api/zalo';

export function readZaloApiListenConfig(env: Record<string, string | undefined> = process.env) {
  const host = env.HOST ?? '127.0.0.1';
  const port = env.PORT ?? '3031';
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)
    || !/^[1-9][0-9]{0,4}$/.test(port) || Number(port) > 65535) {
    throw new Error('Invalid API listen configuration.');
  }
  return { host, port: Number(port) };
}

export function createZaloApiApp({ handler }: { handler?: RequestHandler } = {}) {
  // This process performs verification locally. A Vercel forwarding variable
  // accidentally copied into its environment must never create a proxy loop.
  const localHandler = handler ?? createZaloHandler({
    env: { ...process.env, DKAN_ZALO_API_UPSTREAM_URL: '' },
  });
  const app = express();
  app.disable('x-powered-by');
  app.enable('strict routing');
  app.enable('case sensitive routing');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  // Liveness only. This does not prove Zalo connectivity or reveal configuration.
  app.get('/healthz', (_req, res) => { res.status(200).json({ status: 'ok' }); });
  app.all('/api/zalo', express.json({ limit: 8192, strict: true, inflate: false }), localHandler);
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'Không tìm thấy địa chỉ API.' } });
  });
  const failure: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) { res.end(); return; }
    // Do not return/log error.message, stack, body, headers or input values.
    const type = error && typeof error === 'object' ? error.type : undefined;
    if (type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'invalid_request', message: 'Yêu cầu quá lớn.' } });
    } else if (type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_request', message: 'Thông tin yêu cầu không hợp lệ.' } });
    } else if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
      res.status(415).json({ error: { code: 'invalid_request', message: 'Định dạng yêu cầu không được hỗ trợ.' } });
    } else {
      res.status(503).json({ error: { code: 'service_unavailable', message: 'Chưa thể xử lý liên kết tài khoản. Vui lòng thử lại sau.' } });
    }
  };
  app.use(failure);
  return app;
}
