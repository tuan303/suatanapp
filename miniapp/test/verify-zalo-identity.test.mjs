// Pure, offline verification tests: every possible request uses a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyZaloIdentity, ZaloIdentityError } from '../server/verify-zalo-identity.mjs';

const token = 'TEST_ONLY_zalo_access_token.private-123';
const secret = 'TEST_ONLY_app_key_987654321';
const userId = '3681046936240438345';
const response = body => ({ ok: true, json: async () => body });
const config = fetchImpl => ({ accessToken: token, appSecret: secret, fetchImpl });
const publicError = code => error => {
  assert.ok(error instanceof ZaloIdentityError);
  assert.equal(error.code, code);
  const visible = `${error.message}\n${error.stack}\n${JSON.stringify(error)}`;
  assert.ok(!visible.includes(token), 'token must not escape');
  assert.ok(!visible.includes(secret), 'app secret must not escape');
  assert.equal(error.cause, undefined, 'provider errors must not leak via cause');
  return true;
};

test('calls the fixed HTTPS profile URL with HMAC proof and only returns its app-scoped user ID', async () => {
  let calls = 0;
  const result = await verifyZaloIdentity(config(async (url, options) => {
    calls++;
    assert.equal(url, 'https://graph.zalo.me/v2.0/me?fields=id');
    assert.ok(!url.includes(token));
    assert.ok(!url.includes(secret));
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.access_token, token);
    assert.equal(options.headers.appsecret_proof, createHmac('sha256', secret).update(token).digest('hex'));
    assert.equal(options.headers.accept, 'application/json');
    assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.credentials, 'omit');
    assert.ok(options.signal instanceof AbortSignal);
    return response({ id: userId, error: 0, name: 'Private name must not be returned', app_id: '999' });
  }));
  assert.equal(calls, 1);
  assert.deepEqual(result, { zaloUserId: userId });
});

test('proof is computed with the configured app secret, not a client-supplied proof or ID', async () => {
  const differentSecret = `${secret}2`;
  let proof;
  const result = await verifyZaloIdentity({ ...config(async (_url, options) => {
    proof = options.headers.appsecret_proof;
    return response({ id: userId });
  }), appSecret: differentSecret, zaloUserId: '777', appsecret_proof: 'forged' });
  assert.equal(proof, createHmac('sha256', differentSecret).update(token).digest('hex'));
  assert.notEqual(proof, createHmac('sha256', secret).update(token).digest('hex'));
  assert.deepEqual(result, { zaloUserId: userId });
});

test('rejects missing, whitespace, oversized and placeholder app secrets before any request', async () => {
  for (const appSecret of [undefined, null, '', ' ', `${secret}\n`, 'DÁN_KHÓA_VÀO_ĐÂY',
    'YOUR_ZALO_APP_SECRET_KEY', 'CHANGE_ME', 'REPLACE_ME', 'ZALO_APP_SECRET_KEY', 'secret',
    '<app-key>', '${ZALO_APP_SECRET_KEY}', 'x'.repeat(1025)]) {
    let calls = 0;
    await assert.rejects(verifyZaloIdentity({ ...config(async () => { calls++; }), appSecret }), publicError('invalid_config'));
    assert.equal(calls, 0);
  }
});

test('rejects missing, non-ASCII, whitespace and oversized access tokens before any request', async () => {
  for (const accessToken of [undefined, null, '', ' ', 'leading space', `${token}\n`, 'tokené', 'x'.repeat(4097)]) {
    let calls = 0;
    await assert.rejects(verifyZaloIdentity({ ...config(async () => { calls++; }), accessToken }), publicError('invalid_token'));
    assert.equal(calls, 0);
  }
});

test('accepts the bounded maximum token and canonical maximum numeric user ID', async () => {
  const id = '9'.repeat(40);
  assert.deepEqual(await verifyZaloIdentity({ ...config(async () => response({ id })), accessToken: 'x'.repeat(4096) }), { zaloUserId: id });
});

