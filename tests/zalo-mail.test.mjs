// Offline only: fake fetch; no Microsoft Graph, Entra ID, credentials or mail.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readZaloMailConfig, inspectZaloMailEnv, createZaloMailer, reportZaloMailFailure, ZaloMailError,
  ZALO_MAIL_TIMEOUT_MS } from '../api/_lib/zalo-mail.mjs';

const PRIVATE = 'TEST_ONLY_PRIVATE_PROVIDER_TEXT';
const TENANT = '00000000-0000-4000-8000-000000000001';
const CLIENT = '00000000-0000-4000-8000-000000000002';
const SECRET = 'TEST_ONLY_CLIENT_SECRET_VALUE';
const SENDER = 'dinhduong@hoangmaistarschool.edu.vn';
const TO = 'teacher@hoangmaistarschool.edu.vn';
const CODE = '012345';
const NOW = Date.UTC(2026, 10, 17, 10, 0, 0); // 17:00 ngày 17/11 giờ Việt Nam
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
const SEND_URL = `https://graph.microsoft.com/v1.0/users/${SENDER}/sendMail`;
const env = () => ({ MS_GRAPH_TENANT_ID: TENANT, MS_GRAPH_CLIENT_ID: CLIENT,
  MS_GRAPH_CLIENT_SECRET: SECRET, MS_GRAPH_SENDER: 'Dinhduong@HoangMaiStarSchool.edu.vn' });
const otp = (extra = {}) => ({ kind: 'otp', to: TO, code: CODE, expiresAt: NOW + 10 * 60_000, name: 'Nguyễn Văn A', ...extra });
const linked = (extra = {}) => ({ kind: 'linked', to: TO, linkedAt: NOW, name: 'Nguyễn Văn A', ...extra });

/** Fake Entra + Graph. Token N is "TEST_ONLY_ACCESS_TOKEN_N". */
function graph({ token, send, expiresIn = 3599 } = {}) {
  const calls = [];
  let tokens = 0;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === TOKEN_URL) {
      tokens++;
      return token ? token(tokens, options) : Response.json({ token_type: 'Bearer', expires_in: expiresIn,
        access_token: `TEST_ONLY_ACCESS_TOKEN_${tokens}` });
    }
    return send ? send(options) : new Response(null, { status: 202 });
  };
  return { calls, fetchImpl, tokenCalls: () => calls.filter(call => call.url === TOKEN_URL),
    sendCalls: () => calls.filter(call => call.url !== TOKEN_URL) };
}
const mailer = (fake, options = {}) => createZaloMailer(readZaloMailConfig(env()), { fetchImpl: fake.fetchImpl, now: () => NOW, ...options });
const sentMail = call => JSON.parse(call.options.body);
const fixedError = (code, httpStatus) => error => {
  assert.ok(error instanceof ZaloMailError);
  assert.equal(error.code, code);
  assert.equal(error.httpStatus, httpStatus);
  const exposed = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
  for (const value of [PRIVATE, SECRET, CODE, TO, 'TEST_ONLY_ACCESS_TOKEN']) assert.ok(!exposed.includes(value), value);
  assert.equal(error.cause, undefined);
  return true;
};

