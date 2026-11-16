export const ZALO_MINI_APP_URL: string;
export const ZALO_LINK_PARAM: string;
export function isZaloHandoffCode(value: unknown): value is string;
export function readZaloHandoffCode(search: string): string | null;
export function zaloHandoffUrl(code: unknown): string | null;
