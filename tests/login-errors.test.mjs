import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

let message;
test.before(async () => {
  const result = await build({ entryPoints: [fileURLToPath(new URL('../src/lib/loginErrors.ts', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  message = module.exports.microsoftLoginErrorMessage;
});

test('blocked Microsoft popup gives site-specific recovery without misreporting a domain error', () => {
  const text = message({ code: 'auth/popup-blocked' });
  assert.match(text, /cho phép cửa sổ bật lên cho trang này/);
  assert.match(text, /đăng nhập lại/);
  assert.doesNotMatch(text, /Firebase|Azure|mật khẩu/);
  assert.notEqual(text, message({ code: 'auth/unauthorized-domain' }));
});

test('user cancellation remains retryable and distinct from a blocked popup', () => {
  const closed = message({ code: 'auth/popup-closed-by-user' });
  assert.match(closed, /Chưa hoàn tất/);
  assert.equal(closed, message({ code: 'auth/cancelled-popup-request' }));
  assert.notEqual(closed, message({ code: 'auth/popup-blocked' }));
});

test('OAuth diagnostics never echo unknown messages, tokens or provider detail', () => {
  for (const error of [null, undefined, 'TEST_ONLY_TOKEN', { message: 'TEST_ONLY_TOKEN' },
    { code: 'auth/unknown', message: 'TEST_ONLY_TOKEN user@example.test' },
    { message: 'AADSTS7000215 TEST_ONLY_TOKEN' },
    { code: 'auth/popup-blocked', message: 'TEST_ONLY_TOKEN' }]) {
    assert.equal(typeof message(error), 'string');
    assert.doesNotMatch(message(error), /TEST_ONLY_TOKEN|user@example\.test|AADSTS7000215/);
  }
});

test('network failure, provider configuration and throttling stay distinguishable', () => {
  const results = ['auth/network-request-failed', 'auth/configuration-not-found', 'auth/too-many-requests']
    .map(code => message({ code }));
  assert.equal(new Set(results).size, 3);
  assert.equal(message({ code: 'auth/configuration-not-found' }), message({ code: 'auth/operation-not-allowed' }));
});
