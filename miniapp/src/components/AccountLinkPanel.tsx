import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccountLinkError, accountLinkMessage, classifyZaloSdkEnvironment, createAccountLinkClient, normalizeSchoolEmail, SCHOOL_EMAIL_DOMAIN } from '../lib/accountLink';
import type { LinkedSession, OtpSent } from '../lib/accountLink';
import { ACCOUNT_LINK_BUILD } from '../lib/appVersion';

// Main path: email -> 6-digit code -> linked. 'waiting' is the website handoff,
// kept for links opened from the website button/QR but no longer promoted.
type View = 'email' | 'verify' | 'waiting' | 'linked';
type Busy = 'check' | 'send' | 'resend' | 'verify' | 'claim' | 'finish' | 'refresh' | 'logout' | 'website' | null;
type Request = { signal: AbortSignal; active: () => boolean };
// The server keeps a 60 s cooldown between sends, per Zalo user and per school account.
const RESEND_COOLDOWN_MS = 60_000;
// verifyOtp failures after which the server may already have linked this Zalo.
const LINK_MAY_HAVE_COMMITTED = new Set(['timeout', 'network', 'service_unavailable', 'otp_expired']);
// Zalo SDK failures carry a support diagnostic; server and network ones do not.
const fromSdk = (error: unknown) => error instanceof AccountLinkError && !!error.diagnostic;
// rate_limited on the email step means no code to type: a repeat while a code
// is still active is answered with that code (and opens the code step). So
// never point to the mailbox here; point to waiting, or to the website path,
// which these limits do not cover (someone else may have used them up).
const OTP_SEND_LIMITED = 'Tạm thời chưa gửi được mã: lần gửi trước chưa đủ 1 phút, hoặc email/Zalo này đã nhận đủ số mã cho phép. Thầy/Cô đợi ít phút rồi gửi lại, hoặc chọn Cách khác: liên kết qua website ở bên dưới.';
// On the code step the newest mail may still hold a usable code.
const OTP_RESEND_LIMITED = 'Tạm thời chưa gửi được mã mới: email/Zalo này đã nhận đủ số mã cho phép. Thầy/Cô thử mã trong thư mới nhất (xem cả mục Thư rác), hoặc bấm Đổi email rồi chọn Cách khác: liên kết qua website.';
const timeLabel = (value: number) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(value));
const minuteLabel = (value: number) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit',
}).format(new Date(value));
// Pasted codes may contain spaces, dashes or full-width digits (NFKC maps
// those to ASCII); keep the first six ASCII digits.
export const codeDigits = (value: string) => value.normalize('NFKC').replace(/\D/g, '').slice(0, 6);
/**
 * Local deadline for the next send, counted from when the reply arrived on the
 * device clock only. The server's resendAt is on its own clock: subtracting the
 * two would open the button early on a phone that runs fast. The server started
 * its cooldown before mailing, so this is never shorter, only seconds longer.
 */
export const resendDeadline = (receivedAt: number) => receivedAt + RESEND_COOLDOWN_MS;
const liveSession = (value: LinkedSession | null | undefined) => value && value.expiresAt > Date.now() ? value : null;
// Module memory only, never storage, and no token or code: closing the dialog
// while reading the mail reopens the code step instead of asking for a new
// code during the resend cooldown. The device clock only decides whether to
// resume; the server still decides expiry.
let pendingOtp: { email: string; otp: OtpSent } | null = null;
// Earliest local time for the next send. Survives "Đổi email" and a closed
// dialog: the server counts the cooldown per Zalo user, not per address.
let sendCooldownUntil = 0;
const resumableOtp = () => {
  if (pendingOtp && pendingOtp.otp.expiresAt <= Date.now()) pendingOtp = null;
  return pendingOtp;
};

