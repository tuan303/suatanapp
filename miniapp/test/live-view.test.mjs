// Render-only tests: no SDK imports, authentication or real HTTP requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
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
  assert.match(html, /Kết nối đúng tài khoản của bạn/); assert.match(html, /Liên kết bằng email nhà trường/);
  assert.doesNotMatch(html, /Nguyễn Minh Anh|Đã chấm 07:12|Đã chấm 12:08|Dữ liệu minh họa|Xác nhận đăng ký mẫu|Phở bò/);
  // Outside Zalo nothing signs in by itself, and the old check button is gone.
  assert.doesNotMatch(html, /Kiểm tra tài khoản Zalo|Đang đăng nhập bằng Zalo|Đăng nhập lại bằng Zalo|Microsoft của trường/);
});

test('inside Zalo the app opens on a quiet sign-in state instead of an account button', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'h5.zdn.vn', pathname: '/zapps/3378419117469948059/', search: '' } });
  try {
    // Static render: effects (and so the SDK import) never run here.
    const html = renderToStaticMarkup(createElement(app.default));
    assert.match(html, /<section class="ma-card ma-empty" role="status"><span class="ma-spinner"><\/span><h2>Đang đăng nhập bằng Zalo…<\/h2>/);
    assert.match(html, /ma-live-banner[^]*Đang đăng nhập bằng Zalo…/);
    assert.doesNotMatch(html, /Liên kết bằng email nhà trường|Kết nối đúng tài khoản|role="alert"/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous); else delete globalThis.location;
  }
});

test('a handoff prompts for an explicit Zalo action without rendering the code', () => {
  const handoffCode = 'SAMPLE_link_CODE_1234567';
  const html = renderToStaticMarkup(createElement(account.AccountLinkPanel, {
    apiOrigin: 'https://suatanapp.vercel.app', development: false, handoffCode,
  }));
  assert.match(html, /Yêu cầu liên kết từ website/);
  assert.match(html, /<button[^>]*>Tiếp tục liên kết<\/button>/);
  assert.ok(!html.includes(handoffCode));
  assert.doesNotMatch(html, /Mã liên kết trên website|Tài khoản đã xác minh|Gửi mã xác minh|Email nhà trường/);
});

const websiteSection = html => /<div id="ma-website-link" class="ma-link-website" hidden="">([^]*?)<form/.exec(html)?.[1] || '';

test('school verification shows a selectable browser fallback alongside the opening action', () => {
  const website = 'https://suatanapp.vercel.app/lien-ket-zalo';
  const html = renderToStaticMarkup(createElement(account.SchoolVerificationWebsite, {
    website, busy: null, openWebsite() {}, copyWebsite() {},
  }));
  // From LIVE-20261117.1 the opening link belongs to the website path, not a primary "Mở trang xác minh Microsoft".
  assert.match(html, /href="https:\/\/suatanapp\.vercel\.app\/lien-ket-zalo"[^>]*>Mở website liên kết<\/a>/);
  assert.match(html, /<code class="ma-link-address">https:\/\/suatanapp\.vercel\.app\/lien-ket-zalo<\/code>/);
  assert.match(html, /<button[^>]*>Sao chép địa chỉ<\/button>/);
  assert.match(html, /Chrome hoặc Safari/);
  // The panel shows the same action and fallback inside "Cách khác: liên kết qua website", before the manual code.
  const section = websiteSection(renderToStaticMarkup(createElement(account.AccountLinkPanel, { apiOrigin: 'https://suatanapp.vercel.app', development: false })));
  assert.match(section, /href="https:\/\/suatanapp\.vercel\.app\/lien-ket-zalo"[^>]*>Mở website liên kết<\/a>/);
  assert.match(section, /<code class="ma-link-address">https:\/\/suatanapp\.vercel\.app\/lien-ket-zalo<\/code>/);
  assert.match(section, /<button[^>]*>Sao chép địa chỉ<\/button>/);
  assert.match(section, /Chrome hoặc Safari/);
});

