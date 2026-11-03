import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import schoolLogo from './assets/school-logo.png';
import { AccountLinkPanel } from './components/AccountLinkPanel';
import { AccountLinkError, accountLinkMessage, createAccountLinkClient, type LinkedSession } from './lib/accountLink';
import { businessReason, createMealBusinessClient, mealLabels, validDate, type DayView, type MealSnapshot } from './lib/business';
import { ACCOUNT_LINK_BUILD } from './lib/appVersion';

type Tab = 'home' | 'register' | 'menu' | 'personal';
type Modal = 'link' | 'survey' | 'event' | 'confirm' | null;
type Pending = { kind: 'register'; month: string; breakfast: boolean; lunch: boolean }
  | { kind: 'cancel'; date: string; meal: 'breakfast' | 'lunch' | 'both'; reason: string; canteen: 'tieuhoc' | 'trunghoc' }
  | { kind: 'event'; eventId: string; name: string; choice: 'yes' | 'no' }
  | { kind: 'survey'; weekId: string; answers: Record<string, string> };
type IconName = 'home' | 'calendar' | 'meal' | 'person' | 'arrow' | 'check' | 'clock' | 'sun' | 'bowl' | 'close' | 'link' | 'star' | 'shield' | 'event' | 'refresh';
const paths: Record<IconName, string> = {
  home: 'm3 10 9-7 9 7v10h-6v-7h-6v7H3Z', calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2 10h3m4 0h3m-10 4h3',
  meal: 'M5 3v8m-3-8v5a3 3 0 0 0 6 0V3M5 11v10M18 3c-4 3-4 8 0 9V3Zm0 9v9', person: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6', clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  bowl: 'M3 11h18c0 6-4 9-9 9s-9-3-9-9Zm3 11h12M8 3c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5',
  close: 'm6 6 12 12M6 18 18 6', link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1Z', shield: 'm12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Zm-4 10 3 3 5-6',
  event: 'm3 21 5-17 12 12L3 21Zm6-8 3 3m3-13 1-2m3 7 3-1M11 1l1 2m8 8 2 1', refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M4 12a8 8 0 0 0 14 6',
};
function Icon({ name, size = 22 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
function Status({ children, tone = 'good' }: { children: ReactNode; tone?: string }) { return <span className={`ma-status ma-status-${tone}`}>{children}</span>; }
function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <div className="ma-page-title"><p className="ma-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>; }
const todayInVietnam = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const shiftDate = (date: string, days: number) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
export const weekStart = (date: string) => { const day = new Date(`${date}T00:00:00Z`).getUTCDay(); return shiftDate(date, day === 0 ? -6 : 1 - day); };
const dateLabel = (date: string) => validDate(date) ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)) : date;
const monthLabel = (month: string) => `Tháng ${Number(month.slice(5))}/${month.slice(0, 4)}`;
const atLabel = (value: string | number | null) => value !== null && !isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(value)) : 'Chưa có thông tin';
const isSessionFailure = (error: unknown) => error instanceof AccountLinkError && ['auth_required', 'account_unavailable', 'email_verification_required'].includes(error.code);
const readError = (error: unknown) => error instanceof AccountLinkError && error.code === 'invalid_request'
  ? 'Dịch vụ suất ăn chưa sẵn sàng cho yêu cầu này. Vui lòng thử lại sau hoặc liên hệ bộ phận CNTT.' : accountLinkMessage(error);

export function MealDayCard({ day }: { day: DayView }) {
  return <article className="ma-card ma-history-item"><div className="ma-history-heading"><strong>{dateLabel(day.date)}</strong><Status tone={day.hold || day.result.offDay ? 'neutral' : 'good'}>{day.hold ? 'Cần đối chiếu dữ liệu' : day.result.offDay ? 'Lượt chấm tham khảo' : 'Ngày phục vụ'}</Status></div>
    <div className="ma-history-times">{(['breakfast', 'lunch'] as const).map(meal => { const item = day.result.meals[meal]; return <span key={meal}><Icon name={meal === 'breakfast' ? 'sun' : 'bowl'} size={18} /><span>{meal === 'breakfast' ? 'Bữa sáng' : 'Bữa trưa'}<strong>{item.time || '—'}</strong><small className={item.code === 'missing' && !day.hold ? 'ma-text-warn' : ''}>{day.hold ? 'Chưa thể kết luận đối soát' : mealLabels[item.code]}</small></span></span>; })}</div>
    {day.result.offDay && <p className="ma-history-note">Ngày nghỉ / ăn sự kiện: chỉ tra cứu lượt chấm, không tính vào suất tháng hoặc vi phạm.</p>}
    {day.result.unrecognized.length > 0 && <p className="ma-history-note">Ngoài khung giờ ăn: {day.result.unrecognized.join(', ')}{(day.result.unrecognizedCount || 0) > day.result.unrecognized.length ? ` và ${(day.result.unrecognizedCount || 0) - day.result.unrecognized.length} lượt khác` : ''}.</p>}
  </article>;
}

