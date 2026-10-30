import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

const require = createRequire(import.meta.url);
let component;
test.before(async () => {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../src/pages/ZaloAccountLink.tsx', import.meta.url))],
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic', logLevel: 'silent',
    plugins: [{ name: 'no-live-services', setup(builder) {
      builder.onResolve({ filter: /^\.\.\/(lib\/firebase|components\/)/ }, args => ({ path: args.path, namespace: 'test-stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'test-stub' }, () => ({ contents: `export const auth = {}, microsoftProvider = {}; export const Header = () => null, Navigation = () => null, Footer = () => null;` }));
    } }],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
  component = module.exports;
});

const user = { email: 'demo@hoangmaistarschool.edu.vn', displayName: 'Tài khoản mẫu', providerData: [{ providerId: 'microsoft.com' }] };
const challengeId = 'a'.repeat(64), now = Date.parse('2026-10-30T02:00:00Z');
const challenge = { challengeId, code: 'SAMPLE_link_CODE_12345678', expiresAt: now + 300000, state: 'waiting' };
const defaults = () => ({ authLoading: false, user, link: { linked: false }, challenge: null, now, busy: null, error: null, notice: null, revokeConfirm: false,
  onReload() {}, onCreate() {}, onConfirm() {}, onCopy() {}, onRevokeRequest() {}, onRevokeCancel() {}, onRevoke() {} });
const render = overrides => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(component.ZaloAccountLinkView, { ...defaults(), ...overrides })));

test('chưa đăng nhập dẫn về Microsoft và giữ đúng trang cần quay lại', () => {
  const html = render({ user: null, link: null });
  assert.match(html, /href="\/login\?next=%2Flien-ket-zalo"/);
  assert.match(html, /Đăng nhập Microsoft/);
  assert.doesNotMatch(html, /Xác minh Microsoft và tạo mã|Mã liên kết Zalo/);
});

test('chỉ cho tài khoản Microsoft nhà trường mở thao tác tạo mã', () => {
  assert.equal(component.isSchoolMicrosoftUser(user), true);
  assert.equal(component.isSchoolMicrosoftUser({ ...user, email: 'demo@outside.example' }), false);
  assert.equal(component.isSchoolMicrosoftUser({ ...user, providerData: [{ providerId: 'google.com' }] }), false);
  const html = render({ user: { ...user, providerData: [] } });
  assert.match(html, /chưa xác thực qua Microsoft/);
  assert.doesNotMatch(html, /Xác minh Microsoft và tạo mã/);
});

test('trạng thái chưa bật API thể hiện rõ, không hiển thị tạo mã hoặc thành công giả', () => {
  const message = component.zaloLinkErrorMessage('not_configured', 503);
  assert.equal(message, 'Chức năng liên kết chưa được bật trên máy chủ.');
  const html = render({ link: null, error: message });
  assert.match(html, /Chức năng liên kết chưa được bật trên máy chủ/);
  assert.match(html, /Tải lại trạng thái/);
  assert.doesNotMatch(html, /Xác minh Microsoft và tạo mã|Đã liên kết Zalo/);
});

test('chỉ hiển thị mã trong nội dung và sao chép, không đưa mã hoặc challenge vào URL', () => {
  const html = render({ challenge });
  assert.match(html, /SAMPLE_link_CODE_12345678/);
  assert.match(html, /Còn 5 phút 00 giây/);
  assert.match(html, /Đang chờ yêu cầu từ Zalo Mini App/);
  assert.doesNotMatch(html, /Xác nhận liên kết tài khoản Zalo này/);
  for (const link of html.matchAll(/href="([^"]+)"/g)) {
    assert.ok(!link[1].includes(challenge.code));
    assert.ok(!link[1].includes(challengeId));
  }
});

test('Zalo đã nhận mã vẫn cần xác nhận rõ ràng trên web và chỉ hiển thị đuôi định danh', () => {
  const html = render({ challenge: { ...challenge, state: 'pending', zaloUserIdSuffix: '1234' } });
  assert.match(html, /••••1234/);
  assert.match(html, /Chỉ xác nhận khi Thầy\/Cô vừa nhập mã trên điện thoại/);
  assert.match(html, /<button[^>]+>Xác nhận liên kết tài khoản Zalo này<\/button>/);
  assert.doesNotMatch(html, /Đã liên kết Zalo/);
});

test('mã hết hạn không còn sao chép/xác nhận và yêu cầu xác minh Microsoft để tạo lại', () => {
  const html = render({ challenge: { ...challenge, state: 'pending', expiresAt: now - 1, zaloUserIdSuffix: '1234' } });
  assert.match(html, /Mã liên kết đã hết hạn/);
  assert.match(html, /Xác minh Microsoft và tạo mã mới/);
  assert.doesNotMatch(html, /Sao chép mã|Xác nhận liên kết tài khoản Zalo này|SAMPLE_link_CODE_12345678/);
});