test('mail config needs all four Graph settings, a school sender and no .env.example placeholders', () => {
  const config = readZaloMailConfig(env());
  assert.deepEqual(config, { tenantId: TENANT, clientId: CLIENT, clientSecret: SECRET, sender: SENDER });
  assert.ok(Object.isFrozen(config));
  assert.deepEqual(readZaloMailConfig({ ...env(), MS_GRAPH_TENANT_ID: ` hoangmaistarschool.edu.vn\n` }).tenantId, 'hoangmaistarschool.edu.vn');
  assert.deepEqual(inspectZaloMailEnv(env()), { missing: [], invalid: [] });
  for (const name of Object.keys(env())) {
    for (const value of [undefined, '', '   ']) {
      assert.equal(readZaloMailConfig({ ...env(), [name]: value }), null);
      assert.deepEqual(inspectZaloMailEnv({ ...env(), [name]: value }), { missing: [name], invalid: [] });
    }
  }
  const invalid = [
    ['MS_GRAPH_SENDER', 'dinhduong@gmail.com'], ['MS_GRAPH_SENDER', 'dinhduong@hoangmaistarschool.edu.vn.evil.example'],
    ['MS_GRAPH_SENDER', 'a@b@hoangmaistarschool.edu.vn'], ['MS_GRAPH_SENDER', 'dinhduong@hoangmaistarschool.edu.vn\r\nBcc: x@example.com'],
    ['MS_GRAPH_SENDER', 'dinh duong@hoangmaistarschool.edu.vn'], ['MS_GRAPH_SENDER', 'evil@sub.hoangmaistarschool.edu.vn'],
    ['MS_GRAPH_TENANT_ID', 'your_tenant_id_here'], ['MS_GRAPH_TENANT_ID', '../common'], ['MS_GRAPH_TENANT_ID', 'evil.example/x'],
    ['MS_GRAPH_CLIENT_ID', 'your_client_id_here'], ['MS_GRAPH_CLIENT_ID', 123],
    ['MS_GRAPH_CLIENT_SECRET', 'your_client_secret_here'], ['MS_GRAPH_CLIENT_SECRET', 'short'],
    ['MS_GRAPH_CLIENT_SECRET', 'TEST ONLY SECRET'], ['MS_GRAPH_CLIENT_SECRET', '${MS_GRAPH_CLIENT_SECRET}'],
    ['MS_GRAPH_CLIENT_SECRET', 'Bí_mật_không_ASCII_123'],
  ];
  for (const [name, value] of invalid) {
    assert.equal(readZaloMailConfig({ ...env(), [name]: value }), null, `${name}=${value}`);
    const problems = inspectZaloMailEnv({ ...env(), [name]: value });
    assert.deepEqual(problems, { missing: [], invalid: [name] });
    // Names only: an operator log line can never contain a value.
    assert.ok(!JSON.stringify(problems).includes(String(value)));
  }
  const throwing = { get MS_GRAPH_TENANT_ID() { throw new Error(PRIVATE); } };
  for (const value of [undefined, null, 1, 'text', throwing]) {
    assert.equal(readZaloMailConfig(value), null);
    assert.doesNotThrow(() => inspectZaloMailEnv(value));
  }
});

test('mailer rejects invalid config or options before any request and never echoes the secret', () => {
  const fake = graph(), config = readZaloMailConfig(env());
  for (const [value, options] of [[null, {}], [{}, {}], [{ ...config, sender: 'dinhduong@gmail.com' }, {}],
    [{ ...config, clientSecret: 'your_client_secret_here' }, {}], [{ ...config, tenantId: `${TENANT}/x` }, {}],
    [config, { fetchImpl: null }], [config, { now: 1 }], [config, { timeoutMs: 0 }],
    [config, { timeoutMs: ZALO_MAIL_TIMEOUT_MS + 1 }], [config, { timeoutMs: '5' }], [config, { timeoutMs: NaN }]]) {
    assert.throws(() => createZaloMailer(value, { fetchImpl: fake.fetchImpl, ...options }), error =>
      error instanceof ZaloMailError && error.code === 'invalid_config' && !`${error.message}${error.stack}`.includes(SECRET));
  }
  assert.equal(ZALO_MAIL_TIMEOUT_MS, 10_000);
  assert.equal(fake.calls.length, 0);
});

