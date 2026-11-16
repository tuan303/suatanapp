import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountLinkError, accountLinkMessage, classifyZaloSdkEnvironment, createAccountLinkClient } from '../lib/accountLink';
import type { LinkedSession } from '../lib/accountLink';
import { ACCOUNT_LINK_BUILD } from '../lib/appVersion';

type View = 'start' | 'code' | 'waiting' | 'linked';
type Busy = 'check' | 'claim' | 'finish' | 'refresh' | 'logout' | 'website' | null;
const timeLabel = (value: number) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(value));

export function SchoolVerificationWebsite({ website, busy, openWebsite, copyWebsite }: {
  website: string; busy: Busy; openWebsite: () => void; copyWebsite: () => void;
}) {
  return <>
    <div className="ma-link-how">
      <strong>Xác minh tài khoản nhà trường</strong>
      <p>Đăng nhập Microsoft trên website rồi tiếp tục liên kết.</p>
    </div>
    {classifyZaloSdkEnvironment() === 'miniapp'
      ? <button type="button" className="ma-primary" disabled={!!busy} onClick={openWebsite}>{busy === 'website' ? 'Đang mở trang xác minh…' : 'Mở trang xác minh Microsoft'}</button>
      : <a className="ma-primary ma-link-action" href={website} target="_blank" rel="noopener noreferrer">Mở trang xác minh Microsoft</a>}
    <div className="ma-link-how">
      <strong>Mở bằng Chrome hoặc Safari</strong>
      <p>Nếu trang không mở hoặc Microsoft không đăng nhập được, mở trình duyệt điện thoại và dán địa chỉ này.</p>
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
  const [view, setView] = useState<View>(() => initialSession && initialSession.expiresAt > Date.now() ? 'linked' : 'start');
  const [busy, setBusy] = useState<Busy>(null);
  const [code, setCode] = useState('');
  const [manualEntry, setManualEntry] = useState(false);
  const [session, setSession] = useState<LinkedSession | null>(() => initialSession && initialSession.expiresAt > Date.now() ? initialSession : null);
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
  const sessionListener = useRef(onSessionChange);
  sessionListener.current = onSessionChange;

  function updateSession(value: LinkedSession | null) {
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
  function begin() {
    invalidate();
    const requestController = new AbortController();
    controller.current = requestController;
    const ticket = generation.current;
    return { signal: requestController.signal, active: () => mounted.current && generation.current === ticket && !requestController.signal.aborted };
  }
  function clearIdentity() {
    zaloToken.current = '';
    claimToken.current = '';
    updateSession(null);
    setClaimExpiry(null);
    setCode('');
    setPollPaused(false);
  }
  useEffect(() => {
    mounted.current = true;
    zaloToken.current = ''; claimToken.current = ''; setClaimExpiry(null); setCode(''); setPollPaused(false);
    const restored = initialSession && initialSession.expiresAt > Date.now() ? initialSession : null;
    setSession(restored);
    setView(restored ? 'linked' : 'start');
    setBusy(null);
    setError(null);
    setNotice(null);
    return () => {
      mounted.current = false;
      invalidate();
      zaloToken.current = '';
      claimToken.current = '';
    };
  }, [client, initialSession?.sessionToken]);

  function endClaim(error: AccountLinkError) {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setView(zaloToken.current ? 'code' : 'start');
    setBusy(null);
    setPollPaused(false);
    setError(accountLinkMessage(error));
  }
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      invalidate();
      clearIdentity();
      setView('start');
      setBusy(null);
      setError('Phiên cá nhân đã hết hạn. Vui lòng kiểm tra tài khoản Zalo lại.');
    }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session]);

  async function checkAccount() {
    if (!client?.configured || busy) return;
    const request = begin();
    clearIdentity();
    setView('start');
    setBusy('check');
    setError(null);
    setNotice(null);
    let sendingHandoff = false;
    try {
      const token = await client.getZaloToken(request.signal);
      if (!request.active()) return;
      zaloToken.current = token;
      const result = await client.login(token, request.signal);
      if (!request.active()) return;
      if (result.linked) {
        if (handoffCode) onHandoffConsumed?.(handoffCode);
        updateSession(result);
        zaloToken.current = '';
        setView('linked');
      } else if (handoffCode) {
        sendingHandoff = true;
        setBusy('claim');
        await sendClaim(request, handoffCode);
        if (request.active()) onHandoffConsumed?.(handoffCode);
      } else setView('code');
    } catch (caught) {
      if (!request.active()) return;
      if (sendingHandoff && handoffCode && caught instanceof AccountLinkError
        && ['challenge_unavailable', 'expired', 'link_conflict'].includes(caught.code)) {
        onHandoffConsumed?.(handoffCode);
        setView('code');
      } else {
        zaloToken.current = '';
      }
      setError(accountLinkMessage(caught));
    } finally { if (request.active()) setBusy(null); }
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

  async function pollClaim(request: ReturnType<typeof begin>) {
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
        updateSession(login);
        zaloToken.current = '';
        claimToken.current = '';
        setClaimExpiry(null);
        setView('linked');
        setBusy(null);
        setPollPaused(false);
        setError(null);
        return;
      }
      setPollPaused(false);
      setError(null);
      setClaimExpiry(result.expiresAt);
      pollTimer.current = setTimeout(() => { void pollClaim(request); }, 3000);
    } catch (caught) {
      if (!request.active()) return;
      const code = caught instanceof AccountLinkError ? caught.code : null;
      if (websiteConfirmed || code === 'auth_required') {
        invalidate();
        clearIdentity();
        setView('start');
        setBusy(null);
        if (websiteConfirmed) setNotice('Website đã xác nhận liên kết. Bấm Kiểm tra tài khoản Zalo để mở dữ liệu cá nhân.');
        setError(accountLinkMessage(caught));
        return;
      }
      if (caught instanceof AccountLinkError && (code === 'expired' || code === 'challenge_unavailable')) {
        endClaim(caught);
        return;
      }
      setBusy(null);
      setPollPaused(true);
      setError(accountLinkMessage(caught));
    }
  }

  async function sendClaim(request: ReturnType<typeof begin>, value: string) {
    if (!client) return;
    const result = await client.claim(zaloToken.current, value, request.signal);
    if (!request.active()) return;
    claimToken.current = result.claimToken;
    setClaimExpiry(result.expiresAt);
    setCode('');
    setView('waiting');
    setBusy(null);
    setPollPaused(false);
    void pollClaim(request);
  }

  async function claimCode() {
    if (!client?.configured || busy || !zaloToken.current) return;
    const request = begin();
    setBusy('claim');
    setError(null);
    setNotice(null);
    try {
      await sendClaim(request, code);
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
  function newCode() {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setCode('');
    setBusy(null);
    setError(null);
    setNotice('Hãy tạo yêu cầu mới trên website, rồi bấm Mở trong Zalo.');
    setView(zaloToken.current ? 'code' : 'start');
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
      if (caught instanceof AccountLinkError && caught.code === 'auth_required') { clearIdentity(); setView('start'); }
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
        setView('start');
        setBusy(null);
        setNotice(failed ? 'Đã xóa phiên trên Mini App này. Chưa xác nhận được việc kết thúc phiên ở máy chủ; phiên sẽ tự hết hạn.' : 'Đã đăng xuất phiên Mini App.');
      }
    }
  }

  const canContinueHandoff = !!handoffCode && (view === 'start' || view === 'code');
  const accountButtonBusy = busy === 'check' ? 'Đang kiểm tra tài khoản…' : busy === 'claim' ? 'Đang gửi yêu cầu…' : null;

  return <section className="ma-account-link" aria-busy={!!busy}>
    <span className="ma-eyebrow">LIÊN KẾT TÀI KHOẢN NHÀ TRƯỜNG</span>
    <h2 id="ma-dialog-title">{view === 'linked' ? 'Tài khoản đã xác minh' : 'Kết nối đúng tài khoản của bạn'}</h2>
    <p>{view === 'linked' ? 'Tài khoản Zalo này đã được liên kết với tài khoản nhà trường.' : 'Xác minh tài khoản Microsoft của nhà trường một lần để sử dụng Suất ăn trên Zalo.'}</p>

    {(!client?.configured || setup.error) && <div className="ma-link-config" role="status"><strong>Chưa cấu hình kết nối</strong><p>{setup.error || 'Nhà trường cần cấu hình địa chỉ API trước khi bật liên kết tài khoản.'}</p></div>}
    {error && <div className="ma-link-error" role="alert">{error}</div>}
    {notice && <div className="ma-link-info" role="status">{notice}</div>}

    {(view === 'start' || canContinueHandoff) && <>
      {canContinueHandoff
        ? <div className="ma-link-how"><strong>Yêu cầu liên kết từ website</strong><p>Tiếp tục bằng tài khoản Zalo đang dùng, rồi xác nhận trên trang Suất ăn của nhà trường.</p></div>
        : <div className="ma-link-how"><strong>Kiểm tra tài khoản Zalo</strong><p>Nếu tài khoản đã liên kết, bạn có thể mở dữ liệu suất ăn ngay.</p></div>}
      <button type="button" className="ma-primary" disabled={!client?.configured || !!busy} onClick={() => { void checkAccount(); }}>{accountButtonBusy || (canContinueHandoff ? 'Tiếp tục liên kết' : 'Kiểm tra tài khoản Zalo')}</button>
    </>}

    {view === 'code' && !canContinueHandoff && website && <>
      <SchoolVerificationWebsite website={website} busy={busy} openWebsite={() => { void openWebsite(); }} copyWebsite={() => { void copyWebsite(); }} />
      <button type="button" className="ma-link-secondary" aria-expanded={manualEntry} aria-controls="ma-manual-link" onClick={() => setManualEntry(previous => !previous)}>{manualEntry ? 'Ẩn phần nhập mã' : 'Nhập mã thủ công'}</button>
      <div id="ma-manual-link" hidden={!manualEntry}>
        <form onSubmit={event => { event.preventDefault(); void claimCode(); }}>
          <label className="ma-field">Mã liên kết trên website<input className="ma-link-code-input" value={code} onChange={event => setCode(event.target.value)} maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Dán mã liên kết của bạn" disabled={!!busy} /></label>
          <button className="ma-primary" disabled={!code.trim() || !!busy} type="submit">{busy === 'claim' ? 'Đang kiểm tra mã…' : 'Gửi mã để xác nhận liên kết'}</button>
        </form>
      </div>
      <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={() => { void checkAccount(); }}>Kiểm tra lại tài khoản Zalo</button>
    </>}

    {view === 'waiting' && website && <>
      <div className="ma-link-waiting" role="status"><span className="ma-link-pulse" /><strong>{busy === 'finish' ? 'Đang hoàn tất xác minh…' : 'Chờ xác nhận trên website'}</strong><p>Quay lại tab Suất ăn đang mở trong trình duyệt và bấm Xác nhận liên kết tài khoản Zalo này.</p>{claimExpiry && <small>Yêu cầu có hiệu lực đến {timeLabel(claimExpiry)}.</small>}</div>
      {pollPaused && <button className="ma-primary" disabled={!!busy} onClick={retryPoll}>Kiểm tra lại trạng thái</button>}
      {handoffCode
        ? <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={() => { void checkAccount(); }}>Tiếp tục yêu cầu mới</button>
        : <button type="button" className="ma-link-secondary" disabled={!!busy} onClick={newCode}>Tạo yêu cầu khác</button>}
    </>}

    {view === 'linked' && session && <>
      <div className="ma-linked-profile"><span className="ma-status ma-status-good">Đã xác minh qua hệ thống nhà trường</span><h3>{session.profile.fullName}</h3><dl><div><dt>Mã nhân viên</dt><dd>{session.profile.employeeId || 'Chưa cập nhật'}</dd></div><div><dt>Bộ phận</dt><dd>{session.profile.department || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{session.profile.email || 'Chưa cập nhật'}</dd></div></dl><p>Phiên cá nhân có hiệu lực đến {timeLabel(session.expiresAt)}.</p></div>
      <button className="ma-primary" disabled={!!busy} onClick={() => { void refreshProfile(); }}>{busy === 'refresh' ? 'Đang tải thông tin…' : 'Tải lại thông tin tài khoản'}</button>
      <button className="ma-link-secondary" disabled={!!busy} onClick={() => { void logout(); }}>{busy === 'logout' ? 'Đang đăng xuất…' : 'Đăng xuất phiên Mini App'}</button>
    </>}

    <div className="ma-link-scope-note"><strong>Tài khoản cá nhân</strong><p>Sau khi xác minh, Mini App tải dữ liệu suất ăn của đúng tài khoản nhà trường đã liên kết. Phiên chỉ lưu trong bộ nhớ; đóng ứng dụng cần kiểm tra tài khoản Zalo lại.</p><p>Phiên bản: <strong>{ACCOUNT_LINK_BUILD}</strong></p></div>
  </section>;
}
