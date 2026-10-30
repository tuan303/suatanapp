import { useEffect, useMemo, useRef, useState } from 'react';
import { AccountLinkError, accountLinkMessage, createAccountLinkClient } from '../lib/accountLink';
import type { LinkedSession } from '../lib/accountLink';

type View = 'start' | 'code' | 'waiting' | 'linked';
type Busy = 'check' | 'claim' | 'finish' | 'refresh' | 'logout' | null;
const website = 'https://dkan.nshm.vn/lien-ket-zalo';
const timeLabel = (value: number) => new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', second: '2-digit',
}).format(new Date(value));

export function AccountLinkPanel({
  apiOrigin = import.meta.env.VITE_DKAN_API_ORIGIN,
  development = import.meta.env.DEV,
}: { apiOrigin?: string; development?: boolean }) {
  const setup = useMemo(() => {
    try { return { client: createAccountLinkClient({ origin: apiOrigin, development }), error: null }; }
    catch (error) { return { client: null, error: accountLinkMessage(error) }; }
  }, [apiOrigin, development]);
  const client = setup.client;
  const [view, setView] = useState<View>('start');
  const [busy, setBusy] = useState<Busy>(null);
  const [code, setCode] = useState('');
  const [session, setSession] = useState<LinkedSession | null>(null);
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
    setSession(null);
    setClaimExpiry(null);
    setCode('');
    setPollPaused(false);
  }
  useEffect(() => {
    mounted.current = true;
    clearIdentity();
    setView('start');
    setBusy(null);
    setError(null);
    setNotice(null);
    return () => {
      mounted.current = false;
      invalidate();
      zaloToken.current = '';
      claimToken.current = '';
    };
  }, [client]);

  function expireClaim() {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setView(zaloToken.current ? 'code' : 'start');
    setBusy(null);
    setPollPaused(false);
    setError(accountLinkMessage(new AccountLinkError('expired')));
  }
  useEffect(() => {
    if (!claimExpiry || view !== 'waiting') return;
    const timer = setTimeout(expireClaim, Math.max(0, claimExpiry - Date.now()));
    return () => clearTimeout(timer);
  }, [claimExpiry, view]);
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
    try {
      const token = await client.getZaloToken(request.signal);
      if (!request.active()) return;
      zaloToken.current = token;
      const result = await client.login(token, request.signal);
      if (!request.active()) return;
      if (result.linked) {
        setSession(result);
        zaloToken.current = '';
        setView('linked');
      } else setView('code');
    } catch (caught) {
      if (request.active()) { zaloToken.current = ''; setError(accountLinkMessage(caught)); }
    } finally { if (request.active()) setBusy(null); }
  }

  async function pollClaim(request: ReturnType<typeof begin>, expiresAt: number) {
    if (!client || !request.active()) return;
    if (Date.now() >= expiresAt) { expireClaim(); return; }
    try {
      const result = await client.claimStatus(claimToken.current, request.signal);
      if (!request.active()) return;
      if (result.state === 'expired' || (result.state === 'pending' && result.expiresAt <= Date.now())) { expireClaim(); return; }
      if (result.state === 'approved') {
        setBusy('finish');
        const login = await client.login(zaloToken.current, request.signal);
        if (!request.active()) return;
        if (!login.linked) throw new AccountLinkError('link_not_confirmed');
        setSession(login);
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
      const deadline = Math.min(expiresAt, result.expiresAt);
      setClaimExpiry(deadline);
      pollTimer.current = setTimeout(() => { void pollClaim(request, deadline); }, 3000);
    } catch (caught) {
      if (!request.active()) return;
      setBusy(null);
      setPollPaused(true);
      setError(accountLinkMessage(caught));
      if (caught instanceof AccountLinkError && ['expired', 'challenge_unavailable', 'auth_required'].includes(caught.code)) expireClaim();
    }
  }

  async function claimCode() {
    if (!client?.configured || busy || !zaloToken.current) return;
    const request = begin();
    setBusy('claim');
    setError(null);
    setNotice(null);
    try {
      const result = await client.claim(zaloToken.current, code, request.signal);
      if (!request.active()) return;
      claimToken.current = result.claimToken;
      setClaimExpiry(result.expiresAt);
      setCode('');
      setView('waiting');
      setBusy(null);
      setPollPaused(false);
      void pollClaim(request, result.expiresAt);
    } catch (caught) {
      if (request.active()) setError(accountLinkMessage(caught));
    } finally { if (request.active()) setBusy(null); }
  }
  function retryPoll() {
    if (!claimToken.current || !claimExpiry || busy) return;
    if (Date.now() >= claimExpiry) { expireClaim(); return; }
    const request = begin();
    setPollPaused(false);
    setError(null);
    void pollClaim(request, claimExpiry);
  }
  function newCode() {
    invalidate();
    claimToken.current = '';
    setClaimExpiry(null);
    setCode('');
    setBusy(null);
    setError(null);
    setNotice('Hãy tạo mã mới trên website rồi dán vào đây.');
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
      if (request.active()) { setSession({ ...previous, profile }); setNotice('Đã cập nhật thông tin tài khoản đã xác minh.'); }
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

  return <section className="ma-account-link" aria-busy={!!busy}>
    <span className="ma-eyebrow">LIÊN KẾT TÀI KHOẢN NHÀ TRƯỜNG</span>
    <h2 id="ma-dialog-title">{view === 'linked' ? 'Tài khoản đã xác minh' : 'Kết nối đúng tài khoản của bạn'}</h2>
    <p>Liên kết tài khoản Zalo với tài khoản Microsoft của nhà trường bằng mã dùng một lần và xác nhận trên website.</p>

    {(!client?.configured || setup.error) && <div className="ma-link-config" role="status"><strong>Chưa cấu hình kết nối</strong><p>{setup.error || 'Nhà trường cần cấu hình địa chỉ API trước khi bật liên kết tài khoản.'}</p></div>}
    {error && <div className="ma-link-error" role="alert">{error}</div>}
    {notice && <div className="ma-link-info" role="status">{notice}</div>}

    {view === 'start' && <>
      <div className="ma-link-how"><strong>Trước khi bắt đầu</strong><p>Mở Mini App trong ứng dụng Zalo. Bạn sẽ xác thực tài khoản nhà trường trên website ở bước tiếp theo.</p></div>
      <button className="ma-primary" disabled={!client?.configured || !!busy} onClick={() => { void checkAccount(); }}>{busy === 'check' ? 'Đang kiểm tra tài khoản…' : 'Kiểm tra tài khoản Zalo'}</button>
    </>}

    {view === 'code' && <>
      <ol className="ma-link-steps"><li><span>1</span><div>Mở website bằng trình duyệt:<code className="ma-link-address">{website}</code></div></li><li><span>2</span><div>Đăng nhập tài khoản Microsoft của trường và tạo mã liên kết.</div></li><li><span>3</span><div>Dán mã vào đây, sau đó quay lại website để xác nhận liên kết.</div></li></ol>
      <form onSubmit={event => { event.preventDefault(); void claimCode(); }}>
        <label className="ma-field">Mã liên kết trên website<input className="ma-link-code-input" value={code} onChange={event => setCode(event.target.value)} maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="Dán mã liên kết của bạn" disabled={!!busy} /></label>
        <button className="ma-primary" disabled={!code.trim() || !!busy} type="submit">{busy === 'claim' ? 'Đang kiểm tra mã…' : 'Gửi mã để xác nhận liên kết'}</button>
      </form>
      <button className="ma-link-secondary" disabled={!!busy} onClick={() => { invalidate(); clearIdentity(); setView('start'); setError(null); setNotice(null); }}>Kiểm tra lại tài khoản Zalo</button>
    </>}

    {view === 'waiting' && <>
      <div className="ma-link-waiting" role="status"><span className="ma-link-pulse" /><strong>{busy === 'finish' ? 'Đang hoàn tất xác minh…' : 'Chờ xác nhận trên website'}</strong><p>Quay lại website nhà trường và bấm xác nhận liên kết. Chỉ sau bước đó, Mini App mới được cấp phiên cá nhân.</p>{claimExpiry && <small>Yêu cầu có hiệu lực đến {timeLabel(claimExpiry)}.</small>}</div>
      <code className="ma-link-address">{website}</code>
      {pollPaused && <button className="ma-primary" disabled={!!busy} onClick={retryPoll}>Kiểm tra lại trạng thái</button>}
      <button className="ma-link-secondary" disabled={!!busy} onClick={newCode}>Dùng mã liên kết mới</button>
    </>}

    {view === 'linked' && session && <>
      <div className="ma-linked-profile"><span className="ma-status ma-status-good">Đã xác minh qua hệ thống nhà trường</span><h3>{session.profile.fullName}</h3><dl><div><dt>Mã nhân viên</dt><dd>{session.profile.employeeId || 'Chưa cập nhật'}</dd></div><div><dt>Bộ phận</dt><dd>{session.profile.department || 'Chưa cập nhật'}</dd></div><div><dt>Email</dt><dd>{session.profile.email || 'Chưa cập nhật'}</dd></div></dl><p>Phiên cá nhân có hiệu lực đến {timeLabel(session.expiresAt)}.</p></div>
      <button className="ma-primary" disabled={!!busy} onClick={() => { void refreshProfile(); }}>{busy === 'refresh' ? 'Đang tải thông tin…' : 'Tải lại thông tin tài khoản'}</button>
      <button className="ma-link-secondary" disabled={!!busy} onClick={() => { void logout(); }}>{busy === 'logout' ? 'Đang đăng xuất…' : 'Đăng xuất phiên Mini App'}</button>
    </>}

    <div className="ma-link-scope-note"><strong>Phạm vi bản phát triển</strong><p>Khung này chỉ xác minh liên kết tài khoản. Các tab đăng ký, hủy ăn, thực đơn và khảo sát bên ngoài vẫn dùng dữ liệu minh họa, chưa gửi thao tác nghiệp vụ thật.</p></div>
  </section>;
}
