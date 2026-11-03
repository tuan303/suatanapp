// Render-only tests: no SDK imports, authentication or real HTTP requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
async function compile(file) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(file, import.meta.url))], bundle: true, write: false, platform: 'node', format: 'cjs',
    packages: 'external', jsx: 'automatic', loader: { '.png': 'dataurl' }, logLevel: 'silent',
    define: { 'import.meta.env': JSON.stringify({ VITE_DKAN_API_ORIGIN: 'https://suatanapp.vercel.app', DEV: false }) } });
  const module = { exports: {} }; new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports); return module.exports;
}
const app = await compile('../src/App.tsx'), account = await compile('../src/components/AccountLinkPanel.tsx');
const profile = { fullName: 'Người dùng thử nghiệm', employeeId: '100001', department: 'Bộ phận mẫu', email: 'demo@hoangmaistarschool.edu.vn' };
const token = 'TEST_ONLY_MUST_NOT_RENDER_SESSION';

test('unverified app shows account gate and never renders fake meals, demo profile or local save receipts', () => {
  const html = renderToStaticMarkup(createElement(app.default));
  assert.match(html, /Kết nối đúng tài khoản của bạn/); assert.match(html, /Kiểm tra tài khoản Zalo/);
  assert.doesNotMatch(html, /Nguyễn Minh Anh|Đã chấm 07:12|Đã chấm 12:08|Dữ liệu minh họa|Xác nhận đăng ký mẫu|Phở bò/);
});

test('opening account panel with a lifted valid session renders linked profile without rechecking SDK', () => {
  let changes = 0;
  const html = renderToStaticMarkup(createElement(account.AccountLinkPanel, { apiOrigin: 'https://suatanapp.vercel.app', development: false,
    initialSession: { sessionToken: token, expiresAt: Date.now() + 300000, profile }, onSessionChange: () => changes++ }));
  assert.match(html, /Tài khoản đã xác minh/); assert.match(html, /Người dùng thử nghiệm/); assert.match(html, /Đăng xuất phiên Mini App/);
  assert.doesNotMatch(html, /Khung này chỉ xác minh liên kết|dữ liệu minh họa/); assert.ok(!html.includes(token)); assert.equal(changes, 0);
});

test('expired lifted session cannot render personal profile', () => {
  const html = renderToStaticMarkup(createElement(account.AccountLinkPanel, { apiOrigin: 'https://suatanapp.vercel.app',
    initialSession: { sessionToken: token, expiresAt: Date.now() - 1, profile } }));
  assert.match(html, /Kết nối đúng tài khoản/); assert.doesNotMatch(html, /Người dùng thử nghiệm/); assert.ok(!html.includes(token));
});

test('held or off-day history displays actual taps without claiming a missing meal violation', () => {
  const day = { date: '2026-11-02', hold: 'conflict', result: { date: '2026-11-02', offDay: false,
    meals: { breakfast: { code: 'missing', time: null }, lunch: { code: 'ok', time: '12:05' } }, unrecognized: ['08:05'], unrecognizedCount: 25 } };
  const held = renderToStaticMarkup(createElement(app.MealDayCard, { day }));
  assert.match(held, /Cần đối chiếu dữ liệu/); assert.match(held, /Chưa thể kết luận đối soát/); assert.match(held, /12:05/);
  assert.doesNotMatch(held, /Chưa có lượt chấm/); assert.match(held, /24 lượt khác/);
  const off = renderToStaticMarkup(createElement(app.MealDayCard, { day: { ...day, hold: null, result: { ...day.result, offDay: true,
    meals: { breakfast: { code: 'off_day', time: '07:10' }, lunch: { code: 'off_day', time: '12:05' } } } } }));
  assert.match(off, /Lượt chấm tham khảo/); assert.match(off, /không tính vào suất tháng hoặc vi phạm/); assert.match(off, /07:10/);
});