test('OTP mail uses app-only Graph sendMail with a Vietnamese subject, escaped values and Viet Nam time', async () => {
  const fake = graph();
  await mailer(fake).send(otp({ to: 'Teacher@HoangMaiStarSchool.edu.vn', name: `<b>Cô "A" & 'B'</b>` }));
  const [tokenCall] = fake.tokenCalls(), [sendCall] = fake.sendCalls();
  assert.equal(fake.calls.length, 2);
  assert.equal(tokenCall.options.method, 'POST');
  assert.equal(tokenCall.options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tokenCall.options.body)), { client_id: CLIENT,
    scope: 'https://graph.microsoft.com/.default', client_secret: SECRET, grant_type: 'client_credentials' });
  for (const call of [tokenCall, sendCall]) {
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.cache, 'no-store');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.ok(!call.url.includes(SECRET) && !call.url.includes(CODE));
  }
  assert.equal(sendCall.url, SEND_URL);
  assert.equal(sendCall.options.method, 'POST');
  assert.deepEqual(sendCall.options.headers, { authorization: 'Bearer TEST_ONLY_ACCESS_TOKEN_1', 'content-type': 'application/json' });
  const payload = sentMail(sendCall);
  assert.deepEqual(Object.keys(payload).sort(), ['message', 'saveToSentItems']);
  assert.equal(payload.saveToSentItems, false);
  assert.deepEqual(Object.keys(payload.message).sort(), ['body', 'subject', 'toRecipients']);
  assert.equal(payload.message.subject, `Mã xác minh liên kết Zalo: ${CODE}`);
  assert.deepEqual(payload.message.toRecipients, [{ emailAddress: { address: TO } }]);
  assert.equal(payload.message.body.contentType, 'HTML');
  const html = payload.message.body.content;
  assert.ok(html.includes(`>${CODE}</p>`));
  assert.ok(html.includes('Mã có hiệu lực đến 17:10 ngày 17/11'));
  assert.ok(html.includes('Nếu Thầy/Cô không yêu cầu, hãy bỏ qua thư này. Không chia sẻ mã cho bất kỳ ai.'));
  assert.ok(html.includes('Kính gửi Thầy/Cô &lt;b&gt;Cô &quot;A&quot; &amp; &#39;B&#39;&lt;/b&gt;,'));
  assert.ok(!html.includes('<b>Cô') && !html.includes(SECRET) && !html.includes('TEST_ONLY_ACCESS_TOKEN'));
  // Minutes are truncated so the stated end is never later than the real expiry.
  await mailer(fake).send(otp({ expiresAt: Date.UTC(2026, 10, 30, 16, 59, 59), name: undefined }));
  const late = sentMail(fake.sendCalls()[1]).message.body.content;
  assert.ok(late.includes('Mã có hiệu lực đến 23:59 ngày 30/11'));
  assert.ok(late.includes('Kính gửi Thầy/Cô,'));
});

test('linked notice names the time and the unlink page, never a code, and cleans disguised names', async () => {
  const fake = graph();
  await mailer(fake).send(linked({ linkedAt: Date.UTC(2026, 10, 30, 17, 30), name: 'Cô\u{202e}\nA\u{200b}  B\u0000' }));
  const payload = sentMail(fake.sendCalls()[0]);
  assert.equal(payload.saveToSentItems, false);
  assert.equal(payload.message.subject, 'Tài khoản Suất ăn vừa liên kết với Zalo');
  const html = payload.message.body.content;
  assert.ok(html.includes('<strong>00:30 ngày 01/12/2026</strong> (giờ Việt Nam)'));
  assert.ok(html.includes(`<strong>${TO}</strong>`));
  assert.ok(html.includes('Nếu không phải Thầy/Cô, vào <a href="https://suatanapp.vercel.app/lien-ket-zalo"'));
  assert.ok(html.includes('>https://suatanapp.vercel.app/lien-ket-zalo</a> để hủy liên kết và báo bộ phận CNTT.'));
  assert.ok(html.includes('Kính gửi Thầy/Cô Cô A B,'));
  assert.ok(!/[\u{202e}\u{200b}\u0000]/u.test(html) && !/\d{6}/.test(payload.message.subject));
});