test('Zalo WebView keeps the browser fallback available while the SDK opens the page', () => {
  const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { hostname: 'h5.zdn.vn', pathname: '/zapps/example' } });
  try {
    const html = renderToStaticMarkup(createElement(account.SchoolVerificationWebsite, {
      website: 'https://suatanapp.vercel.app/lien-ket-zalo', busy: 'website', openWebsite() {}, copyWebsite() {},
    }));
    assert.match(html, /<button[^>]+disabled=""[^>]*>Đang mở website…<\/button>/);
    assert.match(html, /<button type="button" class="ma-link-secondary">Sao chép địa chỉ<\/button>/);
    assert.match(html, /Chrome hoặc Safari/);
    const section = websiteSection(renderToStaticMarkup(createElement(account.AccountLinkPanel, { apiOrigin: 'https://suatanapp.vercel.app', development: false })));
    assert.match(section, /<button type="button" class="ma-link-secondary">Mở website liên kết<\/button>/);
    assert.match(section, /<code class="ma-link-address">https:\/\/suatanapp\.vercel\.app\/lien-ket-zalo<\/code>/);
    assert.match(section, /<button type="button" class="ma-link-secondary">Sao chép địa chỉ<\/button>/);
    assert.match(section, /Chrome hoặc Safari/);
  } finally {
    if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
    else delete globalThis.location;
  }
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
  assert.match(html, /Gửi mã xác minh/);
});

const attributesOf = (html, id) => new RegExp(`<input id="${id}"[^>]*>`).exec(html)?.[0] || '';

test('the link dialog opens on the email step with the school domain fixed and the website path tucked away', () => {
  const html = renderToStaticMarkup(createElement(account.AccountLinkPanel, { apiOrigin: 'https://suatanapp.vercel.app', development: false }));
  assert.match(html, /<section class="ma-account-link" aria-busy="false">/);
  assert.match(html, /<label class="ma-field" for="ma-link-email">Email nhà trường<\/label>/);
  const input = attributesOf(html, 'ma-link-email');
  for (const attribute of ['inputmode="email"', 'autocomplete="email"', 'autocapitalize="none"', 'spellcheck="false"', 'maxlength="254"',
    'aria-describedby="ma-link-email-hint"', 'aria-invalid="false"']) assert.ok(input.toLowerCase().includes(attribute), attribute);
  assert.match(html, /<span class="ma-email-suffix" aria-hidden="true">@(<!-- -->)?hoangmaistarschool\.edu\.vn<\/span>/);
  assert.match(html, /<p id="ma-link-email-hint" class="ma-field-hint">Nhập phần trước @/);
  // Empty email: the send button waits for input.
  assert.match(html, /<button class="ma-primary" type="submit" disabled="">Gửi mã xác minh<\/button>/);
  // The website handoff and manual code stay available, hidden behind a secondary toggle.
  assert.match(html, /<button type="button" class="ma-link-alt" aria-expanded="false" aria-controls="ma-website-link">Cách khác: liên kết qua website<\/button>/);
  assert.match(html, /<div id="ma-website-link" class="ma-link-website" hidden="">[^]*Mã liên kết trên website/);
  assert.doesNotMatch(html, /Mở trang xác minh Microsoft|Nhập mã thủ công|Kiểm tra tài khoản Zalo|Đăng nhập lại bằng Zalo|role="alert"/);
  assert.ok(html.indexOf('Gửi mã xác minh') < html.indexOf('Cách khác: liên kết qua website'));
});

const otp = { state: 'sent', emailMasked: 't***m@hoangmaistarschool.edu.vn', expiresAt: Date.UTC(2026, 10, 17, 7, 32),
  resendAt: Date.UTC(2026, 10, 17, 7, 23), replacesExisting: false };
const step = props => renderToStaticMarkup(createElement(account.OtpCodeStep, { otp, code: '', busy: null, resendIn: 0,
  onCode() {}, onSubmit() {}, onResend() {}, onChangeEmail() {}, ...props })).replace(/<!-- -->/g, '');

