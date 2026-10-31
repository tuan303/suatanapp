// Entry point only. Import server.ts in tests; importing it never starts a listener.
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import { createZaloApiApp, readZaloApiListenConfig } from './server';

dotenv.config({ quiet: true });
try {
  const { host, port } = readZaloApiListenConfig();
  const server = createServer({
    requestTimeout: 15_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 5_000,
    maxHeaderSize: 20 * 1024,
  }, createZaloApiApp());
  server.maxHeadersCount = 32;
  server.on('error', () => {
    console.error('DKAN_ZALO_API_START_FAILED');
    process.exitCode = 1;
  });
  server.listen(port, host, () => console.log('DKAN_ZALO_API_READY'));
} catch {
  console.error('DKAN_ZALO_API_START_FAILED');
  process.exitCode = 1;
}