test('invalid messages are rejected before any network request, so the mailer cannot relay outside school', async () => {
  const fake = graph(), send = mailer(fake);
  const messages = [null, [], 'otp', Object.create({ ...otp() }), { ...otp(), kind: 'other' }, { ...otp(), kind: undefined },
    otp({ to: 'teacher@gmail.com' }), otp({ to: 'teacher@hoangmaistarschool.edu.vn.evil.example' }),
    otp({ to: `${TO}\r\nBcc: x@example.com` }), otp({ to: ` ${TO}` }), otp({ to: [TO] }), otp({ to: undefined }),
    otp({ code: '12345' }), otp({ code: '1234567' }), otp({ code: 123456 }), otp({ code: 'abcdef' }), otp({ code: '١٢٣٤٥٦' }),
    otp({ expiresAt: NaN }), otp({ expiresAt: String(NOW) }), otp({ expiresAt: -1 }), otp({ expiresAt: 0 }),
    otp({ expiresAt: Infinity }), otp({ expiresAt: 8.64e15 }), otp({ name: 123 }), otp({ name: { admin: true } }),
    linked({ linkedAt: undefined }), linked({ linkedAt: 1.5 })];
  for (const message of messages) await assert.rejects(send.send(message), fixedError('invalid_message'));
  assert.equal(fake.calls.length, 0);
});

test('app token is cached until a minute before expiry, shared by concurrent sends and dropped on 401', async () => {
  let now = NOW;
  const fake = graph();
  const send = mailer(fake, { now: () => now });
  await send.send(otp());
  now = NOW + 3599_000 - 60_000 - 1;
  await send.send(linked());
  assert.equal(fake.tokenCalls().length, 1);
  assert.equal(fake.sendCalls().length, 2);
  now += 1;
  await send.send(otp());
  assert.equal(fake.tokenCalls().length, 2);
  assert.equal(fake.sendCalls()[2].options.headers.authorization, 'Bearer TEST_ONLY_ACCESS_TOKEN_2');

  const burst = graph();
  const shared = mailer(burst);
  await Promise.all([shared.send(otp()), shared.send(otp()), shared.send(linked())]);
  assert.equal(burst.tokenCalls().length, 1);
  assert.equal(burst.sendCalls().length, 3);

  const shortLived = graph({ expiresIn: 30 });
  const uncached = mailer(shortLived);
  await uncached.send(otp()); await uncached.send(otp());
  assert.equal(shortLived.tokenCalls().length, 2);

  let reject = true;
  const revoked = graph({ send: () => reject ? new Response(PRIVATE, { status: 401 }) : new Response(null, { status: 202 }) });
  const retrying = mailer(revoked);
  await assert.rejects(retrying.send(otp()), fixedError('send_failed', 401));
  reject = false;
  await retrying.send(otp());
  assert.equal(revoked.tokenCalls().length, 2);
  assert.equal(revoked.sendCalls()[1].options.headers.authorization, 'Bearer TEST_ONLY_ACCESS_TOKEN_2');

  const flaky = graph({ token: count => count === 1 ? new Response(PRIVATE, { status: 500 })
    : Response.json({ token_type: 'Bearer', expires_in: 3599, access_token: 'TEST_ONLY_ACCESS_TOKEN_OK' }) });
  const recovering = mailer(flaky);
  await assert.rejects(recovering.send(otp()), fixedError('token_failed', 500));
  await recovering.send(otp());
  assert.equal(flaky.tokenCalls().length, 2);
  assert.equal(flaky.sendCalls().length, 1);
});

