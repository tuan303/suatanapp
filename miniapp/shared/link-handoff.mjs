export const ZALO_MINI_APP_URL = 'https://zalo.me/s/3378419117469948059/';
export const ZALO_LINK_PARAM = 'dkanLink';

// The existing API issues 18 random bytes encoded as an unpadded base64url string.
export function isZaloHandoffCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{24}$/.test(value);
}

export function readZaloHandoffCode(search) {
  const values = new URLSearchParams(search).getAll(ZALO_LINK_PARAM);
  return values.length === 1 && isZaloHandoffCode(values[0]) ? values[0] : null;
}

export function zaloHandoffUrl(code) {
  if (!isZaloHandoffCode(code)) return null;
  const url = new URL(ZALO_MINI_APP_URL);
  url.searchParams.set(ZALO_LINK_PARAM, code);
  return url.href;
}