test('the code step is a six-digit one-time-code field with a disabled resend countdown and an email change', () => {
  const html = step({ resendIn: 42, code: '12' });
  const input = attributesOf(html, 'ma-link-otp');
  for (const attribute of ['inputmode="numeric"', 'pattern="[0-9]*"', 'autocomplete="one-time-code"', 'value="12"',
    'aria-describedby="ma-link-otp-hint"']) assert.ok(input.toLowerCase().includes(attribute), attribute);
  // A maxlength would cut a paste such as "123 456" before codeDigits could clean it.
  assert.doesNotMatch(input, /readonly|disabled|maxlength/i);
  assert.match(html, /<label class="ma-field" for="ma-link-otp">Mã xác minh 6 số<\/label>/);
  // Deadline shown in Vietnam time whatever the phone's time zone.
  assert.match(html, /Mã có hiệu lực đến 14:32\. Đủ 6 số sẽ tự xác minh\./);
  assert.match(html, /<button class="ma-primary" type="submit" disabled="">Xác minh và liên kết<\/button>/);
  assert.match(html, /<button type="button" class="ma-link-secondary" disabled="">Gửi lại mã sau 42 giây<\/button>/);
  assert.match(html, /<button type="button" class="ma-link-secondary">Đổi email<\/button>/);
  assert.doesNotMatch(html, /Sẽ thay tài khoản Zalo/);
});

test('the code step enables resend after the countdown, warns before replacing another Zalo and keeps focus while checking', () => {
  const ready = step({ code: '123456', otp: { ...otp, replacesExisting: true } });
  assert.match(ready, /<button type="button" class="ma-link-secondary">Gửi lại mã<\/button>/);
  assert.match(ready, /<button class="ma-primary" type="submit">Xác minh và liên kết<\/button>/);
  assert.match(ready, /<div class="ma-link-warn"><strong>Sẽ thay tài khoản Zalo đang liên kết<\/strong>/);
  const checking = step({ code: '123456', busy: 'verify', invalid: true, describedBy: 'ma-link-otp-hint ma-link-error' });
  assert.match(checking, /Đang xác minh…/);
  const input = attributesOf(checking, 'ma-link-otp');
  assert.match(input, /readonly=""/i); assert.doesNotMatch(input, /disabled/);
  assert.match(input, /aria-invalid="true"/); assert.match(input, /aria-describedby="ma-link-otp-hint ma-link-error"/); assert.match(input, /ma-field-invalid/);
  assert.match(checking, /<button type="button" class="ma-link-secondary" disabled="">Đổi email<\/button>/);
});

test('pasted codes keep six ASCII digits and the resend wait counts on the phone clock alone', () => {
  for (const [input, expected] of [['123456', '123456'], [' 12 34 56 ', '123456'], ['123-456', '123456'],
    [String.fromCharCode(0xff11, 0xff12, 0xff13, 0xff14, 0xff15, 0xff16), '123456'], ['Mã: 654321.', '654321'],
    ['Mã xác minh liên kết Zalo: 123456', '123456'], ['1234567890', '123456'], ['abc', ''], ['', '']]) {
    assert.equal(account.codeDigits(input), expected, input);
  }
  // The server's resendAt is on another clock and is not an input: a phone that
  // runs fast or slow still waits the full cooldown from when the reply arrived.
  const at = 1_800_000_000_000;
  assert.equal(account.resendDeadline.length, 1);
  assert.equal(account.resendDeadline(at), at + 60_000);
});

// The step components use no hooks, so calling them returns their element tree.
const findElement = (node, matches) => {
  if (Array.isArray(node)) { for (const child of node) { const found = findElement(child, matches); if (found) return found; } return null; }
  if (!node || typeof node !== 'object') return null;
  return matches(node) ? node : findElement(node.props?.children, matches);
};
const otpInput = props => findElement(account.OtpCodeStep({ otp, code: '', busy: null, resendIn: 0,
  onCode() {}, onSubmit() {}, onResend() {}, onChangeEmail() {}, ...props }), node => node.props?.id === 'ma-link-otp');
const paste = (input, text) => {
  let prevented = false;
  input.props.onPaste({ clipboardData: { getData: type => type === 'text' ? text : '' }, preventDefault() { prevented = true; } });
  return prevented;
};

test('pasting a whole code replaces the typed digits instead of joining them, and nothing cuts the paste short', () => {
  const codes = [], input = otpInput({ code: '12', onCode: value => codes.push(value) });
  assert.equal(input.props.maxLength, undefined);
  assert.equal(paste(input, '654321'), true);
  assert.equal(paste(input, 'Mã xác minh liên kết Zalo: 123 456'), true);
  // A partial paste goes through onChange like typing; codeDigits cleans it in the panel.
  assert.equal(paste(input, '34'), false);
  input.props.onChange({ target: { value: ' 12 34 56 ' } });
  assert.deepEqual(codes, ['654321', '123456', ' 12 34 56 ']);
  // While a code is being checked a paste changes nothing.
  const checking = [], busy = otpInput({ code: '123456', busy: 'verify', onCode: value => checking.push(value) });
  assert.equal(paste(busy, '654321'), false);
  assert.deepEqual(checking, []);
});

