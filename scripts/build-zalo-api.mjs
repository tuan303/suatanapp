// Build an API-only runtime package. Copy only reviewed, non-secret assets.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist-zalo-api');
await mkdir(output, { recursive: true });
await build({ entryPoints: [path.join(root, 'deploy/zalo-api/start.ts')],
  outfile: path.join(output, 'server.cjs'), bundle: true, platform: 'node', format: 'cjs',
  packages: 'external', target: 'node22', sourcemap: false, logLevel: 'warning' });
const assets = ['package.json', 'package-lock.json', '.env.example', 'Start-Api.ps1', 'Caddyfile'];
for (const asset of assets) await copyFile(path.join(root, 'deploy/zalo-api', asset), path.join(output, asset));
await copyFile(path.join(root, 'docs/ZALO_VIETNAM_API.md'), path.join(output, 'README.md'));
const files = ['server.cjs', ...assets, 'README.md'];
const sums = await Promise.all(files.map(async name => {
  const bytes = await readFile(path.join(output, name));
  return `${createHash('sha256').update(bytes).digest('hex')}  ${name}`;
}));
await writeFile(path.join(output, 'SHA256SUMS.txt'), `${sums.join('\n')}\n`);
console.log(`Built API-only package: ${files.length + 1} reviewed files in dist-zalo-api`);