/** The code step, separate so its states render without a live mailbox. */
export function OtpCodeStep({ otp, code, busy, resendIn, invalid = false, describedBy = 'ma-link-otp-hint', inputRef, onCode, onSubmit, onResend, onChangeEmail }: {
  otp: OtpSent;
  code: string;
  busy: Busy;
  resendIn: number;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: RefObject<HTMLInputElement>;
  onCode: (value: string) => void;
  onSubmit: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  return <>
    {otp.replacesExisting && <div className="ma-link-warn"><strong>Sẽ thay tài khoản Zalo đang liên kết</strong><p>Email này đang liên kết với một tài khoản Zalo khác. Sau khi xác minh, liên kết chuyển sang Zalo này và Zalo cũ sẽ phải đăng nhập lại.</p></div>}
    <form className="ma-otp-form" noValidate onSubmit={event => { event.preventDefault(); onSubmit(); }}>
      <label className="ma-field" htmlFor="ma-link-otp">Mã xác minh 6 số</label>
      {/* readOnly, not disabled, while checking: the field keeps focus and the keyboard stays open for a retry.
          No maxLength: the browser would cut a paste such as "123 456" or the mail subject before
          codeDigits could clean it; the controlled value already keeps six digits at most. */}
      <input id="ma-link-otp" ref={inputRef} className={`ma-link-code-input ma-otp-input${invalid ? ' ma-field-invalid' : ''}`}
        type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" enterKeyHint="done" placeholder="••••••"
        value={code} readOnly={!!busy} aria-invalid={invalid} aria-describedby={describedBy}
        onChange={event => onCode(event.target.value)}
        onPaste={event => {
          // A pasted full code replaces the digits already typed instead of
          // joining them: a mixed code would auto-submit and use up a try.
          const pasted = codeDigits(event.clipboardData.getData('text'));
          if (busy || pasted.length !== 6) return;
          event.preventDefault();
          onCode(pasted);
        }} />
      <p id="ma-link-otp-hint" className="ma-field-hint">Mã có hiệu lực đến {minuteLabel(otp.expiresAt)}. Đủ 6 số sẽ tự xác minh. Không thấy thư? Xem cả mục Thư rác (Junk).</p>
      <button className="ma-primary" type="submit" disabled={code.length !== 6 || !!busy}>{busy === 'verify' ? 'Đang xác minh…' : 'Xác minh và liên kết'}</button>
    </form>
    <div className="ma-otp-actions">
      <button type="button" className="ma-link-secondary" disabled={!!busy || resendIn > 0} onClick={onResend}>{busy === 'resend' ? 'Đang gửi lại mã…' : resendIn > 0 ? `Gửi lại mã sau ${resendIn} giây` : 'Gửi lại mã'}</button>
      <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={onChangeEmail}>Đổi email</button>
    </div>
  </>;
}

/** The email step's form, separate so the send countdown renders without a live server. */
export function OtpEmailStep({ email, busy, sendIn, configured, invalid = false, describedBy = 'ma-link-email-hint', inputRef, onEmail, onSubmit }: {
  email: string;
  busy: Busy;
  sendIn: number;
  configured: boolean;
  invalid?: boolean;
  describedBy?: string;
  inputRef?: RefObject<HTMLInputElement>;
  onEmail: (value: string) => void;
  onSubmit: () => void;
}) {
  const label = busy === 'send' ? 'Đang gửi mã…' : busy === 'finish' ? 'Đang đăng nhập…' : sendIn > 0 ? `Gửi mã sau ${sendIn} giây` : 'Gửi mã xác minh';
  return <form className="ma-otp-form" noValidate onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <label className="ma-field" htmlFor="ma-link-email">Email nhà trường</label>
    <div className={`ma-email-field${invalid ? ' ma-field-invalid' : ''}`}>
      <input id="ma-link-email" ref={inputRef} className="ma-email-input" type="text" inputMode="email" autoComplete="email"
        autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="send" maxLength={254} placeholder="tenban"
        value={email} readOnly={!!busy} aria-invalid={invalid} aria-describedby={describedBy}
        onChange={event => onEmail(event.target.value)} />
      {!email.includes('@') && <span className="ma-email-suffix" aria-hidden="true">@{SCHOOL_EMAIL_DOMAIN}</span>}
    </div>
    <p id="ma-link-email-hint" className="ma-field-hint">Nhập phần trước @{SCHOOL_EMAIL_DOMAIN} (gõ cả địa chỉ cũng được). Mã xác minh 6 số sẽ gửi tới hộp thư nhà trường.{sendIn > 0 && ' Mỗi lần gửi mã cách nhau 1 phút.'}</p>
    {/* The server's cooldown counts per Zalo user, so a corrected address waits too. */}
    <button className="ma-primary" type="submit" disabled={!configured || !email.trim() || !!busy || sendIn > 0}>{label}</button>
  </form>;
}

/**
 * The website path inside "Cách khác: liên kết qua website": the opening action
 * (Zalo WebView inside the Mini App, a plain link elsewhere) and the address to
 * paste into Chrome or Safari when the WebView or the Microsoft sign-in fails.
 * Separate so its states render without the SDK.
 */
export function SchoolVerificationWebsite({ website, busy, openWebsite, copyWebsite }: {
  website: string; busy: Busy; openWebsite: () => void; copyWebsite: () => void;
}) {
  return <>
    {classifyZaloSdkEnvironment() === 'miniapp'
      ? <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={openWebsite}>{busy === 'website' ? 'Đang mở website…' : 'Mở website liên kết'}</button>
      : <a className="ma-link-secondary ma-link-action" href={website} target="_blank" rel="noopener noreferrer">Mở website liên kết</a>}
    <div className="ma-link-how">
      <strong>Mở bằng Chrome hoặc Safari</strong>
      <p>Nếu trang không mở hoặc Microsoft không đăng nhập được, Thầy/Cô mở trình duyệt điện thoại và dán địa chỉ này.</p>
      <code className="ma-link-address">{website}</code>
      <button type="button" className="ma-link-secondary" onClick={copyWebsite}>Sao chép địa chỉ</button>
    </div>
  </>;
}

export function AccountLinkPanel({
  apiOrigin = import.meta.env.VITE_DKAN_API_ORIGIN,
  development = import.meta.env.DEV,
  initialSession = null,
  onSessionChange,
  handoffCode = null,
  onHandoffConsumed,
}: {
  apiOrigin?: string;
  development?: boolean;
  initialSession?: LinkedSession | null;
  onSessionChange?: (session: LinkedSession | null) => void;
  handoffCode?: string | null;
  onHandoffConsumed?: (code: string) => void;
}) {
  const setup = useMemo(() => {
    try { return { client: createAccountLinkClient({ origin: apiOrigin, development }), error: null }; }
    catch (error) { return { client: null, error: accountLinkMessage(error) }; }
  }, [apiOrigin, development]);
  const client = setup.client;
  const website = client?.websiteUrl;
  const [view, setView] = useState<View>(() => liveSession(initialSession) ? 'linked' : resumableOtp() ? 'verify' : 'email');
  const [busy, setBusy] = useState<Busy>(null);
  const [email, setEmail] = useState(() => liveSession(initialSession) ? '' : resumableOtp()?.email ?? '');
  const [code, setCode] = useState('');
  const [otp, setOtp] = useState<OtpSent | null>(() => liveSession(initialSession) ? null : resumableOtp()?.otp ?? null);
  const [sendAfter, setSendAfter] = useState(() => sendCooldownUntil);
  const [now, setNow] = useState(() => Date.now());
  const [linkCode, setLinkCode] = useState('');
  const [manualEntry, setManualEntry] = useState(false);
  const [relogin, setRelogin] = useState(false);
  const [invalidField, setInvalidField] = useState<'email' | 'code' | null>(null);
  const [session, setSession] = useState<LinkedSession | null>(() => liveSession(initialSession));
  const [claimExpiry, setClaimExpiry] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pollPaused, setPollPaused] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zaloToken = useRef('');
  const claimToken = useRef('');
  // The session this panel last showed or produced, to tell its own updates
  // (link, logout) apart from ones App makes (silent sign-in, expiry).
  const ownToken = useRef<string | null>(liveSession(initialSession)?.sessionToken ?? null);
  const ownClient = useRef(client);
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const focusEmail = useRef(false);
  const sessionListener = useRef(onSessionChange);
  sessionListener.current = onSessionChange;

  function updateSession(value: LinkedSession | null) {
    ownToken.current = value?.sessionToken ?? null;
    setSession(value);
    sessionListener.current?.(value);
  }

  function invalidate() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    if (pollTimer.current !== null) clearTimeout(pollTimer.current);
    pollTimer.current = null;
  }
  function begin(): Request {
    invalidate();
    const requestController = new AbortController();
    controller.current = requestController;
    const ticket = generation.current;
    return { signal: requestController.signal, active: () => mounted.current && generation.current === ticket && !requestController.signal.aborted };
  }
  function clearIdentity() {
    zaloToken.current = '';
    claimToken.current = '';
    pendingOtp = null;
    sendCooldownUntil = 0;
    updateSession(null);
    setClaimExpiry(null);
    setOtp(null);
    setSendAfter(0);
    setCode('');
    setLinkCode('');
    setPollPaused(false);
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      invalidate();
      zaloToken.current = '';
      claimToken.current = '';
    };
  }, []);
  useEffect(() => {
    const restored = liveSession(initialSession);
    // Changes made by this panel keep their view and notice (e.g. after logout).
    if ((restored?.sessionToken ?? null) === ownToken.current && client === ownClient.current) return;
    invalidate();
    ownToken.current = restored?.sessionToken ?? null;
    ownClient.current = client;
    zaloToken.current = ''; claimToken.current = ''; pendingOtp = null; sendCooldownUntil = 0;
    setSession(restored);
    setView(restored ? 'linked' : 'email');
    setBusy(null); setError(null); setNotice(null); setInvalidField(null);
    setClaimExpiry(null); setOtp(null); setSendAfter(0); setCode(''); setLinkCode(''); setPollPaused(false);
  }, [client, initialSession?.sessionToken]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      invalidate();
      clearIdentity();
      setView('email');
      setBusy(null);
      setRelogin(true);
      setError('Phiên cá nhân đã hết hạn. Vui lòng đăng nhập lại bằng Zalo.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  // One deadline for both steps: "Gửi lại mã" and, after "Đổi email", "Gửi mã xác minh".
  const waitIn = Math.max(0, Math.ceil((sendAfter - now) / 1000));
  const resendIn = view === 'verify' && otp ? waitIn : 0;
  const sendIn = view === 'email' ? waitIn : 0;
  const counting = resendIn > 0 || sendIn > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [counting, now]);
  useEffect(() => { if (view === 'verify') codeInput.current?.focus(); }, [view, otp]);
  useEffect(() => {
    if (view !== 'email' || !focusEmail.current) return;
    focusEmail.current = false;
    emailInput.current?.focus();
  }, [view]);

  /**
   * Runs one API call with a Zalo token kept only in memory. A cached token can
   * expire while the user reads the mail, so an auth failure fetches a fresh one
   * once. The server checks the token before any code or mail, so a retry never
   * counts as a wrong attempt or sends a second mail.
   */
  async function withZaloToken<T>(request: Request, run: (token: string) => Promise<T>): Promise<T> {
    if (!client) throw new AccountLinkError('not_configured');
    const cached = zaloToken.current;
    const token = cached || await client.getZaloToken(request.signal);
    if (!request.active()) throw new AccountLinkError('cancelled');
    zaloToken.current = token;
    try { return await run(token); }
    catch (error) {
      if (!cached || !(error instanceof AccountLinkError) || error.code !== 'auth_required' || !request.active()) throw error;
      zaloToken.current = '';
      const fresh = await client.getZaloToken(request.signal);
      if (!request.active()) throw new AccountLinkError('cancelled');
      zaloToken.current = fresh;
      return run(fresh);
    }
  }

  function finishLinked(result: LinkedSession) {
    if (handoffCode) onHandoffConsumed?.(handoffCode);
    zaloToken.current = '';
    claimToken.current = '';
    pendingOtp = null;
    setOtp(null); setCode(''); setLinkCode(''); setClaimExpiry(null); setPollPaused(false);
    setRelogin(false); setManualEntry(false); setInvalidField(null); setError(null);
    updateSession(result);
    setView('linked');
  }

  function endClaim(error: AccountLinkError) {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setView('email');
    setBusy(null);
    setPollPaused(false);
    setError(accountLinkMessage(error));
  }

  // Website handoff (and "sign in again"): asks the server whether this Zalo account is linked.
  async function checkAccount() {
    if (!client?.configured || busy) return;
    const request = begin();
    clearIdentity();
    setView('email');
    setBusy('check');
    setError(null);
    setNotice(null);
    setInvalidField(null);
    let sendingHandoff = false;
    try {
      const token = await client.getZaloToken(request.signal);
      if (!request.active()) return;
      zaloToken.current = token;
      const result = await client.login(token, request.signal);
      if (!request.active()) return;
      if (result.linked) finishLinked(result);
      else if (handoffCode) {
        sendingHandoff = true;
        setBusy('claim');
        await sendClaim(request, handoffCode);
        if (request.active()) onHandoffConsumed?.(handoffCode);
      } else {
        setRelogin(false);
        setNotice('Tài khoản Zalo này chưa liên kết. Thầy/Cô nhập email nhà trường để nhận mã xác minh.');
      }
    } catch (caught) {
      if (!request.active()) return;
      if (sendingHandoff && handoffCode && caught instanceof AccountLinkError
        && ['challenge_unavailable', 'expired', 'link_conflict'].includes(caught.code)) {
        onHandoffConsumed?.(handoffCode);
        setView('email');
      } else {
        zaloToken.current = '';
      }
      setError(accountLinkMessage(caught));
    } finally { if (request.active()) setBusy(null); }
  }

  async function sendOtp(resend = false) {
    if (!client?.configured || busy || Date.now() < sendAfter) return;
    const address = normalizeSchoolEmail(email);
    if (!address) {
      // Checked on the phone first: a typo never reaches the server or a mailbox.
      setNotice(null);
      setInvalidField('email');
      setError(accountLinkMessage(new AccountLinkError('invalid_email')));
      if (!resend) emailInput.current?.focus();
      return;
    }
    const request = begin();
    setBusy(resend ? 'resend' : 'send');
    setError(null);
    setNotice(null);
    setInvalidField(null);
    try {
      const result = await withZaloToken(request, token => client.requestOtp(token, address, request.signal));
      if (!request.active()) return;
      if (result.state === 'linked') {
        // This Zalo account is already linked: no mail was sent, just sign in.
        setBusy('finish');
        const login = await withZaloToken(request, token => client.login(token, request.signal));
        if (!request.active()) return;
        if (!login.linked) throw new AccountLinkError('link_not_confirmed');
        finishLinked(login);
        return;
      }
      const at = Date.now();
      // A repeat inside the cooldown gets the code already mailed (same expiry).
      const sameCode = !!otp && otp.expiresAt === result.expiresAt;
      sendCooldownUntil = resendDeadline(at);
      pendingOtp = { email: address, otp: result };
      setSendAfter(sendCooldownUntil);
      setOtp(result);
      setNow(at);
      setCode('');
      setRelogin(false);
      setManualEntry(false);
      setView('verify');
      if (resend) setNotice(sameCode ? `Mã trong thư vừa gửi tới ${result.emailMasked} vẫn dùng được.`
        : `Đã gửi mã mới tới ${result.emailMasked}. Mã trong thư trước không còn dùng được.`);
    } catch (caught) {
      if (!request.active()) return;
      const failure = caught instanceof AccountLinkError ? caught.code : null;
      if (failure === 'auth_required') zaloToken.current = '';
      if (failure === 'account_not_found' || failure === 'invalid_email') setInvalidField('email');
      // The website sign-in creates the missing account, and the website path
      // is outside the code limits: offer it right here for both.
      const limited = failure === 'rate_limited' && !fromSdk(caught);
      if (failure === 'account_not_found' || (limited && !resend)) setManualEntry(true);
      // An SDK-side limit carries a diagnostic and keeps its own message.
      setError(limited ? (resend ? OTP_RESEND_LIMITED : OTP_SEND_LIMITED) : accountLinkMessage(caught));
    } finally { if (request.active()) setBusy(null); }
  }

  async function verifyCode(value: string) {
    if (!client?.configured || busy || !otp || !/^\d{6}$/.test(value)) return;
    const request = begin();
    setBusy('verify');
    setError(null);
    setNotice(null);
    setInvalidField(null);
    try {
      const result = await withZaloToken(request, token => client.verifyOtp(token, value, request.signal));
      if (request.active()) finishLinked(result);
    } catch (caught) {
      if (!request.active()) return;
      const failure = caught instanceof AccountLinkError ? caught.code : null;
      // A correct code may have linked the account even though its reply was
      // lost (slow network or proxy deadline); the code is single-use, so a
      // retry would only say "expired". Ask once whether Zalo is linked now.
      if (failure && LINK_MAY_HAVE_COMMITTED.has(failure) && !fromSdk(caught)) {
        try {
          const login = await withZaloToken(request, token => client.login(token, request.signal));
          if (!request.active()) return;
          if (login.linked) { finishLinked(login); return; }
        } catch { if (!request.active()) return; }
      }
      if (failure === 'auth_required') zaloToken.current = '';
      // Clear a rejected code so the next six digits submit by themselves.
      if (failure === 'otp_invalid' || failure === 'otp_expired') { setCode(''); setInvalidField('code'); }
      setError(accountLinkMessage(caught));
      codeInput.current?.focus();
    } finally { if (request.active()) setBusy(null); }
  }

  function changeCode(value: string) {
    const digits = codeDigits(value);
    setCode(digits);
    if (invalidField === 'code') setInvalidField(null);
    if (digits.length === 6) void verifyCode(digits);
  }
  function changeEmail() {
    invalidate();
    // The code is dropped, the send deadline is not: the server would refuse
    // a corrected address from this Zalo until the cooldown ends.
    pendingOtp = null;
    setOtp(null);
    setNow(Date.now());
    setCode('');
    setBusy(null);
    setError(null);
    setNotice(null);
    setInvalidField(null);
    focusEmail.current = true;
    setView('email');
  }

  async function openWebsite() {
    if (!website || busy) return;
    const request = begin();
    setBusy('website');
    setError(null);
    setNotice(null);
    try {
      const { openWebview } = await import('zmp-sdk');
      if (!request.active()) return;
      // The bridge may finish only after the app is foregrounded again.
      setBusy(null);
      await openWebview({ url: website, config: { style: 'normal' } });
    } catch {
      if (request.active()) {
        setManualEntry(true);
        setError('Chưa mở được trang xác minh trong Zalo. Hãy mở địa chỉ bên dưới bằng Chrome hoặc Safari.');
      }
    } finally { if (request.active()) setBusy(null); }
  }

  async function copyWebsite() {
    if (!website) return;
    const ticket = generation.current;
    setError(null);
    setNotice(null);
    try {
      await navigator.clipboard.writeText(website);
      if (mounted.current && ticket === generation.current) setNotice('Đã sao chép địa chỉ. Mở Chrome hoặc Safari và dán vào thanh địa chỉ.');
    } catch {
      if (mounted.current && ticket === generation.current) setNotice('Nhấn giữ địa chỉ hiển thị để sao chép, rồi dán vào Chrome hoặc Safari.');
    }
  }

  async function pollClaim(request: Request) {
    if (!client || !request.active()) return;
    let websiteConfirmed = false;
    try {
      const result = await client.claimStatus(claimToken.current, request.signal);
      if (!request.active()) return;
      if (result.state === 'expired') { endClaim(new AccountLinkError('expired')); return; }
      if (result.state === 'approved') {
        websiteConfirmed = true;
        setBusy('finish');
        const login = await client.login(zaloToken.current, request.signal);
        if (!request.active()) return;
        if (!login.linked) throw new AccountLinkError('link_not_confirmed');
        finishLinked(login);
        setBusy(null);
        return;
      }
      setPollPaused(false);
      setError(null);
      setClaimExpiry(result.expiresAt);
      pollTimer.current = setTimeout(() => { void pollClaim(request); }, 3000);
    } catch (caught) {
      if (!request.active()) return;
      const failure = caught instanceof AccountLinkError ? caught.code : null;
      if (websiteConfirmed || failure === 'auth_required') {
        invalidate();
        clearIdentity();
        setView('email');
        setBusy(null);
        setRelogin(true);
        if (websiteConfirmed) setNotice('Website đã xác nhận liên kết. Bấm Đăng nhập lại bằng Zalo để mở dữ liệu cá nhân.');
        setError(accountLinkMessage(caught));
        return;
      }
      if (caught instanceof AccountLinkError && (failure === 'expired' || failure === 'challenge_unavailable')) {
        endClaim(caught);
        return;
      }
      setBusy(null);
      setPollPaused(true);
      setError(accountLinkMessage(caught));
    }
  }

  async function sendClaim(request: Request, value: string) {
    if (!client) return;
    const result = await client.claim(zaloToken.current, value, request.signal);
    if (!request.active()) return;
    claimToken.current = result.claimToken;
    setClaimExpiry(result.expiresAt);
    setLinkCode('');
    setView('waiting');
    setBusy(null);
    setPollPaused(false);
    void pollClaim(request);
  }

  // Fallback for phones that cannot open the website's "Mở trong Zalo" link.
  async function claimCode() {
    if (!client?.configured || busy || !linkCode.trim()) return;
    const request = begin();
    setBusy('claim');
    setError(null);
    setNotice(null);
    try {
      await withZaloToken(request, () => sendClaim(request, linkCode));
    } catch (caught) {
      if (request.active()) setError(accountLinkMessage(caught));
    } finally { if (request.active()) setBusy(null); }
  }
  function retryPoll() {
    if (!claimToken.current || busy) return;
    const request = begin();
    setPollPaused(false);
    setError(null);
    void pollClaim(request);
  }
  function emailInstead() {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setLinkCode('');
    setBusy(null);
    setError(null);
    setNotice(null);
    setPollPaused(false);
    focusEmail.current = true;
    setView('email');
  }
  async function refreshProfile() {
    if (!client || !session || busy) return;
    const previous = session;
    const request = begin();
    setBusy('refresh');
    setError(null);
    setNotice(null);
    try {
      const profile = await client.me(previous.sessionToken, request.signal);
      if (request.active()) { updateSession({ ...previous, profile }); setNotice('Đã cập nhật thông tin tài khoản đã xác minh.'); }
    } catch (caught) {
      if (!request.active()) return;
      setError(accountLinkMessage(caught));
      if (caught instanceof AccountLinkError && caught.code === 'auth_required') { clearIdentity(); setView('email'); setRelogin(true); }
    } finally { if (request.active()) setBusy(null); }
  }
  async function logout() {
    if (!client || !session || busy) return;
    const token = session.sessionToken;
    const request = begin();
    setBusy('logout');
    setError(null);
    setNotice(null);
    let failed = false;
    try { await client.logout(token, request.signal); }
    catch { failed = true; }
    finally {
      if (request.active()) {
        clearIdentity();
        setView('email');
        setBusy(null);
        setRelogin(true);
        setNotice(failed ? 'Đã xóa phiên trên Mini App này. Chưa xác nhận được việc kết thúc phiên ở máy chủ; phiên sẽ tự hết hạn.' : 'Đã đăng xuất phiên Mini App.');
      }
    }
  }

  const showHandoff = !!handoffCode && view === 'email';
  const handoffBusy = busy === 'check' ? 'Đang kiểm tra tài khoản…' : busy === 'claim' ? 'Đang gửi yêu cầu…' : null;
  const emailDescribedBy = `ma-link-email-hint${error && invalidField === 'email' ? ' ma-link-error' : ''}`;
  const codeDescribedBy = `ma-link-otp-hint${error && invalidField === 'code' ? ' ma-link-error' : ''}`;

  return <section className="ma-account-link" aria-busy={!!busy}>
    <span className="ma-eyebrow">LIÊN KẾT TÀI KHOẢN NHÀ TRƯỜNG</span>
    <h2 id="ma-dialog-title">{view === 'linked' ? 'Tài khoản đã xác minh' : view === 'verify' ? 'Nhập mã xác minh' : 'Kết nối đúng tài khoản của bạn'}</h2>
    {view === 'verify' && otp
      ? <p>Mã 6 số đã gửi tới <strong className="ma-otp-email">{otp.emailMasked}</strong>. Mở hộp thư nhà trường và nhập mã vào ô dưới đây.</p>
      : <p>{view === 'linked' ? 'Tài khoản Zalo này đã được liên kết với tài khoản nhà trường.' : 'Xác minh email nhà trường một lần để sử dụng Suất ăn trên Zalo. Các lần sau Mini App tự đăng nhập.'}</p>}

    {(!client?.configured || setup.error) && <div className="ma-link-config" role="status"><strong>Chưa cấu hình kết nối</strong><p>{setup.error || 'Nhà trường cần cấu hình địa chỉ API trước khi bật liên kết tài khoản.'}</p></div>}
    {error && <div id="ma-link-error" className="ma-link-error" role="alert">{error}</div>}
    {notice && <div className="ma-link-info" role="status">{notice}</div>}

    {showHandoff && <>
      <div className="ma-link-how"><strong>Yêu cầu liên kết từ website</strong><p>Tiếp tục bằng tài khoản Zalo đang dùng, rồi xác nhận trên trang Suất ăn của nhà trường.</p></div>
      <button type="button" className="ma-primary" disabled={!client?.configured || !!busy} onClick={() => { void checkAccount(); }}>{handoffBusy || 'Tiếp tục liên kết'}</button>
    </>}

    {view === 'email' && !showHandoff && <>
      <OtpEmailStep email={email} busy={busy} sendIn={sendIn} configured={!!client?.configured} invalid={invalidField === 'email'}
        describedBy={emailDescribedBy} inputRef={emailInput} onSubmit={() => { void sendOtp(); }}
        onEmail={value => { setEmail(value); if (invalidField === 'email') setInvalidField(null); }} />
      {relogin && <button type="button" className="ma-link-secondary" disabled={!client?.configured || !!busy} onClick={() => { void checkAccount(); }}>{busy === 'check' ? 'Đang kiểm tra tài khoản…' : 'Đăng nhập lại bằng Zalo'}</button>}
      <button type="button" className="ma-link-alt" aria-expanded={manualEntry} aria-controls="ma-website-link" onClick={() => setManualEntry(previous => !previous)}>{manualEntry ? 'Ẩn cách liên kết qua website' : 'Cách khác: liên kết qua website'}</button>
      <div id="ma-website-link" className="ma-link-website" hidden={!manualEntry}>
        <p>Đăng nhập Microsoft trên website Suất ăn rồi chọn Mở trong Zalo, hoặc dán mã liên kết của website vào ô dưới đây.</p>
        {website && <SchoolVerificationWebsite website={website} busy={busy} openWebsite={() => { void openWebsite(); }} copyWebsite={() => { void copyWebsite(); }} />}
        <form onSubmit={event => { event.preventDefault(); void claimCode(); }}>
          <label className="ma-field">Mã liên kết trên website<input className="ma-link-code-input" value={linkCode} onChange={event => setLinkCode(event.target.value)} maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Dán mã liên kết của Thầy/Cô" disabled={!!busy} /></label>
          <button className="ma-link-secondary" disabled={!client?.configured || !linkCode.trim() || !!busy} type="submit">{busy === 'claim' ? 'Đang kiểm tra mã…' : 'Gửi mã liên kết'}</button>
        </form>
      </div>
    </>}

    {view === 'verify' && otp && <OtpCodeStep otp={otp} code={code} busy={busy} resendIn={resendIn} invalid={invalidField === 'code'}
      describedBy={codeDescribedBy} inputRef={codeInput} onCode={changeCode} onSubmit={() => { void verifyCode(code); }}
      onResend={() => { void sendOtp(true); }} onChangeEmail={changeEmail} />}

    {view === 'waiting' && website && <>
      <div className="ma-link-waiting" role="status"><span className="ma-link-pulse" /><strong>{busy === 'finish' ? 'Đang hoàn tất xác minh…' : 'Chờ xác nhận trên website'}</strong><p>Quay lại tab Suất ăn đang mở trong trình duyệt và bấm Xác nhận liên kết tài khoản Zalo này.</p>{claimExpiry && <small>Yêu cầu có hiệu lực đến {timeLabel(claimExpiry)}.</small>}</div>
      {pollPaused && <button className="ma-primary" disabled={!!busy} onClick={retryPoll}>Kiểm tra lại trạng thái</button>}
      {handoffCode
        ? <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={() => { void checkAccount(); }}>Tiếp tục yêu cầu mới</button>
        : <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={emailInstead}>Liên kết bằng email nhà trường</button>}
    </>}

    {view === 'linked' && session && <>
      <div className="ma-linked-profile"><span className="ma-status ma-status-good">Đã xác minh qua hệ thống nhà trường</span><h3>{session.profile.fullName}</h3><dl><div><dt>Mã nhân viên</dt><dd>{session.profile.employeeId || 'Chưa cập nhật'}</dd></div><div><dt>Bộ phận</dt><dd>{session.profile.department || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{session.profile.email || 'Chưa cập nhật'}</dd></div></dl><p>Phiên cá nhân có hiệu lực đến {timeLabel(session.expiresAt)}.</p></div>
      <button className="ma-primary" disabled={!!busy} onClick={() => { void refreshProfile(); }}>{busy === 'refresh' ? 'Đang tải thông tin…' : 'Tải lại thông tin tài khoản'}</button>
      <button className="ma-link-secondary" disabled={!!busy} onClick={() => { void logout(); }}>{busy === 'logout' ? 'Đang đăng xuất…' : 'Đăng xuất phiên Mini App'}</button>
    </>}

    <div className="ma-link-scope-note"><strong>Tài khoản cá nhân</strong><p>Sau khi xác minh, Mini App tải dữ liệu suất ăn của đúng tài khoản nhà trường đã liên kết. Phiên chỉ lưu trong bộ nhớ; lần sau mở Mini App trong Zalo sẽ tự đăng nhập.</p><p>Phiên bản: <strong>{ACCOUNT_LINK_BUILD}</strong></p></div>
  </section>;
}
