import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { demoHistory, demoProfile, futureDates, menuDays } from './demo';
import schoolLogo from './assets/school-logo.png';
import { AccountLinkPanel } from './components/AccountLinkPanel';

type Tab = 'home' | 'register' | 'menu' | 'personal';
type Modal = 'link' | 'survey' | 'event' | null;
type IconName = 'home' | 'calendar' | 'meal' | 'person' | 'arrow' | 'chevron' | 'check' | 'clock' | 'sun' | 'bowl' | 'close' | 'link' | 'star' | 'shield' | 'event' | 'bell' | 'leaf' | 'help';
const paths: Record<IconName, string> = {
  home: 'm3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z',
  calendar: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2 10h3m4 0h3m-10 4h3',
  meal: 'M5 3v8m-3-8v5a3 3 0 0 0 6 0V3M5 11v10M18 3c-4 3-4 8 0 9V3Zm0 9v9',
  person: 'M20 21a8 8 0 0 0-16 0M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6', chevron: 'm9 5 7 7-7 7', check: 'm5 12 4 4L19 6',
  clock: 'M12 7v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  sun: 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  bowl: 'M3 11h18c0 6-4 9-9 9s-9-3-9-9Zm3 11h12M8 3c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5m5-5c-2 2 2 3 0 5',
  close: 'm6 6 12 12M6 18 18 6', link: 'm9 15 6-6M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 2 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0',
  star: 'm12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1Z',
  shield: 'm12 2 9 4v6c0 5-5 8-9 10-4-2-9-5-9-10V6Zm-4 10 3 3 5-6',
  event: 'm3 21 5-17 12 12L3 21Zm6-8 3 3m3-13 1-2m3 7 3-1M11 1l1 2m8 8 2 1',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Zm-9 9a3 3 0 0 0 6 0',
  leaf: 'M20 3C9 1 2 8 5 16s15 4 15-13ZM4 21 15 10',
  help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 3v.1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
};
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
function Status({ children, tone = 'good' }: { children: ReactNode; tone?: string }) {
  return <span className={`ma-status ma-status-${tone}`}>{children}</span>;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState('');
  const [selectedMenu, setSelectedMenu] = useState(4);
  const [registrationMode, setRegistrationMode] = useState<'register' | 'cancel'>('register');
  const [breakfast, setBreakfast] = useState(true);
  const [lunch, setLunch] = useState(true);
  const [registered, setRegistered] = useState(false);
  const [cancelDate, setCancelDate] = useState(futureDates[0].date);
  const [cancelMeal, setCancelMeal] = useState('breakfast');
  const [cancelled, setCancelled] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [eventChoice, setEventChoice] = useState<'yes' | 'no' | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const menu = menuDays[selectedMenu];
  const todayMenu = menuDays[4];

  useEffect(() => {
    if (!modal) return;
    previousFocus.current = document.activeElement as HTMLElement;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { dialog?.close(); previousFocus.current?.focus(); };
  }, [modal]);
  function navigate(next: Tab) { setTab(next); setMessage(''); contentRef.current?.focus(); window.scrollTo({ top: 0, behavior: 'instant' }); }
  function notify(text: string) { setMessage(text); }
  const tabs: Array<{ id: Tab; name: string; icon: IconName }> = [
    { id: 'home', name: 'Trang chủ', icon: 'home' }, { id: 'register', name: 'Đăng ký', icon: 'calendar' },
    { id: 'menu', name: 'Thực đơn', icon: 'meal' }, { id: 'personal', name: 'Cá nhân', icon: 'person' },
  ];
  return <div className="ma-app">
    <header className="ma-header">
      <div className="ma-brand"><img className="ma-brand-logo" src={schoolLogo} alt="Trường Ngôi Sao Hoàng Mai" /><div><strong>Suất ăn</strong><span>Nhà trường</span></div></div>
      <button className="ma-icon-button" aria-label="Thông tin bản mẫu và tài khoản" onClick={() => setModal('link')}><Icon name="person" /></button>
    </header>
    <div className="ma-demo-banner"><span className="ma-demo-dot" /><span>Bản mẫu · Dữ liệu minh họa</span><span className="ma-zalo-label">MINI APP</span></div>
    <main className="ma-main" tabIndex={-1} ref={contentRef}>
      {message && <div className="ma-notice" role="status"><Icon name="check" size={19} /><span>{message}</span><button aria-label="Đóng thông báo" onClick={() => setMessage('')}><Icon name="close" size={18} /></button></div>}
      {tab === 'home' && <>
        <div className="ma-welcome"><p className="ma-eyebrow">THỨ SÁU, 30 THÁNG 10 · NGÀY MINH HỌA</p><h1>Xin chào,<br /><span>{demoProfile.name}</span></h1><p>Cùng chuẩn bị cho những bữa ăn trọn vẹn.</p></div>
        <section className="ma-today-card" aria-labelledby="ma-today-title"><div className="ma-today-heading"><div><span className="ma-today-kicker">LỊCH ĂN CỦA BẠN</span><h2 id="ma-today-title">Hôm nay ăn gì?</h2></div><div className="ma-plate"><Icon name="meal" size={30} /></div></div><div className="ma-today-meals"><div><span><Icon name="sun" size={18} /> Bữa sáng</span><strong>{todayMenu.breakfast}</strong><small><Icon name="check" size={14} /> Đã chấm 07:12</small></div><div><span><Icon name="bowl" size={18} /> Bữa trưa</span><strong>{todayMenu.main}</strong><small><Icon name="check" size={14} /> Đã chấm 12:08</small></div></div><button className="ma-today-link" onClick={() => navigate('menu')}>Xem đầy đủ thực đơn <Icon name="arrow" size={18} /></button></section>
        <button className="ma-link-card" onClick={() => setModal('link')}><span className="ma-tile-icon ma-blue"><Icon name="link" /></span><span><strong>Liên kết tài khoản nhà trường</strong><small>Xác minh tài khoản Zalo và Microsoft nhà trường</small></span><Icon name="chevron" size={17} /></button>
        <div className="ma-section-heading"><h2>Thao tác nhanh</h2><span>Tiện ích của bạn</span></div>
        <div className="ma-shortcuts">
          <button onClick={() => { setRegistrationMode('register'); navigate('register'); }}><span className="ma-tile-icon ma-blue"><Icon name="calendar" /></span><strong>Đăng ký ăn</strong><small>Chọn bữa tháng tới</small></button>
          <button onClick={() => { setRegistrationMode('cancel'); navigate('register'); }}><span className="ma-tile-icon ma-orange"><Icon name="clock" /></span><strong>Báo hủy ăn</strong><small>Chọn ngày, chọn bữa</small></button>
          <button onClick={() => navigate('personal')}><span className="ma-tile-icon ma-purple"><Icon name="check" /></span><strong>Chấm ăn của tôi</strong><small>Tra cứu từng ngày</small></button>
          <button onClick={() => setModal('event')}><span className="ma-tile-icon ma-pink"><Icon name="event" /></span><strong>Suất ăn sự kiện</strong><small>Đăng ký tham gia</small></button>
        </div>
        <section className="ma-survey-card"><span className="ma-survey-art"><Icon name="star" size={26} /></span><div><span className="ma-eyebrow">LẮNG NGHE Ý KIẾN</span><h2>Bữa ăn tuần này thế nào?</h2><p>Một phút chia sẻ để bữa ăn tốt hơn.</p><button onClick={() => setModal('survey')}>Góp ý bữa ăn <Icon name="arrow" size={17} /></button></div></section>
        <p className="ma-footnote"><Icon name="shield" size={16} /> Các thẻ nghiệp vụ dùng dữ liệu mẫu; xác minh tài khoản ở mục liên kết.</p>
      </>}
      {tab === 'register' && <>
        <PageTitle eyebrow="CHỦ ĐỘNG BỮA ĂN" title="Đăng ký suất ăn" description="Thao tác dưới đây chỉ lưu trong phiên xem bản mẫu." />
        <div className="ma-segment" aria-label="Thao tác đăng ký ăn"><button aria-pressed={registrationMode === 'register'} className={registrationMode === 'register' ? 'active' : ''} onClick={() => setRegistrationMode('register')}>Đăng ký tháng</button><button aria-pressed={registrationMode === 'cancel'} className={registrationMode === 'cancel' ? 'active' : ''} onClick={() => setRegistrationMode('cancel')}>Báo hủy ăn</button></div>
        {registrationMode === 'register' ? <section className="ma-card ma-form-card"><div className="ma-month-chip"><Icon name="calendar" /><div><span>Tháng đăng ký minh họa</span><strong>Tháng 11/2026</strong></div></div><h2>Chọn bữa ăn của bạn</h2><p className="ma-muted">Mẫu đăng ký theo tháng. Hạn đăng ký và ngày phục vụ thật sẽ lấy từ hệ thống khi tích hợp.</p><label className={`ma-choice ${breakfast ? 'selected' : ''}`}><span className="ma-tile-icon ma-orange"><Icon name="sun" /></span><span><strong>Bữa sáng</strong><small>Bắt đầu ngày mới đủ năng lượng</small></span><input type="checkbox" checked={breakfast} onChange={e => { setBreakfast(e.target.checked); if (e.target.checked) setLunch(true); setRegistered(false); }} /></label><label className={`ma-choice ${lunch ? 'selected' : ''}`}><span className="ma-tile-icon ma-blue"><Icon name="bowl" /></span><span><strong>Bữa trưa</strong><small>Bữa trưa tại bếp nhà trường</small></span><input type="checkbox" checked={lunch} disabled={breakfast} onChange={e => { setLunch(e.target.checked); setRegistered(false); }} /></label><p className="ma-registration-rule">Suất sáng bao gồm đăng ký bữa trưa theo quy định hiện tại.</p><div className="ma-summary-line"><span>Bữa đã chọn</span><strong>{[breakfast ? 'Sáng' : '', lunch ? 'Trưa' : ''].filter(Boolean).join(' + ') || 'Chưa chọn bữa'}</strong></div><button className="ma-primary" disabled={!breakfast && !lunch} onClick={() => { setRegistered(true); notify('Đã ghi nhận lựa chọn minh họa trong phiên này. Chưa tạo đơn trên hệ thống.'); }}><Icon name={registered ? 'check' : 'calendar'} size={20} />{registered ? 'Đã ghi nhận bản mẫu' : 'Xác nhận đăng ký mẫu'}</button></section> : <section className="ma-card ma-form-card"><div className="ma-tile-icon ma-orange"><Icon name="clock" /></div><h2>Báo hủy theo ngày</h2><p className="ma-muted">Chọn một ngày tương lai trong dữ liệu mẫu. Bản dùng thật sẽ kiểm tra hạn hủy trên máy chủ.</p><label className="ma-field">Ngày hủy<select value={cancelDate} onChange={e => { setCancelDate(e.target.value); setCancelled(false); }}>{futureDates.map(day => <option key={day.date} value={day.date}>{day.label}</option>)}</select></label><label className="ma-field">Bữa cần hủy<select value={cancelMeal} onChange={e => { setCancelMeal(e.target.value); setCancelled(false); }}><option value="breakfast">Bữa sáng</option><option value="lunch">Bữa trưa</option><option value="both">Cả hai bữa</option></select></label><button className="ma-primary" onClick={() => { setCancelled(true); notify('Đã ghi nhận yêu cầu hủy minh họa. Chưa gửi yêu cầu hủy thật.'); }}><Icon name={cancelled ? 'check' : 'calendar'} size={20} />{cancelled ? 'Đã ghi nhận bản mẫu' : 'Xác nhận hủy mẫu'}</button></section>}
        <div className="ma-inline-info"><Icon name="shield" size={20} /><p>Đăng ký và hủy thật chỉ hoạt động sau khi liên kết tài khoản được xác minh.</p></div>
      </>}
      {tab === 'menu' && <>
        <PageTitle eyebrow="DINH DƯỠNG NHÀ TRƯỜNG" title="Thực đơn tuần" description="Ngon miệng, cân bằng và đa dạng mỗi ngày." />
        <div className="ma-week-heading"><div><Icon name="calendar" size={19} /><strong>26 – 30 tháng 10, 2026</strong></div><Status tone="neutral">Tuần mẫu</Status></div>
        <div className="ma-day-picker" role="group" aria-label="Chọn ngày xem thực đơn">{menuDays.map((day, index) => <button key={day.date} aria-pressed={selectedMenu === index} className={selectedMenu === index ? 'active' : ''} onClick={() => setSelectedMenu(index)}><span>{day.day}</span><strong>{day.short}</strong><i /></button>)}</div>
        <section className="ma-card ma-menu-section"><div className="ma-menu-section-title"><span className="ma-tile-icon ma-orange"><Icon name="sun" /></span><div><span>BỮA SÁNG</span><h2>{menu.breakfast}</h2></div><span className="ma-menu-time">05:00–08:00</span></div></section>
        <section className="ma-card ma-menu-section"><div className="ma-menu-section-title"><span className="ma-tile-icon ma-blue"><Icon name="bowl" /></span><div><span>BỮA TRƯA</span><h2>Đủ đầy hương vị</h2></div><span className="ma-menu-time">10:00–13:30</span></div><div className="ma-menu-main"><span className="ma-menu-main-icon"><Icon name="meal" size={29} /></span><div><span>MÓN CHÍNH</span><strong>{menu.main}</strong></div><span className="ma-menu-decoration" aria-hidden="true">✦</span></div><dl className="ma-dish-list">{[['Món phụ', menu.side], ['Món rau', menu.vegetable], ['Món canh', menu.soup], ['Cơm', menu.rice], ['Tráng miệng', menu.dessert]].map(([label, dish]) => <div key={label}><dt>{label}</dt><dd>{dish}</dd></div>)}</dl></section>
        <div className="ma-inline-info"><Icon name="leaf" size={20} /><p>Thực đơn đang hiển thị là nội dung minh họa cho bản thiết kế, chưa phải thực đơn do Nhóm Dinh dưỡng công bố.</p></div>
      </>}
      {tab === 'personal' && <>
        <PageTitle eyebrow="KHÔNG GIAN CÁ NHÂN" title="Chấm ăn của tôi" description="Theo dõi đăng ký và lượt chấm theo từng ngày." />
        <section className="ma-card ma-profile"><div className="ma-avatar">{demoProfile.initials}</div><div><h2>{demoProfile.name}</h2><p>{demoProfile.department} · Hồ sơ minh họa</p><Status tone="neutral">Hồ sơ minh họa</Status></div></section>
        <button className="ma-primary" onClick={() => setModal('link')}><Icon name="link" size={20} />Liên kết tài khoản nhà trường</button>
        <div className="ma-section-heading"><h2>Lịch sử chấm ăn</h2><span>Tháng 10/2026 · mẫu</span></div>
        <section className="ma-history-list">{demoHistory.map(day => <article className="ma-card ma-history-item" key={day.date}><div className="ma-history-heading"><div><strong>{day.date}</strong><span>{day.day}</span></div><Status tone={day.tone}>{day.status}</Status></div><div className="ma-history-times"><span><Icon name="sun" size={18} /><span>Bữa sáng<strong>{day.breakfast}</strong></span></span><span><Icon name="bowl" size={18} /><span>Bữa trưa<strong>{day.lunch}</strong></span></span></div></article>)}</section>
        <button className="ma-help-row" onClick={() => notify('Bản dùng thật sẽ hiển thị đầu mối hỗ trợ do nhà trường cấu hình.')}><Icon name="help" /><span>Cần hỗ trợ về lượt chấm ăn?</span><Icon name="chevron" size={18} /></button>
      </>}
      <div className="ma-bottom-caption">NGÔI SAO HOÀNG MAI <span>·</span> SUẤT ĂN</div>
    </main>
    <nav className="ma-bottom-nav" aria-label="Chức năng chính">{tabs.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} className={tab === item.id ? 'active' : ''} onClick={() => navigate(item.id)}><span><Icon name={item.icon} size={22} /></span><strong>{item.name}</strong></button>)}</nav>
    {modal && <dialog ref={dialogRef} className="ma-dialog" aria-labelledby="ma-dialog-title" onCancel={() => setModal(null)} onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className="ma-dialog-content"><div className="ma-dialog-header"><span className={`ma-tile-icon ${modal === 'link' ? 'ma-blue' : modal === 'survey' ? 'ma-orange' : 'ma-pink'}`}><Icon name={modal === 'link' ? 'shield' : modal === 'survey' ? 'star' : 'event'} /></span><button className="ma-icon-button" aria-label="Đóng hộp thoại" onClick={() => setModal(null)}><Icon name="close" /></button></div>
      {modal === 'link' && <AccountLinkPanel />}
      {modal === 'survey' && <><span className="ma-eyebrow">KHẢO SÁT MINH HỌA</span><h2 id="ma-dialog-title">Bạn thấy bữa ăn thế nào?</h2><p>Chia sẻ cảm nhận của bạn về thực đơn tuần 26–30/10.</p>{surveySubmitted ? <div className="ma-complete"><Icon name="check" size={28} /><strong>Đã ghi nhận phản hồi mẫu</strong><p>Nội dung chỉ nằm trong phiên xem này, chưa gửi tới Nhóm Dinh dưỡng.</p><button className="ma-primary" onClick={() => setModal(null)}>Hoàn tất</button></div> : <form onSubmit={event => { event.preventDefault(); if (rating) setSurveySubmitted(true); }}><fieldset className="ma-rating"><legend>Mức độ hài lòng</legend>{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} className={rating >= value ? 'selected' : ''} aria-label={`${value} sao`} aria-pressed={rating === value} onClick={() => setRating(value)}><Icon name="star" size={32} /></button>)}</fieldset><label className="ma-field">Góp ý thêm <span className="ma-optional">(không bắt buộc)</span><textarea maxLength={500} rows={3} placeholder="Điều bạn hài lòng hoặc mong muốn cải thiện..." value={feedback} onChange={event => setFeedback(event.target.value)} /></label><p className="ma-character-count">{feedback.length}/500 ký tự</p><button className="ma-primary" disabled={!rating} type="submit">Gửi phản hồi mẫu <Icon name="arrow" size={18} /></button></form>}</>}
      {modal === 'event' && <><span className="ma-eyebrow">SỰ KIỆN MINH HỌA</span><h2 id="ma-dialog-title">Bữa ăn gặp mặt<br />đầu tháng 11</h2><p>Đăng ký lựa chọn cho sự kiện mẫu. Ngày phục vụ minh họa: 02/11/2026.</p><div className="ma-event-choices"><button aria-pressed={eventChoice === 'yes'} className={eventChoice === 'yes' ? 'selected' : ''} onClick={() => setEventChoice('yes')}><Icon name="meal" /><strong>Có tham gia ăn</strong></button><button aria-pressed={eventChoice === 'no'} className={eventChoice === 'no' ? 'selected' : ''} onClick={() => setEventChoice('no')}><Icon name="calendar" /><strong>Không tham gia</strong></button></div><button className="ma-primary" disabled={!eventChoice} onClick={() => { setModal(null); notify('Đã ghi nhận lựa chọn sự kiện minh họa. Chưa tạo đăng ký thật.'); }}>Xác nhận lựa chọn mẫu</button></>}
    </div></dialog>}
  </div>;
}

function PageTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="ma-page-title"><p className="ma-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>;
}