test('invalid timeouts, fetch implementations and option objects fail closed', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 1.5, '8000', 30_001]) {
    await assert.rejects(verifyZaloIdentity({ ...config(async () => assert.fail('must not fetch')), timeoutMs }), publicError('invalid_config'));
  }
  for (const fetchImpl of [null, {}, 'fetch']) {
    await assert.rejects(verifyZaloIdentity({ ...config(fetchImpl) }), publicError('invalid_config'));
  }
  for (const options of [null, [], 1, 'options']) {
    await assert.rejects(verifyZaloIdentity(options), publicError('invalid_config'));
  }
  await assert.rejects(verifyZaloIdentity(), publicError('invalid_config'));
});

test('rejects all unsuccessful HTTP responses without reading or repeating their private bodies', async () => {
  for (const status of [301, 302, 400, 401, 403, 429, 500, 503]) {
    await assert.rejects(verifyZaloIdentity(config(async () => ({ ok: false, status,
      json: async () => assert.fail('must not parse an unsuccessful response') }))), publicError('verification_failed'));
  }
});

test('a Graph error cannot supply a valid-looking ID to bypass verification', async () => {
  for (const error of [-124, 1, '0', null, false, { code: -1, message: `${token} ${secret}` }]) {
    await assert.rejects(verifyZaloIdentity(config(async () => response({ id: userId, error, message: `${token} ${secret}` }))), publicError('verification_failed'));
  }
});

test('rejects missing and malformed profile bodies', async () => {
  for (const body of [undefined, null, [], 'profile', 7, true, {}, { user_id: userId }, { id: 3681046936240438345 },
    { id: '' }, { id: '0' }, { id: '000123' }, { id: '+123' }, { id: ' 123' }, { id: '123\n' },
    { id: '123.5' }, { id: '9'.repeat(41) }, { id: token }]) {
    await assert.rejects(verifyZaloIdentity(config(async () => response(body))), publicError('verification_failed'));
  }
});

test('inherited IDs are not accepted as a provider identity', async () => {
  await assert.rejects(verifyZaloIdentity(config(async () => response(Object.create({ id: userId })))), publicError('verification_failed'));
});

test('missing response objects, ok:true and a JSON parser are required', async () => {
  for (const result of [undefined, null, {}, { ok: 'true', json: async () => ({ id: userId }) }, { ok: true }]) {
    await assert.rejects(verifyZaloIdentity(config(async () => result)), publicError('verification_failed'));
  }
});

test('network errors are fixed public errors even when transport errors contain both credentials', async () => {
  await assert.rejects(verifyZaloIdentity(config(async () => {
    throw new Error(`Private request headers: ${token}; ${secret}`);
  })), publicError('verification_failed'));
});

test('transport-supplied error classes and messages cannot masquerade as trusted public errors', async () => {
  const error = new ZaloIdentityError('invalid_config');
  error.message = `${token} ${secret}`;
  Object.defineProperty(error, 'code', { get() { throw new Error(`${token} ${secret}`); } });
  await assert.rejects(verifyZaloIdentity(config(async () => { throw error; })), publicError('verification_failed'));
});

test('non-JSON/provider parsing errors do not expose their bodies or credentials', async () => {
  await assert.rejects(verifyZaloIdentity(config(async () => ({ ok: true, json: async () => {
    throw new SyntaxError(`Invalid JSON containing ${token} ${secret}`);
  } }))), publicError('verification_failed'));
});

test('timeout aborts the request and also settles a transport that ignores AbortSignal', async () => {
  let signal;
  await assert.rejects(verifyZaloIdentity({ ...config(async (_url, options) => {
    signal = options.signal;
    return await new Promise(() => {});
  }), timeoutMs: 10 }), publicError('timeout'));
  assert.equal(signal.aborted, true);
});

test('the same timeout covers response body parsing rather than just response headers', async () => {
  let signal;
  await assert.rejects(verifyZaloIdentity({ ...config(async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: async () => await new Promise(() => {}) };
  }), timeoutMs: 10 }), publicError('timeout'));
  assert.equal(signal.aborted, true);
});

test('a provider getter that throws private text also fails closed without echoing it', async () => {
  const body = { get id() { throw new Error(`${token} ${secret}`); } };
  await assert.rejects(verifyZaloIdentity(config(async () => response(body))), publicError('verification_failed'));
});

