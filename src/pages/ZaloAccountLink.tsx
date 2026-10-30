import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getIdToken, onAuthStateChanged, reauthenticateWithPopup, type User } from 'firebase/auth';
import { auth, microsoftProvider } from '../lib/firebase';
import { Header } from '../components/Header';
import { Navigation } from '../components/Navigation';
import { Footer } from '../components/Footer';

type WebAction = 'web.getLink' | 'web.createChallenge' | 'web.challengeStatus' | 'web.confirmLink' | 'web.revokeLink';
type LinkState = { linked: boolean; zaloUserIdSuffix?: string; linkedAt?: number };
type Challenge = { challengeId: string; code: string; expiresAt: number; state: 'waiting' | 'pending' | 'expired'; zaloUserIdSuffix?: string };
type BusyAction = 'loading' | 'creating' | 'confirming' | 'revoking' | null;
const SCHOOL_DOMAIN = '@hoangmaistarschool.edu.vn';
const LOGIN_URL = '/login?next=%2Flien-ket-zalo';

export function isSchoolMicrosoftUser(user: Pick<User, 'email' | 'providerData'> | null) {
  return !!user?.email?.trim().toLowerCase().endsWith(SCHOOL_DOMAIN)
    && user.providerData.some(provider => provider.providerId === 'microsoft.com');
}

export function zaloLinkErrorMessage(code: string | undefined, status?: number) {
  if (code === 'not_configured') return 'Chức năng liên kết chưa được bật trên máy chủ.';
  if (status === 503 || code === 'service_unavailable') return 'Máy chủ chưa xử lý được yêu cầu liên kết. Vui lòng thử lại hoặc liên hệ bộ phận CNTT kiểm tra kết nối.';
  if (code === 'recent_login_required' || code === 'recent_auth_required') return 'Vui lòng xác minh lại tài khoản Microsoft trước khi thực hiện thao tác.';
  if (status === 401 || code === 'auth_required') return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại bằng tài khoản Microsoft của trường.';
  if (status === 403 || code === 'forbidden') return 'Tài khoản này chưa được phép liên kết Zalo. Vui lòng sử dụng tài khoản Microsoft của nhà trường đã được cấp quyền.';
  if (code === 'challenge_unavailable' || code === 'challenge_expired') return 'Mã liên kết đã hết hạn hoặc không còn sử dụng được. Vui lòng tạo mã mới.';
  if (status === 409 || code === 'link_conflict') return 'Tài khoản đang có liên kết khác. Vui lòng kiểm tra liên kết hiện tại trước khi thử lại.';
  if (status === 429 || code === 'rate_limited') return 'Bạn vừa thực hiện nhiều yêu cầu. Vui lòng chờ một lát rồi thử lại.';
  if (code === 'auth/popup-blocked') return 'Trình duyệt đang chặn cửa sổ Microsoft. Vui lòng cho phép cửa sổ đăng nhập rồi thử lại.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Chưa hoàn tất xác minh Microsoft. Bạn có thể bấm lại khi sẵn sàng.';
  if (code === 'auth/user-mismatch') return 'Tài khoản Microsoft vừa chọn không khớp tài khoản đang đăng nhập.';
  return 'Chưa thực hiện được yêu cầu. Vui lòng kiểm tra kết nối mạng và thử lại.';
}

class ZaloLinkRequestError extends Error {
  constructor(readonly code: string, readonly status?: number) { super(zaloLinkErrorMessage(code, status)); }
}