test('provider, parser, transport and forged errors never expose provider text, secrets, code or address', async () => {
  const forged = new ZaloMailError('send_failed');
  forged.message = PRIVATE; forged.httpStatus = 299; forged.detail = PRIVATE;
  const json = (value, status = 200, headers) => Response.json(value, { status, headers });
  const tokenCases = [
    [() => json({ error: 'invalid_client', error_description: `${PRIVATE} ${SECRET}` }, 401), 401],
    [() => new Response(PRIVATE, { status: 200, headers: { 'content-type': 'text/html' } }), 200],
    [() => json({ token_type: 'Bearer', expires_in: 3599 }), 200],
    [() => json({ token_type: 'Bearer', access_token: `TEST_ONLY\r\nX-Injected: ${PRIVATE}` }), 200],
    [() => json({ token_type: 'mac', access_token: 'TEST_ONLY_ACCESS_TOKEN' }), 200],
    [() => json([PRIVATE]), 200],
    [() => json({ access_token: 'TEST_ONLY_ACCESS_TOKEN', padding: 'x'.repeat(40_000) }), 200],
    [() => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999999' } }), 200],
    [() => { throw new Error(PRIVATE); }, undefined],
    [() => { throw forged; }, undefined],
    [() => undefined, undefined],
    [() => new Response(null, { status: 302, headers: { location: `https://evil.example/${PRIVATE}` } }), 302],
  ];
  for (const [token, status] of tokenCases)
    await assert.rejects(mailer(graph({ token })).send(otp()), fixedError('token_failed', status));
  const sendCases = [
    [() => json({ error: { code: 'ErrorAccessDenied', message: `${PRIVATE} ${TO}` } }, 403), 403],
    [() => new Response(PRIVATE, { status: 500 }), 500],
    [() => new Response(PRIVATE, { status: 429, headers: { 'retry-after': '1' } }), 429],
    [() => ({ status: 200, ok: false }), 200],
    [() => { throw new Error(PRIVATE); }, undefined],
    [() => { throw forged; }, undefined],
    [() => new Response(null, { status: 302, headers: { location: `https://evil.example/${PRIVATE}` } }), 302],
  ];
  for (const [send, status] of sendCases) {
    const fake = graph({ send });
    await assert.rejects(mailer(fake).send(otp()), fixedError('send_failed', status));
    assert.equal(fake.sendCalls().length, 1, 'a rejected mail is never retried automatically');
  }
});

test('each Graph request times out and aborts even when the transport or body ignores the signal', async () => {
  let signal;
  await assert.rejects(mailer(graph({ token: (_count, options) => { signal = options.signal; return new Promise(() => {}); } }),
    { timeoutMs: 5 }).send(otp()), fixedError('token_timeout'));
  assert.equal(signal.aborted, true);
  const endless = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); } });
  await assert.rejects(mailer(graph({ token: (_count, options) => { signal = options.signal;
    return new Response(endless, { headers: { 'content-type': 'application/json' } }); } }), { timeoutMs: 5 }).send(otp()),
  fixedError('token_timeout', 200));
  assert.equal(signal.aborted, true);
  const hanging = graph({ send: options => { signal = options.signal; return new Promise(() => {}); } });
  await assert.rejects(mailer(hanging, { timeoutMs: 5 }).send(otp()), fixedError('send_timeout'));
  assert.equal(signal.aborted, true);
  assert.equal(hanging.tokenCalls()[0].options.signal.aborted, false, 'each request has its own deadline');
});

test('failure diagnostics log only a fixed code and a bounded HTTP status', () => {
  const lines = [];
  reportZaloMailFailure(new ZaloMailError('send_failed', 403), line => lines.push(line));
  reportZaloMailFailure(new ZaloMailError('token_timeout'), line => lines.push(line));
  const forged = new ZaloMailError('token_failed', 401);
  forged.code = PRIVATE; forged.httpStatus = PRIVATE;
  reportZaloMailFailure(forged, line => lines.push(line));
  reportZaloMailFailure(Object.assign(new Error(PRIVATE), { code: PRIVATE, httpStatus: 500 }), line => lines.push(line));
  assert.deepEqual(lines, ['DKAN_ZALO_MAIL_FAILED {"code":"send_failed","httpStatus":403}',
    'DKAN_ZALO_MAIL_FAILED {"code":"token_timeout"}', 'DKAN_ZALO_MAIL_FAILED {"code":"unknown"}',
    'DKAN_ZALO_MAIL_FAILED {"code":"unknown"}']);
  assert.doesNotThrow(() => reportZaloMailFailure(new ZaloMailError('send_failed'), () => { throw new Error(PRIVATE); }));
  assert.equal(new ZaloMailError(PRIVATE).code, 'send_failed');
  assert.ok(!new ZaloMailError(PRIVATE).message.includes(PRIVATE));
});