export default function App() {
  const setup = useMemo(() => { try { const account = createAccountLinkClient({ origin: import.meta.env.VITE_DKAN_API_ORIGIN, development: import.meta.env.DEV }); return { account, business: createMealBusinessClient(account), error: null }; } catch (error) { return { account: null, business: null, error: accountLinkMessage(error) }; } }, []);
  const [tab, setTab] = useState<Tab>('home'), [modal, setModal] = useState<Modal>(null);
  const [session, setSession] = useState<LinkedSession | null>(null), [data, setData] = useState<MealSnapshot | null>(null);
  const [selectedMonth, setSelectedMonth] = useState(() => todayInVietnam().slice(0, 7)), [selectedWeek, setSelectedWeek] = useState(() => weekStart(todayInVietnam()));
  const [selectedMenu, setSelectedMenu] = useState(''), [reloadVersion, setReloadVersion] = useState(0), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null), [saveError, setSaveError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const [registrationMode, setRegistrationMode] = useState<'register' | 'cancel'>('register'), [breakfast, setBreakfast] = useState(false), [lunch, setLunch] = useState(true);
  const [cancelDate, setCancelDate] = useState(''), [cancelMeal, setCancelMeal] = useState<'breakfast' | 'lunch' | 'both'>('lunch'), [cancelReason, setCancelReason] = useState(''), [canteen, setCanteen] = useState<'tieuhoc' | 'trunghoc'>('tieuhoc');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const contentRef = useRef<HTMLElement>(null), dialogRef = useRef<HTMLDialogElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const sessionRef = useRef(session), generation = useRef(0), mutation = useRef<AbortController | null>(null);
  sessionRef.current = session;
  const active = (ticket: number, token: string) => generation.current === ticket && sessionRef.current?.sessionToken === token && sessionRef.current.expiresAt > Date.now();
  function changeSession(next: LinkedSession | null) {
    if (sessionRef.current?.sessionToken !== next?.sessionToken) {
      generation.current++; mutation.current?.abort(); mutation.current = null; setData(null); setPending(null); setSaving(false); setError(null); setSaveError(null); setNotice(null); setAnswers({}); setCancelReason('');
      if (!next) setModal(previous => previous === 'link' ? 'link' : null);
      setSelectedMonth(todayInVietnam().slice(0, 7)); setSelectedWeek(weekStart(todayInVietnam()));
    }
    sessionRef.current = next; setSession(next);
  }
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => { changeSession(null); setError('Phiên cá nhân đã hết hạn. Vui lòng kiểm tra tài khoản Zalo lại.'); }, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session?.sessionToken, session?.expiresAt]);
  useEffect(() => {
    const controller = new AbortController(), token = session?.sessionToken, ticket = generation.current;
    setData(null); setLoading(!!token);
    if (!token || !setup.business) { setLoading(false); return () => controller.abort(); }
    setError(null);
    void setup.business.snapshot(token, selectedMonth, selectedWeek, controller.signal).then(snapshot => {
      if (!active(ticket, token) || controller.signal.aborted) return;
      setData(snapshot); const days = snapshot.menu?.days || []; setSelectedMenu(days.find(day => day.date === snapshot.today)?.date || days[0]?.date || '');
      setBreakfast((snapshot.registration.record?.breakfastCount || 0) > 0); setLunch((snapshot.registration.record?.lunchCount || 0) > 0 || !snapshot.registration.record);
      const cancellable = snapshot.cancellations.dates.find(day => !day.existing && (day.breakfast || day.lunch)); setCancelDate(cancellable?.date || ''); setCancelMeal(cancellable?.lunch ? 'lunch' : 'breakfast');
      setAnswers(snapshot.survey?.answers ? { ...snapshot.survey.answers } : {});
    }).catch(caught => {
      if (!active(ticket, token) || controller.signal.aborted) return;
      if (isSessionFailure(caught)) changeSession(null);
      setError(readError(caught));
    }).finally(() => { if (generation.current === ticket && !controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [session?.sessionToken, selectedMonth, selectedWeek, reloadVersion, setup.business]);
  useEffect(() => () => { generation.current++; mutation.current?.abort(); }, []);
  useEffect(() => {
    if (!modal) return;
    previousFocus.current = document.activeElement as HTMLElement; const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); previousFocus.current?.focus(); };
  }, [modal]);
  const dismissDialog = () => { if (!saving) { setModal(null); setPending(null); } };
  function navigate(next: Tab) { setTab(next); contentRef.current?.focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function confirm(value: Pending) { setPending(value); setModal('confirm'); }
  async function savePending() {
    const owner = sessionRef.current, request = pending;
    if (!owner || !setup.business || !request || saving || owner.expiresAt <= Date.now()) return;
    const controller = new AbortController(), ticket = generation.current, token = owner.sessionToken; mutation.current = controller;
    setSaving(true); setError(null); setSaveError(null); setNotice(null);
    try {
      const client = setup.business;
      if (request.kind === 'register') await client.register(token, request.month, request.breakfast, request.lunch, controller.signal);
      else if (request.kind === 'cancel') await client.cancel(token, [request.date], request.meal, request.reason, request.canteen, controller.signal);
      else if (request.kind === 'event') await client.event(token, request.eventId, request.choice, controller.signal);
      else await client.survey(token, request.weekId, request.answers, controller.signal);
      if (!active(ticket, token) || controller.signal.aborted) return;
      setPending(null); setModal(null); setNotice('Đã lưu thành công trên hệ thống nhà trường.'); setReloadVersion(value => value + 1);
    } catch (caught) {
      if (!active(ticket, token) || controller.signal.aborted) return;
      if (isSessionFailure(caught)) { changeSession(null); setModal('link'); }
      else { setPending(null); setModal(null); setReloadVersion(value => value + 1); }
      setSaveError(accountLinkMessage(caught));
    } finally { if (active(ticket, token)) setSaving(false); if (mutation.current === controller) mutation.current = null; }
  }
  const tabs: Array<{ id: Tab; name: string; icon: IconName }> = [{ id: 'home', name: 'Trang chủ', icon: 'home' }, { id: 'register', name: 'Đăng ký', icon: 'calendar' }, { id: 'menu', name: 'Thực đơn', icon: 'meal' }, { id: 'personal', name: 'Cá nhân', icon: 'person' }];
  const profile = data?.profile || session?.profile, menu = data?.menu?.days.find(day => day.date === selectedMenu), todayMenu = data?.menu?.days.find(day => day.date === data.today);
  const cancelDay = data?.cancellations.dates.find(day => day.date === cancelDate), survey = data?.survey;
  const canCancel = !!cancelDay && !cancelDay.existing && (cancelMeal === 'both' ? cancelDay.breakfast && cancelDay.lunch : cancelDay[cancelMeal]);
  const validAnswers = !!survey && survey.questions.every(q => q.kind === 'choice' ? q.options.some(option => option.value === answers[q.id]) : (!q.required || !!answers[q.id]?.trim()) && (answers[q.id]?.length || 0) <= q.maxLength);
  const monthPicker = data && <label className="ma-field ma-month-select">Tháng theo dõi<select value={selectedMonth} disabled={saving || loading} onChange={event => { setNotice(null); setSelectedMonth(event.target.value); }}>{data.monthOptions.map(month => <option key={month} value={month}>{monthLabel(month)}</option>)}</select></label>;

  return <div className="ma-app">
    <header className="ma-header"><div className="ma-brand"><img className="ma-brand-logo" src={schoolLogo} alt="Trường Ngôi Sao Hoàng Mai" /><div><strong>Suất ăn</strong><span>Nhà trường</span></div></div><button className="ma-icon-button" aria-label="Tài khoản nhà trường" onClick={() => setModal('link')}><Icon name="person" /></button></header>
    <div className="ma-live-banner"><span className="ma-demo-dot" /><span>{session ? 'Đã xác minh tài khoản nhà trường' : 'Kết nối tài khoản để sử dụng'}</span><span className="ma-zalo-label">MINI APP</span></div>
    <main className="ma-main" tabIndex={-1} ref={contentRef}>
      {(saveError || error || setup.error) && <div className="ma-live-error" role="alert"><strong>Chưa hoàn tất yêu cầu</strong><p>{saveError || error || setup.error}</p>{session && <button className="ma-link-secondary" disabled={loading || saving} onClick={() => { setSaveError(null); setReloadVersion(value => value + 1); }}>Tải lại dữ liệu</button>}</div>}
      {notice && <div className="ma-notice" role="status"><Icon name="check" size={19} /><span>{notice}</span><button aria-label="Đóng thông báo" onClick={() => setNotice(null)}><Icon name="close" size={18} /></button></div>}
      {!session ? <><PageTitle eyebrow="NGÔI SAO HOÀNG MAI" title="Bữa ăn của bạn, ngay trên Zalo" description="Đăng ký suất ăn, xem thực đơn và theo dõi lượt chấm bằng tài khoản nhà trường đã liên kết." /><section className="ma-card ma-empty"><span className="ma-tile-icon ma-blue"><Icon name="shield" size={28} /></span><h2>Kết nối đúng tài khoản của bạn</h2><p>Kiểm tra tài khoản Zalo để mở dữ liệu cá nhân. Nếu chưa liên kết, Mini App sẽ hướng dẫn xác nhận qua Microsoft của trường.</p><button className="ma-primary" onClick={() => setModal('link')} disabled={!setup.account?.configured}>Kiểm tra tài khoản Zalo <Icon name="arrow" size={18} /></button></section></>
        : loading ? <section className="ma-card ma-empty" role="status"><span className="ma-spinner" /><h2>Đang tải dữ liệu nhà trường…</h2><p>Vui lòng chờ trong giây lát.</p></section>
          : data ? <>
            {tab === 'home' && <>
              <div className="ma-welcome"><p className="ma-eyebrow">{dateLabel(data.today).toUpperCase()}</p><h1>Xin chào,<br /><span>{profile?.fullName}</span></h1><p>{profile?.department || 'Không gian suất ăn cá nhân của Thầy/Cô'}</p></div>
              <section className="ma-today-card"><div className="ma-today-heading"><div><span className="ma-today-kicker">LỊCH ĂN CỦA BẠN</span><h2>Hôm nay ăn gì?</h2></div><span className="ma-plate"><Icon name="meal" size={30} /></span></div><div className="ma-today-meals">{(['breakfast', 'lunch'] as const).map(meal => <div key={meal}><span><Icon name={meal === 'breakfast' ? 'sun' : 'bowl'} size={18} />{meal === 'breakfast' ? 'Bữa sáng' : 'Bữa trưa'}</span><strong>{(meal === 'breakfast' ? todayMenu?.breakfast : todayMenu?.main) || 'Xem thực đơn tuần hiện tại'}</strong><small>{data.todayMeals ? data.todayMeals.hold ? 'Chưa thể kết luận đối soát' : `${mealLabels[data.todayMeals.result.meals[meal].code]}${data.todayMeals.result.meals[meal].time ? ` · ${data.todayMeals.result.meals[meal].time}` : ''}` : 'Chưa có dữ liệu lượt chấm'}</small></div>)}</div><button className="ma-today-link" onClick={() => { setSelectedWeek(weekStart(data.today)); navigate('menu'); }}>Xem đầy đủ thực đơn <Icon name="arrow" size={18} /></button></section>
              <div className="ma-section-heading"><h2>Thao tác nhanh</h2><button className="ma-text-button" onClick={() => setReloadVersion(value => value + 1)} disabled={saving}><Icon name="refresh" size={15} />Tải lại</button></div><div className="ma-shortcuts">
                <button onClick={() => { setRegistrationMode('register'); navigate('register'); }}><span className="ma-tile-icon ma-blue"><Icon name="calendar" /></span><strong>Đăng ký ăn</strong><small>Theo tháng phục vụ</small></button><button onClick={() => { setRegistrationMode('cancel'); navigate('register'); }}><span className="ma-tile-icon ma-orange"><Icon name="clock" /></span><strong>Báo hủy ăn</strong><small>Chọn ngày, chọn bữa</small></button><button onClick={() => navigate('personal')}><span className="ma-tile-icon ma-purple"><Icon name="check" /></span><strong>Chấm ăn của tôi</strong><small>Tra cứu từng ngày</small></button><button onClick={() => setModal('event')}><span className="ma-tile-icon ma-pink"><Icon name="event" /></span><strong>Suất ăn sự kiện</strong><small>{data.events.length ? `${data.events.length} sự kiện` : 'Chưa có sự kiện'}</small></button>
              </div>
              <section className="ma-survey-card"><span className="ma-survey-art"><Icon name="star" size={26} /></span><div><span className="ma-eyebrow">LẮNG NGHE Ý KIẾN</span><h2>Bữa ăn tuần này thế nào?</h2><p>{survey?.answers ? 'Phản hồi của Thầy/Cô đã được ghi nhận.' : survey?.allowed ? 'Khảo sát đang mở, mời Thầy/Cô chia sẻ.' : 'Xem khảo sát và thời gian tiếp nhận ý kiến.'}</p><button onClick={() => setModal('survey')}>{survey?.answers ? 'Xem phản hồi' : 'Khảo sát bữa ăn'} <Icon name="arrow" size={17} /></button></div></section>
              <p className="ma-footnote"><Icon name="shield" size={16} />Lần đồng bộ gần nhất: {atLabel(data.sync.lastRunAt)}{data.sync.lastRunComplete === false ? ' · Chưa đủ mọi máy' : ''}</p>
            </>}
            {tab === 'register' && <>
              <PageTitle eyebrow="CHỦ ĐỘNG BỮA ĂN" title="Đăng ký suất ăn" description="Đăng ký và báo hủy được ghi nhận trực tiếp vào hệ thống nhà trường." />{monthPicker}
              <div className="ma-segment"><button aria-pressed={registrationMode === 'register'} className={registrationMode === 'register' ? 'active' : ''} onClick={() => setRegistrationMode('register')}>Đăng ký tháng</button><button aria-pressed={registrationMode === 'cancel'} className={registrationMode === 'cancel' ? 'active' : ''} onClick={() => setRegistrationMode('cancel')}>Báo hủy ăn</button></div>
              {registrationMode === 'register' ? <section className="ma-card ma-form-card"><div className="ma-month-chip"><Icon name="calendar" /><div><span>Tháng đăng ký</span><strong>{monthLabel(data.month)}</strong></div></div>
                {data.registration.record ? <div className="ma-live-receipt"><Status>Đã đăng ký trên hệ thống</Status><h2>{data.registration.record.breakfastCount > 0 ? 'Bữa sáng + Bữa trưa' : 'Bữa trưa'}</h2><p>Bữa sáng: <strong>{data.registration.record.breakfastCount}</strong> suất · Bữa trưa: <strong>{data.registration.record.lunchCount}</strong> suất</p><p>Bắt đầu: {dateLabel(data.registration.record.firstMealDate)}</p><p>Ghi nhận: {atLabel(data.registration.record.timestamp)}</p></div>
                  : <><h2>Chọn bữa ăn của bạn</h2><p className="ma-muted">Ngày bắt đầu: {dateLabel(data.registration.firstMealDate)} · {data.registration.weekdays} ngày phục vụ.</p>{data.registration.deadline && <p className="ma-muted">Hạn đăng ký: {atLabel(data.registration.deadline)}</p>}
                    <label className={`ma-choice ${breakfast ? 'selected' : ''}`}><span className="ma-tile-icon ma-orange"><Icon name="sun" /></span><span><strong>Bữa sáng + Bữa trưa</strong><small>Đăng ký sáng bao gồm cả bữa trưa</small></span><input type="checkbox" checked={breakfast} disabled={!data.registration.allowed || saving} onChange={event => { setBreakfast(event.target.checked); if (event.target.checked) setLunch(true); }} /></label><label className={`ma-choice ${lunch ? 'selected' : ''}`}><span className="ma-tile-icon ma-blue"><Icon name="bowl" /></span><span><strong>Bữa trưa</strong><small>Suất ăn tại bếp nhà trường</small></span><input type="checkbox" checked={lunch} disabled={breakfast || !data.registration.allowed || saving} onChange={event => setLunch(event.target.checked)} /></label>
                    <button className="ma-primary" disabled={!data.registration.allowed || !lunch || saving} onClick={() => confirm({ kind: 'register', month: data.month, breakfast, lunch })}>Tiếp tục đăng ký <Icon name="arrow" size={18} /></button></>}
                {!data.registration.allowed && <p className="ma-lock-reason">{businessReason(data.registration.lockedReason)}</p>}
              </section> : <section className="ma-card ma-form-card"><h2>Báo hủy theo ngày</h2><p className="ma-muted">Các ngày có thể chọn đã được hệ thống kiểm tra lịch phục vụ và hạn hủy.</p>
                {data.cancellations.dates.some(day => !day.existing && (day.breakfast || day.lunch)) ? <form onSubmit={event => { event.preventDefault(); if (canCancel && cancelReason.trim()) confirm({ kind: 'cancel', date: cancelDate, meal: cancelMeal, reason: cancelReason.trim(), canteen }); }}>
                  <label className="ma-field">Ngày cần hủy<select value={cancelDate} disabled={saving} onChange={event => { setCancelDate(event.target.value); const item = data.cancellations.dates.find(day => day.date === event.target.value); setCancelMeal(item?.lunch ? 'lunch' : 'breakfast'); }}>{data.cancellations.dates.filter(day => !day.existing && (day.breakfast || day.lunch)).map(day => <option key={day.date} value={day.date}>{dateLabel(day.date)}</option>)}</select></label>
                  <label className="ma-field">Bữa cần hủy<select value={cancelMeal} disabled={saving} onChange={event => setCancelMeal(event.target.value as typeof cancelMeal)}><option value="breakfast" disabled={!cancelDay?.breakfast}>Bữa sáng</option><option value="lunch" disabled={!cancelDay?.lunch}>Bữa trưa</option><option value="both" disabled={!cancelDay?.breakfast || !cancelDay?.lunch}>Cả hai bữa</option></select></label>
                  <label className="ma-field">Bếp phục vụ<select value={canteen} disabled={saving} onChange={event => setCanteen(event.target.value as typeof canteen)}><option value="tieuhoc">Tiểu học</option><option value="trunghoc">Trung học</option></select></label><label className="ma-field">Lý do báo hủy<textarea required maxLength={500} rows={3} value={cancelReason} disabled={saving} onChange={event => setCancelReason(event.target.value)} placeholder="Nhập lý do báo hủy suất ăn…" /></label><button className="ma-primary" type="submit" disabled={!canCancel || !cancelReason.trim() || saving}>Tiếp tục báo hủy <Icon name="arrow" size={18} /></button>
                </form> : <div className="ma-empty-small"><p>Không có bữa ăn còn trong hạn hủy ở tháng đã chọn.</p><p>Ngày có thể báo hủy sớm nhất: {dateLabel(data.cancellations.earliestDate)}.</p></div>}
                <div className="ma-section-heading"><h3>Đã báo hủy</h3><span>{data.cancellations.records.length} lượt</span></div>{data.cancellations.records.length ? <ul className="ma-receipt-list">{data.cancellations.records.map((record, index) => <li key={`${record.date}-${record.meal}-${index}`}><strong>{dateLabel(record.date)}</strong><span>{record.meal === 'both' ? 'Cả hai bữa' : record.meal === 'breakfast' ? 'Bữa sáng' : 'Bữa trưa'} · {record.canteen === 'trunghoc' ? 'Trung học' : 'Tiểu học'}</span><small>{record.reason}</small></li>)}</ul> : <p className="ma-muted">Chưa có báo hủy trong tháng này.</p>}
              </section>}
            </>}
            {tab === 'menu' && <>
              <PageTitle eyebrow="DINH DƯỠNG NHÀ TRƯỜNG" title="Thực đơn tuần" description="Thực đơn do Nhóm Dinh dưỡng công bố trên hệ thống." />
              <div className="ma-week-navigation"><button aria-label="Tuần trước" disabled={saving} onClick={() => setSelectedWeek(shiftDate(selectedWeek, -7))}>‹</button><div><strong>{dateLabel(selectedWeek)}</strong><span>đến {dateLabel(shiftDate(selectedWeek, 4))}</span></div><button aria-label="Tuần sau" disabled={saving} onClick={() => setSelectedWeek(shiftDate(selectedWeek, 7))}>›</button></div><button className="ma-text-button ma-current-week" disabled={saving} onClick={() => setSelectedWeek(weekStart(data.today))}>Về tuần hiện tại</button>
              {data.menu && data.menu.days.length ? <><div className="ma-day-picker" role="group" aria-label="Chọn ngày xem thực đơn">{data.menu.days.map(day => <button key={day.date} aria-pressed={selectedMenu === day.date} className={selectedMenu === day.date ? 'active' : ''} onClick={() => setSelectedMenu(day.date)}><span>{new Intl.DateTimeFormat('vi-VN', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${day.date}T00:00:00Z`))}</span><strong>{day.date.slice(8)}/{day.date.slice(5, 7)}</strong><i /></button>)}</div>
                {menu && <><section className="ma-card ma-menu-section"><div className="ma-menu-section-title"><span className="ma-tile-icon ma-orange"><Icon name="sun" /></span><div><span>BỮA SÁNG</span><h2>{menu.breakfast || 'Chưa cập nhật món ăn'}</h2></div></div></section><section className="ma-card ma-menu-section"><div className="ma-menu-section-title"><span className="ma-tile-icon ma-blue"><Icon name="bowl" /></span><div><span>BỮA TRƯA</span><h2>{dateLabel(menu.date)}</h2></div></div><div className="ma-menu-main"><span className="ma-menu-main-icon"><Icon name="meal" size={29} /></span><div><span>MÓN CHÍNH</span><strong>{menu.main || 'Chưa cập nhật'}</strong></div></div><dl className="ma-dish-list">{[['Món phụ', menu.side], ['Món rau', menu.vegetable], ['Món canh', menu.soup], ['Cơm', menu.rice], ['Tráng miệng', menu.dessert]].map(([label, dish]) => <div key={label}><dt>{label}</dt><dd>{dish || '—'}</dd></div>)}</dl></section></>}{data.menu.note && <div className="ma-inline-info"><p>{data.menu.note}</p></div>}
              </> : <section className="ma-card ma-empty"><Icon name="meal" size={28} /><h2>Chưa có thực đơn cho tuần này</h2><p>Thực đơn sẽ hiển thị sau khi Nhóm Dinh dưỡng cập nhật trên hệ thống.</p></section>}
            </>}
            {tab === 'personal' && <>
              <PageTitle eyebrow="KHÔNG GIAN CÁ NHÂN" title="Chấm ăn của tôi" description="Tra cứu đăng ký và lượt chấm từ máy nhận diện theo từng ngày." />
              <section className="ma-card ma-profile"><div className="ma-avatar">{profile?.fullName.split(/\s+/).filter(Boolean).slice(-2).map(word => word[0]).join('')}</div><div><h2>{profile?.fullName}</h2><p>{profile?.department} · Mã NV {profile?.employeeId || 'Chưa cập nhật'}</p><Status>Đã xác minh</Status></div></section>{monthPicker}
              <div className="ma-section-heading"><h2>Lịch sử chấm ăn</h2><span>{data.history.days.length} ngày</span></div>{data.history.conflict && <div className="ma-inline-info"><p>Mã nhân viên có dữ liệu cần đối chiếu. Các ngày liên quan được giữ trạng thái chưa kết luận.</p></div>}
              {data.history.days.length ? <section className="ma-history-list">{data.history.days.map(day => <MealDayCard key={day.date} day={day} />)}</section> : <section className="ma-card ma-empty"><h2>Chưa có lượt chấm trong tháng</h2><p>Chọn một tháng khác hoặc tải lại sau lần đồng bộ từ máy nhận diện.</p></section>}
              <p className="ma-footnote">Dữ liệu cá nhân cập nhật: {atLabel(data.history.updatedAt)}</p><button className="ma-link-secondary" onClick={() => setModal('link')}>Thông tin tài khoản và đăng xuất</button>
            </>}
          </> : !error ? <section className="ma-card ma-empty"><h2>Chưa tải được dữ liệu</h2><button className="ma-primary" onClick={() => setReloadVersion(value => value + 1)}>Thử tải lại</button></section> : null}
      <div className="ma-bottom-caption">NGÔI SAO HOÀNG MAI <span>·</span> SUẤT ĂN<br /><small>{ACCOUNT_LINK_BUILD}</small></div>
    </main>
    <nav className="ma-bottom-nav" aria-label="Chức năng chính">{tabs.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} disabled={saving} onClick={() => navigate(item.id)}><span><Icon name={item.icon} size={22} /></span><strong>{item.name}</strong></button>)}</nav>
    {modal && <dialog ref={dialogRef} className="ma-dialog" aria-labelledby="ma-dialog-title" onCancel={event => { if (saving) event.preventDefault(); else dismissDialog(); }} onClick={event => { if (event.target === event.currentTarget) dismissDialog(); }}><div className="ma-dialog-content"><div className="ma-dialog-header"><span className="ma-tile-icon ma-blue"><Icon name={modal === 'link' ? 'shield' : modal === 'survey' ? 'star' : modal === 'event' ? 'event' : 'check'} /></span><button className="ma-icon-button" disabled={saving} aria-label="Đóng hộp thoại" onClick={dismissDialog}><Icon name="close" /></button></div>
      {modal === 'link' && <AccountLinkPanel initialSession={session} onSessionChange={changeSession} />}
      {modal === 'confirm' && pending && <><span className="ma-eyebrow">XÁC NHẬN THAO TÁC</span><h2 id="ma-dialog-title">{pending.kind === 'register' ? 'Đăng ký suất ăn tháng' : pending.kind === 'cancel' ? 'Báo hủy suất ăn' : pending.kind === 'event' ? 'Đăng ký suất ăn sự kiện' : 'Gửi phản hồi khảo sát'}</h2>
        <div className="ma-confirm-summary">{pending.kind === 'register' ? <><strong>{monthLabel(pending.month)}</strong><p>{pending.breakfast ? 'Bữa sáng + Bữa trưa' : 'Bữa trưa'}</p></> : pending.kind === 'cancel' ? <><strong>{dateLabel(pending.date)}</strong><p>{pending.meal === 'both' ? 'Cả hai bữa' : pending.meal === 'breakfast' ? 'Bữa sáng' : 'Bữa trưa'} · Bếp {pending.canteen === 'tieuhoc' ? 'Tiểu học' : 'Trung học'}</p><p>{pending.reason}</p></> : pending.kind === 'event' ? <><strong>{pending.name}</strong><p>{pending.choice === 'yes' ? 'Có tham gia ăn' : 'Không tham gia ăn'}</p></> : <><strong>Tuần bắt đầu {dateLabel(pending.weekId)}</strong><p>Gửi câu trả lời đến Nhóm Dinh dưỡng.</p></>}</div><p>Thông tin sẽ được lưu vào hệ thống nhà trường cho tài khoản <strong>{profile?.email}</strong>.</p><button className="ma-primary" disabled={saving} onClick={() => { void savePending(); }}>{saving ? 'Đang gửi, vui lòng chờ…' : 'Xác nhận và gửi'}</button><button className="ma-link-secondary" disabled={saving} onClick={dismissDialog}>Quay lại</button>
      </>}
      {modal === 'event' && <><span className="ma-eyebrow">SUẤT ĂN NHÀ TRƯỜNG</span><h2 id="ma-dialog-title">Đăng ký ăn sự kiện</h2>{data?.events.length ? <div className="ma-live-events">{data.events.map(event => <section className="ma-live-event" key={event.id}><h3>{event.name}</h3>{event.deadline && <p>Hạn đăng ký: {atLabel(event.deadline)}</p>}{event.choice && <Status>Đã ghi nhận: {event.choice === 'yes' ? 'Có tham gia ăn' : 'Không tham gia'}</Status>}{event.allowed ? <div className="ma-event-choices"><button onClick={() => confirm({ kind: 'event', eventId: event.id, name: event.name, choice: 'yes' })}><Icon name="meal" /><strong>Có tham gia ăn</strong></button><button onClick={() => confirm({ kind: 'event', eventId: event.id, name: event.name, choice: 'no' })}><Icon name="calendar" /><strong>Không tham gia</strong></button></div> : <p className="ma-lock-reason">{businessReason(event.lockedReason)}</p>}</section>)}</div> : <p>Hiện chưa có sự kiện phục vụ suất ăn để đăng ký.</p>}</>}
      {modal === 'survey' && <><span className="ma-eyebrow">LẮNG NGHE Ý KIẾN</span><h2 id="ma-dialog-title">Khảo sát chất lượng suất ăn</h2>{survey ? <><p>Tuần {dateLabel(survey.weekId)}{survey.closesAt ? ` · Hạn trả lời: ${atLabel(survey.closesAt)}` : ''}</p>{survey.answers && <div className="ma-live-receipt"><Status>Đã ghi nhận phản hồi</Status><p>Cập nhật lúc: {atLabel(survey.updatedAt || survey.submittedAt)}</p></div>}{!survey.allowed && <p className="ma-lock-reason">{survey.skipped ? 'Tuần này không tổ chức khảo sát.' : businessReason('survey_closed')}</p>}<form onSubmit={event => { event.preventDefault(); if (survey.allowed && validAnswers) confirm({ kind: 'survey', weekId: survey.weekId, answers: { ...answers } }); }}><fieldset className="ma-live-survey" disabled={!survey.allowed || saving}>{survey.questions.map((question, index) => question.kind === 'choice' ? <fieldset className="ma-survey-question" key={question.id}><legend>{index + 1}. {question.label}{question.required ? ' *' : ''}</legend>{question.options.map(option => <label className="ma-survey-option" key={option.value}><input type="radio" name={`survey-${question.id}`} value={option.value} checked={answers[question.id] === option.value} required={question.required} onChange={() => setAnswers(previous => ({ ...previous, [question.id]: option.value }))} /><span>{option.label}</span></label>)}</fieldset> : <label className="ma-field" key={question.id}>{index + 1}. {question.label}{question.required ? ' *' : ''}<textarea rows={3} required={question.required} maxLength={question.maxLength} placeholder={question.placeholder} value={answers[question.id] || ''} onChange={event => setAnswers(previous => ({ ...previous, [question.id]: event.target.value }))} /><small className="ma-character-count">{answers[question.id]?.length || 0}/{question.maxLength}</small></label>)}</fieldset>{survey.allowed && <button className="ma-primary" type="submit" disabled={!validAnswers || saving}>{survey.answers ? 'Cập nhật phản hồi' : 'Tiếp tục gửi phản hồi'}</button>}</form></> : <p>Hiện chưa có khảo sát được nhà trường công bố.</p>}</>}
    </div></dialog>}
  </div>;
}