test('hủy liên kết có bước xác nhận riêng và trạng thái bận khóa thao tác', () => {
  const html = render({ link: { linked: true, zaloUserIdSuffix: '1234', linkedAt: now }, revokeConfirm: true, busy: 'revoking' });
  assert.match(html, /Đã liên kết Zalo/);
  assert.match(html, /Đang xác minh và hủy/);
  assert.match(html, /Giữ liên kết/);
  assert.match(html, /disabled=""/);
  assert.doesNotMatch(html, /Xác minh Microsoft và tạo mã/);
});

test('API chỉ nhận action/challengeId và token qua header; không đưa UID/email vào body hay URL', async () => {
  const controller = new AbortController();
  let seen;
  const result = await component.requestZaloLinkAction('web.challengeStatus', challengeId, {
    signal: controller.signal, stillCurrent: () => true, getToken: async () => 'TEST_TOKEN_ONLY',
    fetcher: async (url, request) => { seen = { url, request }; return { ok: true, status: 200, json: async () => ({ state: 'waiting', expiresAt: now + 300000 }) }; },
  });
  assert.equal(seen.url, '/api/zalo');
  assert.equal(seen.request.method, 'POST');
  assert.equal(seen.request.credentials, 'omit');
  assert.equal(seen.request.cache, 'no-store');
  assert.equal(seen.request.headers.Authorization, 'Bearer TEST_TOKEN_ONLY');
  assert.deepEqual(JSON.parse(seen.request.body), { action: 'web.challengeStatus', challengeId });
  assert.equal(result.state, 'waiting');
});

test('getLink/create/revoke không chuyển challengeId thừa tới API', async () => {
  for (const action of ['web.getLink', 'web.createChallenge', 'web.revokeLink']) {
    let sent;
    await component.requestZaloLinkAction(action, challengeId, {
      signal: new AbortController().signal, stillCurrent: () => true, getToken: async () => 'TEST_TOKEN_ONLY',
      fetcher: async (_url, request) => { sent = JSON.parse(request.body); return { ok: true, status: 200, json: async () => ({ linked: false }) }; },
    });
    assert.deepEqual(sent, { action });
  }
});

test('đổi tài khoản/hủy yêu cầu trong lúc lấy token không gọi API bằng phiên cũ', async () => {
  let current = true, called = 0;
  await assert.rejects(component.requestZaloLinkAction('web.getLink', undefined, {
    signal: new AbortController().signal, stillCurrent: () => current,
    getToken: async () => { current = false; return 'OLD_TOKEN_ONLY'; },
    fetcher: async () => { called++; throw new Error('must not fetch'); },
  }), failure => failure.name === 'AbortError');
  assert.equal(called, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(component.requestZaloLinkAction('web.getLink', undefined, {
    signal: controller.signal, stillCurrent: () => true,
    getToken: async () => { throw new Error('must not read token'); },
  }), failure => failure.name === 'AbortError');
});

test('kết quả API về sau khi đổi phiên không được trả ra cho giao diện', async () => {
  let current = true;
  await assert.rejects(component.requestZaloLinkAction('web.getLink', undefined, {
    signal: new AbortController().signal, stillCurrent: () => current, getToken: async () => 'TEST_TOKEN_ONLY',
    fetcher: async () => ({ ok: true, status: 200, json: async () => { current = false; return { linked: true }; } }),
  }), failure => failure.name === 'AbortError');
});

test('thông báo API/provider dùng bản dịch cố định, không đưa lỗi/tokens máy chủ ra UI', async () => {
  await assert.rejects(component.requestZaloLinkAction('web.getLink', undefined, {
    signal: new AbortController().signal, stillCurrent: () => true, getToken: async () => 'TEST_TOKEN_ONLY',
    fetcher: async () => ({ ok: false, status: 503, json: async () => ({ error: { code: 'not_configured', message: 'PRIVATE_KEY_TEST_SHOULD_NOT_APPEAR' } }) }),
  }), failure => failure.message === 'Chức năng liên kết chưa được bật trên máy chủ.' && !failure.message.includes('PRIVATE_KEY'));
  assert.doesNotMatch(component.zaloLinkErrorMessage('UNKNOWN_PRIVATE_PROVIDER_TEXT', 500), /UNKNOWN_PRIVATE/);
  assert.match(component.zaloLinkErrorMessage('auth/popup-closed-by-user'), /Chưa hoàn tất xác minh Microsoft/);
  assert.match(component.zaloLinkErrorMessage('recent_login_required', 401), /xác minh lại tài khoản Microsoft/);
});