const aborted = () => Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
const suffix = (value: unknown) => typeof value === 'string' && /^\d{1,4}$/.test(value) ? value : undefined;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** All requests are same-origin and bound to the current authenticated session. */
export async function requestZaloLinkAction(action: WebAction, challengeId: string | undefined, options: {
  signal: AbortSignal; getToken: () => Promise<string>; stillCurrent: () => boolean; fetcher?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const needsChallenge = action === 'web.challengeStatus' || action === 'web.confirmLink';
  if (needsChallenge && !/^[a-f0-9]{64}$/.test(challengeId || '')) throw new ZaloLinkRequestError('challenge_unavailable');
  if (options.signal.aborted || !options.stillCurrent()) throw aborted();
  const token = await options.getToken();
  if (options.signal.aborted || !options.stillCurrent()) throw aborted();
  if (typeof token !== 'string' || !token) throw new ZaloLinkRequestError('auth_required', 401);
  const response = await (options.fetcher || fetch)('/api/zalo', {
    method: 'POST', credentials: 'omit', cache: 'no-store', signal: options.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(needsChallenge ? { action, challengeId } : { action }),
  });
  if (options.signal.aborted || !options.stillCurrent()) throw aborted();
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (options.signal.aborted || !options.stillCurrent()) throw aborted();
  if (!response.ok) {
    const code = object(body) && object(body.error) && typeof body.error.code === 'string' ? body.error.code : 'request_failed';
    throw new ZaloLinkRequestError(code, response.status);
  }
  if (!object(body)) throw new ZaloLinkRequestError('invalid_response', 502);
  return body;
}

export interface ZaloAccountLinkViewProps {
  authLoading: boolean; user: Pick<User, 'email' | 'displayName' | 'providerData'> | null;
  link: LinkState | null; challenge: Challenge | null; now: number; busy: BusyAction;
  error: string | null; notice: string | null; revokeConfirm: boolean;
  onReload: () => void; onCreate: () => void; onConfirm: () => void; onCopy: () => void;
  onRevokeRequest: () => void; onRevokeCancel: () => void; onRevoke: () => void;
}

export function ZaloAccountLinkView(props: ZaloAccountLinkViewProps) {
  const { authLoading, user, link, challenge, now, busy, error, notice, revokeConfirm } = props;
  const eligible = isSchoolMicrosoftUser(user as Pick<User, 'email' | 'providerData'> | null);
  const remaining = challenge ? Math.max(0, Math.ceil((challenge.expiresAt - now) / 1000)) : 0;
  const expired = !!challenge && (challenge.state === 'expired' || remaining === 0);
  const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  return <main className="flex-1 min-w-0 w-full max-w-[1080px] mx-auto px-4 py-6 sm:px-6 lg:p-8">
    <Link to="/dashboard" className="inline-flex min-h-11 items-center gap-1 text-sm text-primary hover:underline"><span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_back</span>Về tổng quan</Link>
    <div className="mt-3 mb-6 min-w-0"><p className="text-sm text-on-surface-variant">Tài khoản / Zalo Mini App</p><h1 className="mt-2 text-headline-md md:text-headline-lg text-on-surface">Liên kết tài khoản Zalo</h1><p className="mt-2 max-w-[680px] text-body-md text-on-surface-variant">Dùng Zalo Mini App để đăng ký suất ăn và xem dữ liệu cá nhân từ tài khoản nhà trường của Thầy/Cô.</p></div>
    <section aria-labelledby="zalo-link-heading" aria-busy={!!busy || authLoading} className="min-w-0 rounded-2xl border border-outline-variant bg-surface-container-lowest p-4 shadow-xs sm:p-6">
      <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-container text-primary" aria-hidden="true"><span className="material-symbols-outlined">link</span></span><div className="min-w-0"><h2 id="zalo-link-heading" className="text-title-md text-on-surface">Tài khoản nhà trường</h2><p className="mt-1 break-all text-sm text-on-surface-variant">{user?.email || 'Đăng nhập để tiếp tục'}</p></div></div>
      {authLoading ? <p role="status" className="mt-5 text-sm text-on-surface-variant">Đang kiểm tra phiên đăng nhập…</p>
        : !user ? <div className="mt-5"><p className="text-sm text-on-surface-variant">Thầy/Cô cần đăng nhập bằng tài khoản Microsoft của trường trước khi liên kết.</p><Link to={LOGIN_URL} className={`${button} mt-4 bg-primary text-on-primary hover:bg-primary-dark`}>Đăng nhập Microsoft</Link></div>
          : !eligible ? <p role="alert" className="mt-5 rounded-xl bg-warning-container p-4 text-sm text-on-warning-container">Tài khoản này chưa xác thực qua Microsoft của nhà trường. Vui lòng <Link to={LOGIN_URL} className="font-semibold underline">đăng nhập bằng tài khoản trường</Link> để tiếp tục.</p>
            : <>
              {error && <p role="alert" className="mt-5 rounded-xl border border-error/20 bg-error-container p-4 text-sm text-on-error-container">{error}</p>}
              {notice && <p role="status" className="mt-5 rounded-xl bg-tertiary-container p-4 text-sm text-on-tertiary-container">{notice}</p>}
              {busy === 'loading' && !link ? <p role="status" className="mt-5 text-sm text-on-surface-variant">Đang tải trạng thái liên kết…</p> : null}
              {link?.linked ? <div className="mt-5">
                <div className="rounded-xl border border-tertiary/20 bg-tertiary-container/50 p-4"><p className="flex items-center gap-2 font-semibold text-on-tertiary-container"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">check_circle</span>Đã liên kết Zalo</p><p className="mt-2 text-sm text-on-surface-variant">{link.zaloUserIdSuffix ? `Tài khoản Zalo có mã kết thúc bằng ••••${link.zaloUserIdSuffix}.` : 'Tài khoản Zalo đã được xác minh.'}</p>{link.linkedAt ? <p className="mt-1 text-sm text-on-surface-variant">Liên kết lúc {new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'short' }).format(link.linkedAt)}.</p> : null}</div>
                {revokeConfirm ? <div className="mt-4 rounded-xl border border-error/25 p-4"><p className="text-sm text-on-surface">Sau khi hủy, tài khoản Zalo này cần liên kết lại để sử dụng dữ liệu suất ăn của Thầy/Cô.</p><div className="mt-3 flex flex-col gap-2 sm:flex-row"><button type="button" disabled={!!busy} onClick={props.onRevoke} className={`${button} bg-error text-on-error`}>{busy === 'revoking' ? 'Đang xác minh và hủy…' : 'Xác nhận hủy liên kết'}</button><button type="button" disabled={!!busy} onClick={props.onRevokeCancel} className={`${button} border border-outline-variant text-on-surface`}>Giữ liên kết</button></div></div>
                  : <button type="button" disabled={!!busy} onClick={props.onRevokeRequest} className={`${button} mt-4 border border-error/25 text-error hover:bg-error-container`}>Hủy liên kết Zalo</button>}
              </div> : null}
              {link && !link.linked && !challenge ? <div className="mt-5"><p className="text-sm text-on-surface-variant">Chưa liên kết Zalo. Tạo mã, nhập mã trong Mini App rồi quay lại trang này để xác nhận.</p><button type="button" disabled={!!busy} onClick={props.onCreate} className={`${button} mt-4 bg-primary text-on-primary hover:bg-primary-dark`}>{busy === 'creating' ? 'Đang xác minh Microsoft…' : 'Xác minh Microsoft và tạo mã'}</button></div> : null}
              {!link && !busy ? <button type="button" onClick={props.onReload} className={`${button} mt-4 border border-outline-variant text-primary`}>Tải lại trạng thái</button> : null}
              {challenge && !link?.linked ? <div className="mt-5 space-y-4">
                <div className={`rounded-xl border p-4 ${expired ? 'border-outline-variant bg-surface-container-low' : 'border-primary/20 bg-primary-container/40'}`}>
                  <p className="text-sm font-semibold text-on-surface">{expired ? 'Mã liên kết đã hết hạn' : 'Mã liên kết của Thầy/Cô'}</p>
                  {!expired ? <><code aria-label="Mã liên kết Zalo" className="mt-3 block select-all break-all rounded-lg bg-surface-container-lowest p-3 font-mono text-xl leading-relaxed text-primary">{challenge.code}</code><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><p role="timer" aria-label="Thời gian còn lại của mã" className="text-sm text-on-surface-variant">Còn {Math.floor(remaining / 60)} phút {String(remaining % 60).padStart(2, '0')} giây</p><button type="button" disabled={!!busy} onClick={props.onCopy} className={`${button} border border-primary/20 bg-surface-container-lowest text-primary`}><span className="material-symbols-outlined text-[18px]" aria-hidden="true">content_copy</span>Sao chép mã</button></div></>
                    : <p className="mt-2 text-sm text-on-surface-variant">Tạo mã mới để tiếp tục liên kết tài khoản.</p>}
                </div>
                {!expired && challenge.state === 'waiting' ? <div><ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-on-surface-variant"><li>Mở Mini App <strong className="text-on-surface">Suất ăn Ngôi Sao Hoàng Mai</strong> bằng tài khoản Zalo của Thầy/Cô.</li><li>Vào phần liên kết tài khoản, dán mã vừa sao chép và gửi yêu cầu.</li><li>Quay lại trang này để xác nhận đúng tài khoản Zalo trên điện thoại của mình.</li></ol><p role="status" className="mt-4 rounded-lg bg-surface-container p-3 text-sm text-on-surface-variant">Đang chờ yêu cầu từ Zalo Mini App…</p></div> : null}
                {!expired && challenge.state === 'pending' ? <div className="rounded-xl border border-primary/20 p-4"><p className="font-semibold text-on-surface">Có yêu cầu liên kết từ Zalo</p><p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{challenge.zaloUserIdSuffix ? `Mã tài khoản kết thúc bằng ••••${challenge.zaloUserIdSuffix}. ` : ''}Chỉ xác nhận khi Thầy/Cô vừa nhập mã trên điện thoại bằng tài khoản Zalo của mình.</p><button type="button" disabled={!!busy} onClick={props.onConfirm} className={`${button} mt-4 w-full bg-primary text-on-primary hover:bg-primary-dark sm:w-auto`}>{busy === 'confirming' ? 'Đang xác nhận…' : 'Xác nhận liên kết tài khoản Zalo này'}</button></div> : null}
                {expired ? <button type="button" disabled={!!busy} onClick={props.onCreate} className={`${button} bg-primary text-on-primary`}>{busy === 'creating' ? 'Đang xác minh Microsoft…' : 'Xác minh Microsoft và tạo mã mới'}</button> : null}
                {error && !expired ? <button type="button" disabled={!!busy} onClick={props.onReload} className={`${button} border border-outline-variant text-primary`}>Kiểm tra lại trạng thái</button> : null}
              </div> : null}
            </>}
    </section>
    <p className="mt-4 max-w-[760px] text-sm leading-relaxed text-on-surface-variant">Liên kết chỉ cho phép tài khoản Zalo truy cập các chức năng suất ăn cá nhân đã được cấp quyền. Thao tác tạo mã và hủy liên kết yêu cầu xác minh lại qua Microsoft.</p>
  </main>;
}

export default function ZaloAccountLink() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [link, setLink] = useState<LinkState | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revokeConfirm, setRevokeConfirm] = useState(false);
  const [pollPaused, setPollPaused] = useState(false);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(false), generation = useRef(0), userRef = useRef<User | null>(null), busyRef = useRef<BusyAction>(null);
  const controllers = useRef(new Set<AbortController>());
  const current = (ticket: number, uid: string) => mounted.current && generation.current === ticket && userRef.current?.uid === uid && auth.currentUser?.uid === uid;
  const invalidate = () => { generation.current++; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  const api = async (action: WebAction, uid: string, ticket: number, challengeId?: string, forceToken = false, controller = new AbortController()) => {
    controllers.current.add(controller);
    try { return await requestZaloLinkAction(action, challengeId, { signal: controller.signal, stillCurrent: () => current(ticket, uid), getToken: () => {
      const owner = userRef.current;
      if (!owner || owner.uid !== uid) throw aborted();
      return getIdToken(owner, forceToken);
    } }); } finally { controllers.current.delete(controller); }
  };
  const readLink = async (uid: string, ticket: number) => {
    const result = await api('web.getLink', uid, ticket);
    if (!current(ticket, uid)) throw aborted();
    if (typeof result.linked !== 'boolean') throw new ZaloLinkRequestError('invalid_response', 502);
    const state = { linked: result.linked, zaloUserIdSuffix: suffix(result.zaloUserIdSuffix), linkedAt: typeof result.linkedAt === 'number' && Number.isFinite(result.linkedAt) && result.linkedAt > 0 ? result.linkedAt : undefined };
    setLink(state);
    if (state.linked) setChallenge(null);
    return state;
  };
  const showFailure = (failure: unknown) => {
    if ((failure as { name?: string })?.name === 'AbortError') return;
    setError(failure instanceof ZaloLinkRequestError ? failure.message : zaloLinkErrorMessage((failure as { code?: string })?.code));
  };

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = onAuthStateChanged(auth, next => {
      const changed = userRef.current?.uid !== next?.uid;
      userRef.current = next; setUser(next); setAuthLoading(false);
      if (changed || !next) { invalidate(); busyRef.current = null; setLink(null); setChallenge(null); setBusy(null); setError(null); setNotice(null); setRevokeConfirm(false); setPollPaused(false); }
    });
    return () => { mounted.current = false; invalidate(); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!user || !isSchoolMicrosoftUser(user)) return;
    const uid = user.uid, ticket = generation.current;
    busyRef.current = 'loading'; setBusy('loading'); setError(null);
    void readLink(uid, ticket).catch(failure => { if (current(ticket, uid)) showFailure(failure); })
      .finally(() => { if (current(ticket, uid)) { busyRef.current = null; setBusy(null); } });
  }, [user?.uid]);

  useEffect(() => {
    if (!challenge || challenge.state === 'expired') return;
    const id = challenge.challengeId;
    const updateClock = () => {
      const time = Date.now(); setNow(time);
      if (time >= challenge.expiresAt) setChallenge(previous => previous?.challengeId === id ? { ...previous, state: 'expired' } : previous);
    };
    updateClock(); const timer = window.setInterval(updateClock, 1000);
    return () => window.clearInterval(timer);
  }, [challenge?.challengeId, challenge?.expiresAt, challenge?.state === 'expired']);

  useEffect(() => {
    if (!user || !challenge || challenge.state === 'expired' || busy || pollPaused) return;
    const uid = user.uid, id = challenge.challengeId, ticket = generation.current;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const poll = async () => {
      if (stopped || !current(ticket, uid) || Date.now() >= challenge.expiresAt) return;
      try {
        const result = await api('web.challengeStatus', uid, ticket, id, false, controller);
        if (stopped || !current(ticket, uid)) return;
        if (result.state === 'approved') {
          const state = await readLink(uid, ticket);
          if (stopped || !current(ticket, uid)) return;
          if (!state.linked) throw new ZaloLinkRequestError('invalid_response', 502);
          setNotice('Đã liên kết tài khoản Zalo thành công.'); return;
        }
        if (!['waiting', 'pending', 'expired'].includes(String(result.state)) || typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt)) throw new ZaloLinkRequestError('invalid_response', 502);
        setChallenge(previous => previous?.challengeId === id ? { ...previous, state: result.state as Challenge['state'], expiresAt: result.expiresAt as number, zaloUserIdSuffix: suffix(result.zaloUserIdSuffix) } : previous);
        if (result.state !== 'expired') timer = setTimeout(poll, 2500);
      } catch (failure) {
        if (!stopped && current(ticket, uid) && (failure as { name?: string })?.name !== 'AbortError') { showFailure(failure); setPollPaused(true); }
      }
    };
    timer = setTimeout(poll, 1500);
    return () => { stopped = true; if (timer) clearTimeout(timer); controller.abort(); };
  }, [user?.uid, challenge?.challengeId, challenge?.state === 'expired', busy, pollPaused]);

  const perform = async (action: Exclude<BusyAction, null>, work: (uid: string, ticket: number) => Promise<void>) => {
    const owner = userRef.current;
    if (!owner || !isSchoolMicrosoftUser(owner) || busyRef.current) return;
    invalidate(); const uid = owner.uid, ticket = generation.current;
    busyRef.current = action; setBusy(action); setError(null); setNotice(null); setPollPaused(true);
    try { await work(uid, ticket); } catch (failure) { if (current(ticket, uid)) showFailure(failure); }
    finally { if (current(ticket, uid)) { busyRef.current = null; setBusy(null); setPollPaused(false); } }
  };
  const reverify = async (uid: string, ticket: number) => {
    const owner = userRef.current;
    if (!owner || owner.uid !== uid) throw aborted();
    await reauthenticateWithPopup(owner, microsoftProvider);
    if (!current(ticket, uid)) throw aborted();
  };
  const create = () => void perform('creating', async (uid, ticket) => {
    await reverify(uid, ticket);
    const result = await api('web.createChallenge', uid, ticket, undefined, true);
    if (typeof result.challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(result.challengeId) || typeof result.code !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(result.code)
      || typeof result.expiresAt !== 'number' || !Number.isFinite(result.expiresAt) || result.expiresAt <= Date.now()) throw new ZaloLinkRequestError('invalid_response', 502);
    setNow(Date.now()); setChallenge({ challengeId: result.challengeId, code: result.code, expiresAt: result.expiresAt, state: 'waiting' });
  });
  const confirm = () => {
    if (!challenge || challenge.state !== 'pending' || challenge.expiresAt <= Date.now()) return;
    const id = challenge.challengeId;
    void perform('confirming', async (uid, ticket) => {
      await api('web.confirmLink', uid, ticket, id);
      const state = await readLink(uid, ticket);
      if (!state.linked) throw new ZaloLinkRequestError('invalid_response', 502);
      setChallenge(null); setNotice('Đã liên kết tài khoản Zalo thành công.');
    });
  };
  const revoke = () => void perform('revoking', async (uid, ticket) => {
    await reverify(uid, ticket);
    const result = await api('web.revokeLink', uid, ticket, undefined, true);
    if (result.revoked !== true) throw new ZaloLinkRequestError('invalid_response', 502);
    const state = await readLink(uid, ticket);
    if (state.linked) throw new ZaloLinkRequestError('invalid_response', 502);
    setChallenge(null); setRevokeConfirm(false); setNotice('Đã hủy liên kết Zalo của tài khoản này.');
  });
  const copy = async () => {
    if (!challenge || challenge.state === 'expired' || challenge.expiresAt <= Date.now()) return;
    const uid = userRef.current?.uid, ticket = generation.current, text = challenge.code;
    try { await navigator.clipboard.writeText(text); if (uid && current(ticket, uid)) setNotice('Đã sao chép mã. Mở Mini App và dán vào phần liên kết tài khoản.'); }
    catch { if (uid && current(ticket, uid)) setError('Chưa sao chép được tự động. Thầy/Cô có thể bôi chọn và sao chép mã đang hiển thị.'); }
  };

  return <div className="mobile-app-shell min-w-0 flex flex-col md:pl-64"><Header /><Navigation />
    <ZaloAccountLinkView authLoading={authLoading} user={user} link={link} challenge={challenge} now={now} busy={busy} error={error} notice={notice} revokeConfirm={revokeConfirm}
      onReload={() => void perform('loading', async (uid, ticket) => { await readLink(uid, ticket); })} onCreate={create} onConfirm={confirm} onCopy={copy}
      onRevokeRequest={() => setRevokeConfirm(true)} onRevokeCancel={() => setRevokeConfirm(false)} onRevoke={revoke} />
    <Footer /></div>;
}