test('Graph denial carries only its bounded numeric error code and HTTP status', async () => {
  await assert.rejects(verifyZaloIdentity(config(async () => ({
    ok: true, status: 200, json: async () => ({ id: userId, error: -1241, message: `${token} ${secret}`, detail: { token } }),
  }))), error => {
    publicError('verification_failed')(error);
    assert.deepEqual(error.diagnostic, { stage: 'provider', providerCode: -1241, httpStatus: 200 });
    assert.equal(Object.isFrozen(error.diagnostic), true);
    assert.throws(() => { error.diagnostic.providerCode = -124; }, TypeError);
    assert.throws(() => { error.diagnostic = { stage: 'transport' }; }, TypeError);
    return true;
  });
});

test('non-success HTTP, network failure and malformed JSON remain distinct without private body reads', async () => {
  const cases = [
    [async () => ({ ok: false, status: 403, json: async () => assert.fail('must not read private unsuccessful body') }), { stage: 'http', httpStatus: 403 }],
    [async () => { throw new Error(`${token} ${secret}`); }, { stage: 'transport' }],
    [async () => ({ ok: true, status: 200, json: async () => { throw new Error(`${token} ${secret}`); } }), { stage: 'response', httpStatus: 200 }],
    [async () => ({ ok: true, status: 200, json: async () => ({ error: 0 }) }), { stage: 'response', httpStatus: 200 }],
  ];
  for (const [fetchImpl, diagnostic] of cases) {
    await assert.rejects(verifyZaloIdentity(config(fetchImpl)), error => {
      publicError('verification_failed')(error); assert.deepEqual(error.diagnostic, diagnostic); return true;
    });
  }
});

test('provider error codes never coerce private text, objects or oversized identifiers into diagnostics', async () => {
  for (const errorCode of [token, secret, '-1241', Infinity, NaN, 100000, -100000, { code: -1241, message: token }]) {
    await assert.rejects(verifyZaloIdentity(config(async () => ({ ok: true, status: 200,
      json: async () => ({ error: errorCode, id: userId, message: token }) }))), error => {
      publicError('verification_failed')(error);
      assert.deepEqual(error.diagnostic, { stage: 'provider', httpStatus: 200 }); return true;
    });
  }
});

test('injected transport exceptions cannot forge provider diagnostics', async () => {
  for (const exception of [new ZaloIdentityError('verification_failed', { stage: 'provider', providerCode: -1241, httpStatus: 200 }),
    { diagnostic: { stage: 'provider', providerCode: -1241, httpStatus: 200 }, message: token },
    { get diagnostic() { throw new Error(secret); } }]) {
    await assert.rejects(verifyZaloIdentity(config(async () => { throw exception; })), error => {
      publicError('verification_failed')(error); assert.deepEqual(error.diagnostic, { stage: 'transport' }); return true;
    });
  }
});

test('deadline during body parsing exposes timeout stage without pending response content', async () => {
  await assert.rejects(verifyZaloIdentity({ ...config(async () => ({ ok: true, status: 200,
    json: async () => new Promise(() => {}) })), timeoutMs: 5 }), error => {
    publicError('timeout')(error); assert.deepEqual(error.diagnostic, { stage: 'timeout', httpStatus: 200 }); return true;
  });
});

test('diagnostic constructor strips unsupported stages, identifiers and arbitrary properties', () => {
  for (const diagnostic of [null, [], { stage: token }, { stage: 'provider', get providerCode() { throw new Error(secret); } }]) {
    const error = new ZaloIdentityError('verification_failed', diagnostic);
    assert.equal(error.diagnostic, undefined);
    assert.ok(!JSON.stringify(error).includes(token));
    assert.ok(!JSON.stringify(error).includes(secret));
  }
  const safe = new ZaloIdentityError('verification_failed', { stage: 'http', httpStatus: 700, providerCode: 0.5,
    id: userId, token, appSecret: secret, detail: { token } });
  assert.deepEqual(safe.diagnostic, { stage: 'http' });
});