const emailStep = props => renderToStaticMarkup(createElement(account.OtpEmailStep, { email: '', busy: null, sendIn: 0, configured: true,
  onEmail() {}, onSubmit() {}, ...props })).replace(/<!-- -->/g, '');

test('after Đổi email the send button counts down the cooldown the server keeps per Zalo user', async () => {
  const waiting = emailStep({ email: 'hoa.nt', sendIn: 42 });
  assert.match(waiting, /<button class="ma-primary" type="submit" disabled="">Gửi mã sau 42 giây<\/button>/);
  assert.match(waiting, /<p id="ma-link-email-hint" class="ma-field-hint">[^<]*Mỗi lần gửi mã cách nhau 1 phút\.<\/p>/);
  const ready = emailStep({ email: 'hoa.nt' });
  assert.match(ready, /<button class="ma-primary" type="submit">Gửi mã xác minh<\/button>/);
  assert.doesNotMatch(ready, /Mỗi lần gửi mã/);
  assert.match(emailStep({ email: 'hoa.nt', busy: 'send', sendIn: 42 }), /disabled="">Đang gửi mã…<\/button>/);
  assert.match(emailStep({ email: 'hoa.nt', configured: false }), /disabled="">Gửi mã xác minh<\/button>/);
  // The deadline lives outside the dropped code: "Đổi email" must not reset it.
  const source = await readFile(new URL('../src/components/AccountLinkPanel.tsx', import.meta.url), 'utf8');
  const changeEmail = /\n  function changeEmail\(\) \{\r?\n([^]*?)\r?\n  \}\r?\n/.exec(source)?.[1];
  assert.ok(changeEmail, 'changeEmail found');
  assert.match(changeEmail, /pendingOtp = null/);
  assert.doesNotMatch(changeEmail, /sendCooldownUntil\s*=|setSendAfter/);
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

test('exempt and unknown meal states render the web wording and a neutral label, never a missed-meal warning', () => {
  const day = { date: '2026-11-03', hold: null, result: { date: '2026-11-03', offDay: false,
    meals: { breakfast: { code: 'unknown', time: null }, lunch: { code: 'exempt', time: null } }, unrecognized: [] } };
  const html = renderToStaticMarkup(createElement(app.MealDayCard, { day }));
  assert.match(html, /Chưa xác định/); assert.match(html, /Miễn chấm ăn/);
  assert.doesNotMatch(html, /ma-text-warn|Chưa có lượt chấm|Chưa thể kết luận/);
  const held = renderToStaticMarkup(createElement(app.MealDayCard, { day: { ...day, hold: 'guarded' } }));
  assert.match(held, /Miễn chấm ăn/); assert.match(held, /Chưa thể kết luận đối soát/);
});

// React separates adjacent text nodes with comments in static markup.
const visibleText = html => html.replace(/<!-- -->/g, '');
const occurrences = (html, phrase) => html.split(phrase).length - 1;

test('a day held by the exemption check says why and keeps concluded meals readable', () => {
  const day = { date: '2026-11-03', hold: 'Thông tin miễn chấm đang được kiểm tra', result: { date: '2026-11-03', offDay: false,
    meals: { breakfast: { code: 'ok', time: '07:30' }, lunch: { code: 'pending', time: null } }, unrecognized: [] } };
  const html = visibleText(renderToStaticMarkup(createElement(app.MealDayCard, { day })));
  assert.match(html, /Cần đối chiếu dữ liệu/); assert.match(html, /<p class="ma-history-note">Thông tin miễn chấm đang được kiểm tra\.<\/p>/);
  assert.match(html, /07:30<\/strong><small class="">Đã chấm ăn<\/small>/);
  assert.equal(occurrences(html, 'Chưa thể kết luận đối soát'), 1);
  assert.doesNotMatch(html, /Chưa chốt dữ liệu|ma-text-warn/);
  // Hold codes keep holding every meal of the day and add no note.
  const conflict = visibleText(renderToStaticMarkup(createElement(app.MealDayCard, { day: { ...day, hold: 'conflict' } })));
  assert.equal(occurrences(conflict, 'Chưa thể kết luận đối soát'), 2); assert.doesNotMatch(conflict, /conflict|Thông tin miễn chấm/);
});

test('a month without registration explains why no tap is listed and whom to contact', () => {
  const unregisteredDay = date => ({ date, hold: null, result: { date, offDay: false, unrecognized: [], meals: {
    breakfast: { code: 'not_registered', time: null, reason: 'no_registration' }, lunch: { code: 'not_registered', time: null, reason: 'no_registration' } } } });
  const view = (month, record, days) => visibleText(renderToStaticMarkup(createElement(app.MealHistory, { data: { month, today: '2026-11-03',
    registration: { record }, history: { month, days, conflict: false, updatedAt: null, closedFrom: null } } })));
  const html = view('2026-11', null, [unregisteredDay('2026-11-03'), unregisteredDay('2026-11-02')]);
  assert.match(html, /Thầy\/Cô không đăng ký suất ăn tháng 11\/2026 nên Mini App không hiển thị lượt chấm của tháng này \(nếu có\)\./);
  assert.match(html, /Nếu nhận được email cảnh báo chấm ăn khi chưa đăng ký, Thầy\/Cô vui lòng liên hệ Bộ phận Dinh dưỡng để được đối chiếu\./);
  assert.equal(occurrences(html, 'Không đăng ký'), 4); assert.match(html, /2 ngày/);
  const record = { month: '2026-10', breakfastCount: 22, lunchCount: 22, firstMealDate: '2026-10-01', timestamp: null };
  assert.doesNotMatch(view('2026-10', record, [unregisteredDay('2026-10-30')]), /Bộ phận Dinh dưỡng/);
  // A month that has not started can still be registered: only the usual empty state.
  const future = view('2026-12', null, []);
  assert.doesNotMatch(future, /Bộ phận Dinh dưỡng/); assert.match(future, /Chưa có lượt chấm trong tháng/);
});

test('a month without registration that still lists synced tap times does not claim taps are hidden', () => {
  const day = (date, breakfast, lunch, unrecognized = []) => ({ date, hold: null, result: { date, offDay: false, unrecognized, meals: {
    breakfast: breakfast ? { code: 'extra', time: breakfast } : { code: 'not_registered', time: null, reason: 'no_registration' },
    lunch: lunch ? { code: 'extra', time: lunch } : { code: 'not_registered', time: null, reason: 'no_registration' } } } });
  const view = days => visibleText(renderToStaticMarkup(createElement(app.MealHistory, { data: { month: '2026-11', today: '2026-11-03',
    registration: { record: null }, history: { month: '2026-11', days, conflict: false, updatedAt: null, closedFrom: null } } })));
  // Taps synced before the registration was deleted are still shown with their times.
  for (const days of [[day('2026-11-03', null, '12:10'), day('2026-11-02')], [day('2026-11-03', '07:05', null)],
    [day('2026-11-03', null, null, ['15:40'])]]) {
    const html = view(days);
    assert.doesNotMatch(html, /không hiển thị lượt chấm|Bộ phận Dinh dưỡng/);
    assert.match(html, /12:10|07:05|15:40/);
  }
  assert.match(view([day('2026-11-03', null, '12:10')]), /12:10<\/strong><small class="">Có chấm, chưa đăng ký<\/small>/);
  // Without any shown time the explanation stays.
  assert.match(view([day('2026-11-03'), day('2026-11-02')]), /không hiển thị lượt chấm của tháng này \(nếu có\)/);
});

test('the build label shown in the app is the one the deployment guide and README tell staff to check', async () => {
  const source = await readFile(new URL('../src/lib/appVersion.ts', import.meta.url), 'utf8');
  const label = /ACCOUNT_LINK_BUILD = '(LIVE-\d{8}\.\d+)'/.exec(source)?.[1];
  assert.ok(label, 'appVersion.ts must export a LIVE-YYYYMMDD.N label');
  assert.ok(renderToStaticMarkup(createElement(app.default)).includes(label));
  for (const doc of ['../../docs/ZALO_LIVE_DATA.md', '../README.md', '../../README.md', '../../docs/ZALO_VIETNAM_API.md', '../../docs/ZALO_DEVICE_TEST.md'])
    assert.ok((await readFile(new URL(doc, import.meta.url), 'utf8')).includes(label), `${doc} must cite ${label}`);
});
