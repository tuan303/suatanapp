// SERVER ONLY. Rate limit for the fixed DKAN_ZALO_* diagnostic lines.
// Anyone can send a junk Zalo token and so trigger DKAN_ZALO_VERIFY_FAILED, and
// the VPS task appends every line to logs\api.log, so each code is capped per
// minute. Codes are counted apart, so a flood of one never hides another.
const WINDOW_MS = 60_000;
const LINES_PER_WINDOW = 20;

/**
 * Wraps `write` so each DKAN_ZALO_* code writes at most `limit` lines per
 * window. The first line of a later window is preceded by one
 * `<code>_SUPPRESSED {"count":n}` line for what the previous window dropped;
 * that line holds only the count, never an input value.
 */
export function createDiagnosticThrottle(write, { now = () => Date.now(), limit = LINES_PER_WINDOW, windowMs = WINDOW_MS } = {}) {
  const windows = new Map();
  return line => {
    const code = /^DKAN_ZALO_[A-Z_]+/.exec(String(line))?.[0] ?? 'DKAN_ZALO_OTHER';
    const at = now();
    let state = windows.get(code);
    // A clock that moved back also starts a new window.
    if (!state || at < state.start || at - state.start >= windowMs) {
      if (state?.suppressed) write(`${code}_SUPPRESSED ${JSON.stringify({ count: state.suppressed })}`);
      state = { start: at, count: 0, suppressed: 0 };
      windows.set(code, state);
    }
    if (state.count < limit) { state.count++; write(line); } else state.suppressed++;
  };
}

/** Default reporter of the Zalo API: console.warn, throttled per code. */
export const reportZaloDiagnostic = createDiagnosticThrottle(line => console.warn(line));
