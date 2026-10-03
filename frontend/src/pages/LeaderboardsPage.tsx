import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { api, type FrontlineBoardSettings, type FrontlineCsoHistory, type FrontlineRankings } from '../lib/api';
import { leaderboardMaxMonth, manilaMonth, markLeaderboardSeen, shiftMonth } from '../lib/leaderboard';
import { useAuth } from '../lib/auth';

function lastDayOf(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, mon, 0)));
}

function monthLabel(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

function shortMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(year, mon - 1, 1)));
}

type Tab = 'award' | 'board';

// Exact A4 landscape at 96 CSS dpi. Sheets render at this fixed size and are
// scaled down for preview, so screen and PDF match edge-to-edge.
const A4_WIDTH_PX = 1122.52;
const A4_HEIGHT_PX = 793.7;

function A4Stage({ children }: { children: React.ReactNode }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const update = () => setScale(Math.min(1, wrap.clientWidth / A4_WIDTH_PX));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={wrapRef} className="w-full">
      <div className="relative mx-auto overflow-hidden rounded-3xl shadow-[0_24px_80px_rgba(0,0,0,0.10)]" style={{ height: A4_HEIGHT_PX * scale, width: A4_WIDTH_PX * scale }}>
        <div className="leaderboard-stage absolute left-0 top-0 origin-top-left overflow-hidden bg-white" style={{ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, transform: `scale(${scale})` }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

const NAVY = '#1e3a5f';

function Medallion({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 96 96" fill="none" aria-hidden="true">
      <circle cx="48" cy="48" r="45" stroke="#c9a927" strokeWidth="1.5" opacity="0.55" />
      <circle cx="48" cy="48" r="38" stroke="#c9a927" strokeWidth="1" opacity="0.4" />
      <circle cx="48" cy="48" r="30" fill="#faf8ef" stroke="#c9a927" strokeWidth="1.25" />
      <path d="M37 30h22v9c0 9-4.5 14-11 14s-11-5-11-14v-9z" fill={NAVY} />
      <path d="M37 33h-6.5c0 6.5 2.8 10.5 7.5 11.5M59 33h6.5c0 6.5-2.8 10.5-7.5 11.5" stroke="#c9a927" strokeWidth="3" strokeLinecap="round" />
      <path d="M48 53v7M42 64h12" stroke="#c9a927" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

function BrandLogo() {
  const [missing, setMissing] = useState(false);
  if (missing) return <span>Mobilcare The Podium</span>;
  return <img src="/assets/images/logo-mobilecare.png" alt="Mobilcare" className="h-10 w-auto" onError={() => setMissing(true)} />;
}

export default function LeaderboardsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roleName === 'Admin';
  const maxMonth = leaderboardMaxMonth();
  const [month, setMonth] = useState(maxMonth);
  const [tab, setTab] = useState<Tab>('award');
  const [data, setData] = useState<FrontlineRankings | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [awardFor, setAwardFor] = useState<string | null>(null);
  const [history, setHistory] = useState<FrontlineCsoHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pageVisible, setPageVisible] = useState(typeof document === 'undefined' ? true : !document.hidden);
  const [settings, setSettings] = useState<FrontlineBoardSettings>({ awardDate: '', signerName: '', signerTitle: '', showSignature: true });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState<FrontlineBoardSettings>(settings);
  const [saving, setSaving] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const isLiveMonth = month === manilaMonth();

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError('');
    try {
      const access = await api.frontline.access();
      setAllowed(access.allowed);
      if (access.allowed) {
        const [rankings, boardSettings] = await Promise.all([api.frontline.rankings(target), api.frontline.boardSettings()]);
        setData(rankings);
        setSettings(boardSettings);
        if (target === manilaMonth()) markLeaderboardSeen(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load leaderboards.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(month); }, [month, load]);

  // Rankings refresh only while this page is open: refetch on return, and freeze
  // the suspense animation while the tab is hidden.
  useEffect(() => {
    const onVisibility = () => {
      const visible = !document.hidden;
      setPageVisible(visible);
      if (visible) void load(month);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [month, load]);

  const openSettings = () => {
    setDraft(settings);
    setSettingsOpen(true);
  };

  const saveSettings = async () => {
    setSaving(true);
    setError('');
    try {
      setSettings(await api.frontline.saveBoardSettings(draft));
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const openProfile = async (name: string) => {
    setSelected(name);
    setHistory(null);
    setHistoryLoading(true);
    try {
      setHistory(await api.frontline.csoHistory(name, month));
    } catch {
      setHistory({ name, months: [] });
    } finally {
      setHistoryLoading(false);
    }
  };

  const downloadPdf = async () => {
    const root = sheetRef.current;
    if (!root || downloading) return;
    const stages = Array.from(root.querySelectorAll('.leaderboard-stage')).filter(
      (element): element is HTMLElement => element instanceof HTMLElement,
    );
    if (!stages.length) return;
    setDownloading(true);
    setError('');
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
      for (const [index, stage] of stages.entries()) {
        const canvas = await html2canvas(stage, {
          backgroundColor: '#ffffff',
          scale: 2,
          useCORS: true,
          logging: false,
          width: A4_WIDTH_PX,
          height: A4_HEIGHT_PX,
          onclone: (clonedDocument) => {
            // html2canvas cannot parse modern CSS color functions (oklab/oklch/lab/lch,
            // color()/color-mix()) emitted by Tailwind v4 — neutralize every color-bearing
            // property it reads so export never throws nor renders wrong colors.
            const bad = /(oklab|oklch|\blab\(|\blch\(|color-mix\(|color\()/i;
            const sanitize = (element: HTMLElement) => {
              const computed = clonedDocument.defaultView?.getComputedStyle(element);
              if (!computed) return;
              if (bad.test(computed.color)) element.style.color = '#1d1d1f';
              if (bad.test(computed.backgroundColor)) element.style.backgroundColor = '#ffffff';
              if (bad.test(computed.backgroundImage)) element.style.backgroundImage = 'none';
              (['borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'textDecorationColor', 'caretColor', 'columnRuleColor', 'fill', 'stroke'] as const).forEach((property) => {
                const value = String(computed.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)) || (computed as unknown as Record<string, string>)[property] || '');
                if (bad.test(value)) element.style.setProperty(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`), property === 'fill' ? '#c9a927' : '#e5e5e7');
              });
              if (bad.test(computed.boxShadow)) element.style.boxShadow = 'none';
              if (bad.test(computed.textShadow)) element.style.textShadow = 'none';
            };
            clonedDocument.querySelectorAll('.leaderboard-stage').forEach((root) => {
              if (!(root instanceof HTMLElement)) return;
              root.style.transform = 'none';
              sanitize(root);
              root.querySelectorAll('*').forEach((element) => {
                if (element instanceof HTMLElement) sanitize(element);
              });
            });
          },
        });
        if (index > 0) pdf.addPage('a4', 'landscape');
        // Stage aspect is exactly A4 landscape, so the page fills edge-to-edge.
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 297, 210, undefined, 'FAST');
      }
      pdf.save(`leaderboard-${tab}-${month}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate PDF.');
    } finally {
      setDownloading(false);
    }
  };

  if (allowed === false) {
    return (
      <div className="mx-auto w-full max-w-2xl rounded-2xl border border-[#e5e5e7] bg-white p-6 sm:p-7">
        <h1 className="text-[24px] font-semibold tracking-tight text-[#1d1d1f]">Leaderboards</h1>
        <p className="mt-2 text-[13px] text-[#6e6e73]">This data is restricted. Request Frontline Monitor access from an Admin to continue.</p>
        <Link to="/frontline" className="mt-4 inline-block text-[13px] font-medium text-[#0071e3] hover:underline">Back to Frontline Monitor</Link>
      </div>
    );
  }

  const champion = data?.overall[0] || null;
  const championDisplayName = champion && champion.name.length > 48 ? `${champion.name.slice(0, 47).trimEnd()}…` : champion?.name || '';
  const maxOverall = Math.max(1, ...(history?.months.map((m) => m.overall) || [1]));

  return (
    <div className={`mx-auto w-full max-w-[1200px]${pageVisible ? '' : ' leaderboard-paused'}`}>
      <div className="leaderboard-screen-only mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[12px] font-medium text-[#6e6e73]">
          <Link to="/" className="hover:text-[#1d1d1f]">Tools</Link>
          <span aria-hidden="true">›</span>
          <Link to="/frontline" className="hover:text-[#1d1d1f]">Frontline Monitor</Link>
          <span aria-hidden="true">›</span>
          <span className="text-[#1d1d1f]">Leaderboards</span>
        </nav>
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#d2d2d7] text-[14px] text-[#3c3c43] hover:bg-[#f5f5f7]">‹</button>
          <span className="min-w-[7.5rem] text-center text-[13px] font-semibold text-[#1d1d1f]">{monthLabel(month)}</span>
          <button type="button" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= maxMonth} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#d2d2d7] text-[14px] text-[#3c3c43] hover:bg-[#f5f5f7] disabled:opacity-30">›</button>
          <input type="month" value={month} max={maxMonth} onChange={(e) => { if (e.target.value && e.target.value <= maxMonth) setMonth(e.target.value); }} aria-label="Choose month" className="h-8 rounded-lg border border-[#d2d2d7] bg-white px-2 text-[12px] text-[#3c3c43] outline-none focus:border-[#8b8b93]" />
          <button type="button" onClick={() => void downloadPdf()} disabled={downloading || loading || !data} className="ml-1 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[#1d1d1f] px-4 text-[12px] font-semibold text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-40">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
            {downloading ? 'Preparing…' : 'Download PDF'}
          </button>
          {isAdmin && (
            <button type="button" onClick={openSettings} aria-label="Leaderboard settings" title="Leaderboard settings" className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-[#d2d2d7] text-[#3c3c43] hover:bg-[#f5f5f7]">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="leaderboard-screen-only mb-4 flex justify-center print:hidden" role="tablist" aria-label="Leaderboard views">
        <div className="inline-flex rounded-full bg-[#e8e8ed] p-1">
          {(['award', 'board'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`h-8 cursor-pointer rounded-full px-5 text-[13px] font-medium transition-colors ${tab === value ? 'bg-white text-[#1d1d1f] shadow-sm' : 'text-[#6e6e73] hover:text-[#1d1d1f]'}`}
            >
              {value === 'award' ? 'Award' : 'Leaderboard'}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mb-4 text-[13px] text-[#b91c1c]">{error}</p>}

      {tab === 'board' ? (
        <div ref={sheetRef} className="leaderboard-print-root space-y-5">
          {loading && !data ? (
            <A4Stage>
              <div className="flex h-full flex-col px-16 py-12" aria-label="Loading rankings">
                <div className="h-6 w-64 animate-pulse rounded bg-[#f0f0f2]" />
                <div className="mt-8 flex-1 space-y-3">
                  {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-[#f0f0f2]" />)}
                </div>
              </div>
            </A4Stage>
          ) : data && data.all.length ? (
            chunk(data.all, 9).map((rows, page, pages) => (
              <A4Stage key={page}>
                <div className="flex h-full flex-col bg-white p-2">
                  <div className="flex flex-1 flex-col px-12 py-6">
                    <div className="mt-3 flex items-end justify-between">
                      <div>
                        <p className="text-[12px] font-medium uppercase tracking-[0.3em] text-[#c9a927]">Mobilcare The Podium</p>
                        <h1 className="mt-2 text-[28px] font-semibold tracking-tight text-[#1d1d1f]">Overall rankings</h1>
                      </div>
                      <div className="text-right">
                        <p className="text-[14px] font-semibold text-[#1e3a5f]">{monthLabel(month)}</p>
                        <p className="mt-0.5 text-[12px] tabular-nums text-[#6e6e73]">{data.total.toLocaleString()} assists · {data.csoCount} {data.csoCount === 1 ? 'CSO' : 'CSOs'}</p>
                      </div>
                    </div>
                  <ol className="mt-6 flex-1">
                    {rows.map((entry, rowIndex) => {
                      const index = page * 9 + rowIndex;
                      const top = data.all[0]?.count || 1;
                      return (
                        <li key={entry.name}>
                          <button type="button" onClick={() => void openProfile(entry.name)} disabled={isLiveMonth} className={`flex w-full items-center gap-5 py-2.5 text-left ${isLiveMonth ? 'cursor-default' : 'cursor-pointer hover:bg-[#fafafa]'}`} aria-label={isLiveMonth ? `${entry.name}, rank ${index + 1}` : `View ${entry.name} history`} aria-disabled={isLiveMonth}>
                            <span className="w-12 shrink-0 text-[26px] font-light tabular-nums text-[#c7c7cc]">{String(index + 1).padStart(2, '0')}</span>
                            <span className={`min-w-0 flex-1 truncate text-[20px] font-semibold ${isLiveMonth ? 'text-[#86868b]' : 'text-[#1d1d1f]'}`}>{isLiveMonth ? 'Revealed at month-end' : entry.name}</span>
                            <span className="hidden h-1.5 w-44 shrink-0 overflow-hidden rounded-full bg-[#f0f0f2] sm:block" aria-hidden="true">
                              <span className="block h-full rounded-full bg-[#c9a927]" style={{ width: `${Math.max(3, (entry.count / top) * 100)}%` }} />
                            </span>
                            <span className="w-20 shrink-0 text-right text-[18px] font-medium tabular-nums text-[#1d1d1f]">{entry.count.toLocaleString()}</span>
                            <span className="w-16 shrink-0 text-right text-[14px] tabular-nums text-[#6e6e73]">{entry.share}%</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="mt-3 flex items-center justify-center text-[11px] text-[#86868b]">
                    <span>{isLiveMonth ? 'Suspense mode — names revealed at month-end' : 'Tap a name on screen for past months'}{pages.length > 1 ? ` · ${page + 1} of ${pages.length}` : ''}</span>
                  </div>
                  </div>
                </div>
              </A4Stage>
            ))
          ) : (
            <A4Stage>
              <div className="flex h-full flex-col items-center justify-center px-16 text-center">
                <p className="text-[12px] font-medium uppercase tracking-[0.3em] text-[#c9a927]">Mobilcare The Podium</p>
                <p className="mt-4 text-[26px] font-semibold text-[#1d1d1f]">No records for {monthLabel(month)} yet.</p>
              </div>
            </A4Stage>
          )}
        </div>
      ) : (
        <div ref={sheetRef} className="leaderboard-print-root">
          <A4Stage>
            <div className="flex h-full flex-col border border-[#c9a927]/50 bg-white p-2">
              <div className="flex flex-1 flex-col border border-[#e5e5e7] px-12 py-7 text-center">
                <div className="flex items-center justify-center">
                  <BrandLogo />
                </div>
                <h1 className="mx-auto mt-12 w-full text-center text-[48px] font-semibold leading-none tracking-tight text-[#1e3a5f]">Certificate of Recognition</h1>
              {loading && !data ? (
                <div className="flex flex-1 items-center justify-center" aria-label="Loading leaderboard">
                  <div className="w-full max-w-md animate-pulse space-y-4">
                    <div className="mx-auto h-5 w-56 rounded bg-[#f0f0f2]" />
                    <div className="mx-auto h-16 w-3/4 rounded-xl bg-[#f0f0f2]" />
                    <div className="mx-auto h-4 w-1/2 rounded bg-[#f0f0f2]" />
                  </div>
                </div>
              ) : champion && data ? (
                <div className="flex flex-1 flex-col items-center justify-center">
                  <div className="mt-5 flex justify-center" aria-hidden="true">
                    <span className="relative flex h-20 w-20 items-center justify-center">
                      {isLiveMonth && <span className="leaderboard-ping absolute inline-flex h-full w-full rounded-full bg-[#c9a927]/25" />}
                      <Medallion className="relative h-16 w-16" />
                    </span>
                  </div>
                  <p className="mt-5 flex items-center justify-center gap-4 text-[19px] font-bold uppercase tracking-[0.24em] text-[#c9a927]">
                    <span className="h-px w-16 bg-[#c9a927]/60" aria-hidden="true" />
                    CSO of the Month{isLiveMonth ? ' · race live' : ''}
                    <span className="h-px w-16 bg-[#c9a927]/60" aria-hidden="true" />
                  </p>
                  {isLiveMonth ? (
                    <>
                      <div className="mt-5 h-14 w-[420px] max-w-full overflow-hidden rounded-2xl bg-[#f0f0f2]" role="status" aria-label="Winner hidden until month-end">
                        <div className="leaderboard-shimmer h-full w-full" />
                      </div>
                      <p className="mx-auto mt-6 max-w-3xl text-balance text-[18px] leading-relaxed text-[#3c3c43]">
                        The {monthLabel(month)} race is live — <strong className="font-semibold text-[#1d1d1f]">{data.total.toLocaleString()} assists</strong> across{' '}
                        <strong className="font-semibold text-[#1d1d1f]">{data.csoCount} {data.csoCount === 1 ? 'CSO' : 'CSOs'}</strong> so far. Winner revealed at month-end.
                      </p>
                    </>
                  ) : (
                    <>
                        <button type="button" onClick={() => setAwardFor(champion.name)} className="mx-auto mt-5 block max-w-full cursor-pointer break-words text-center text-[40px] font-semibold leading-[1.12] tracking-tight text-[#1d1d1f] hover:opacity-80" aria-label={`Open award for ${champion.name}`}>
                          {championDisplayName}
                        </button>
                      <p className="mx-auto mt-6 max-w-3xl text-balance text-[18px] leading-relaxed text-[#3c3c43]">
                        Led {data.csoCount} {data.csoCount === 1 ? 'CSO' : 'CSOs'} with <strong className="font-semibold text-[#1d1d1f]">{champion.count.toLocaleString()} assists</strong> —{' '}
                        <strong className="font-semibold text-[#1d1d1f]">{champion.share}%</strong> of {monthLabel(month)}&rsquo;s {data.total.toLocaleString()} assists. Through
                        consistent dedication and outstanding frontline service, {champion.name} set the standard for the whole team this month. Congratulations on this
                        well-deserved recognition!
                      </p>
                    </>
                  )}
                  {settings.showSignature && (
                    <div className="mx-auto mt-7 grid w-full max-w-xl grid-cols-2 gap-12">
                      <div className="text-center">
                        <p className="border-b border-[#8b8b93] pb-1.5 text-[15px] font-medium tabular-nums text-[#1d1d1f]">{settings.awardDate || lastDayOf(month)}</p>
                        <p className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[#86868b]">Date</p>
                      </div>
                      <div className="text-center">
                        <p className="border-b border-[#8b8b93] pb-1.5 text-[15px] font-medium text-[#1d1d1f]">{settings.signerName || ' '}</p>
                        <p className="mt-1.5 text-[10px] uppercase tracking-[0.2em] text-[#86868b]">Name</p>
                        {settings.signerTitle && <p className="mt-0.5 text-[10px] text-[#86868b]">{settings.signerTitle}</p>}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-1 items-center justify-center">
                  <p className="max-w-xl text-[20px] leading-relaxed text-[#6e6e73]">No records for {monthLabel(month)} yet — honors unlock once assists are logged.</p>
                </div>
              )}
                <div className="mt-5 flex items-center justify-center gap-3 text-[11px] text-[#86868b]">
                  <span className="h-px w-12 bg-[#e5e5e7]" aria-hidden="true" />
                  Monthly honors · Overall · Mobilcare The Podium
                  <span className="h-px w-12 bg-[#e5e5e7]" aria-hidden="true" />
                </div>
              </div>
            </div>
          </A4Stage>
        </div>
      )}

      {settingsOpen && isAdmin && (
        <div className="leaderboard-screen-only fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4 print:hidden" role="dialog" aria-modal="true" aria-label="Leaderboard settings">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#e5e5e7] px-5 py-4">
              <div>
                <h3 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">Certificate settings</h3>
                <p className="mt-0.5 text-[12px] text-[#6e6e73]">Admin only · shown on the award certificate and PDF</p>
              </div>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings" className="cursor-pointer text-[22px] leading-none text-[#6e6e73]">×</button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <label className="block text-[12px] font-medium text-[#1d1d1f]">Award date
                <input value={draft.awardDate} onChange={(e) => setDraft({ ...draft, awardDate: e.target.value })} placeholder={lastDayOf(month)} maxLength={50} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] px-3 text-[13px] outline-none focus:border-[#8b8b93]" />
              </label>
              <label className="block text-[12px] font-medium text-[#1d1d1f]">Signer name
                <input value={draft.signerName} onChange={(e) => setDraft({ ...draft, signerName: e.target.value })} placeholder="e.g. Juan Dela Cruz" maxLength={150} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] px-3 text-[13px] outline-none focus:border-[#8b8b93]" />
              </label>
              <label className="block text-[12px] font-medium text-[#1d1d1f]">Signer title
                <input value={draft.signerTitle} onChange={(e) => setDraft({ ...draft, signerTitle: e.target.value })} placeholder="e.g. Podium Manager" maxLength={150} className="mt-1.5 h-10 w-full rounded-xl border border-[#d2d2d7] px-3 text-[13px] outline-none focus:border-[#8b8b93]" />
              </label>
              <div className="flex items-center justify-between rounded-xl bg-[#fafafa] px-3.5 py-3">
                <span className="text-[13px] font-medium text-[#1d1d1f]">Date & name block</span>
                <button type="button" role="switch" aria-checked={draft.showSignature} aria-label="Show date and name block" onClick={() => setDraft({ ...draft, showSignature: !draft.showSignature })} className={`relative h-7 w-12 cursor-pointer rounded-full transition-colors ${draft.showSignature ? 'bg-[#1d1d1f]' : 'bg-[#d2d2d7]'}`}>
                  <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${draft.showSignature ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setSettingsOpen(false)} disabled={saving} className="h-9 cursor-pointer rounded-full px-4 text-[12px] font-medium text-[#1d1d1f] hover:bg-[#f5f5f7] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={() => void saveSettings()} disabled={saving} className="h-9 cursor-pointer rounded-full bg-[#1d1d1f] px-5 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-40">{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {awardFor && champion && (
        <div className="leaderboard-screen-only fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4 print:hidden" role="dialog" aria-modal="true" aria-label={`Award for ${awardFor}`}>
          <div className="w-full max-w-lg overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="m-3 rounded-2xl border border-[#c9a927]/50 p-1.5">
              <div className="rounded-xl border border-[#e5e5e7] px-6 py-8 text-center">
                <div className="mx-auto flex justify-center" aria-hidden="true">
                  <Medallion className="h-16 w-16" />
                </div>
                <p className="mt-4 text-[26px] font-semibold tracking-tight text-[#1d1d1f] sm:text-[30px]">Congratulations, {awardFor}!</p>
                <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-[#c9a927]">CSO of the Month · {monthLabel(month)}</p>
                <p className="mx-auto mt-4 max-w-md text-[14px] leading-relaxed text-[#3c3c43]">
                  With <strong className="font-semibold text-[#1d1d1f]">{champion.count.toLocaleString()} assists</strong> —{' '}
                  <strong className="font-semibold text-[#1d1d1f]">{champion.share}%</strong> of the month&rsquo;s {data?.total.toLocaleString()} assists — you set the standard for the frontline team. Thank you for the outstanding service!
                </p>
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button type="button" onClick={() => { setAwardFor(null); void openProfile(awardFor); }} className="inline-flex h-9 cursor-pointer items-center rounded-full border border-[#d2d2d7] px-4 text-[12px] font-medium text-[#3c3c43] hover:bg-[#f5f5f7]">View past months</button>
                  <button type="button" onClick={() => setAwardFor(null)} className="inline-flex h-9 cursor-pointer items-center rounded-full bg-[#1d1d1f] px-5 text-[12px] font-semibold text-white hover:bg-black">Done</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <div className="leaderboard-screen-only fixed inset-0 z-40 flex items-center justify-center bg-black/20 p-4 print:hidden" role="dialog" aria-modal="true" aria-label={`${selected} monthly history`}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#e5e5e7] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-[#e5e5e7] px-5 py-4">
              <div>
                <h3 className="text-[17px] font-semibold tracking-tight text-[#1d1d1f]">{selected}</h3>
                <p className="mt-0.5 text-[12px] text-[#6e6e73]">Past 6 months · overall assists</p>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Close history" className="cursor-pointer text-[22px] leading-none text-[#6e6e73]">×</button>
            </div>
            <div className="px-5 py-4">
              {historyLoading || !history ? (
                <div className="flex items-end gap-2" aria-label="Loading history">
                  {[40, 65, 30, 80, 55, 70].map((h, i) => <div key={i} className="w-full animate-pulse rounded-t-md bg-[#f0f0f2]" style={{ height: `${h}px` }} />)}
                </div>
              ) : history.months.length ? (
                <>
                  <div className="flex h-28 items-end gap-2">
                    {history.months.map((m) => (
                      <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                        <span className="text-[11px] font-semibold tabular-nums text-[#1d1d1f]">{m.overall}</span>
                        <div className="flex w-full flex-1 items-end rounded-md bg-[#f5f5f7]">
                          <div className="w-full rounded-md bg-[#1d1d1f]" style={{ height: `${Math.max(6, (m.overall / maxOverall) * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-[#6e6e73]">{shortMonth(m.month)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-lg bg-[#fafafa] px-2 py-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-[#6e6e73]">6-month overall total</p>
                    <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-[#1d1d1f]">{history.months.reduce((s, m) => s + m.overall, 0).toLocaleString()}</p>
                  </div>
                  <p className="mt-3 text-center text-[11px] text-[#6e6e73]">6 months ending {monthLabel(month)}</p>
                </>
              ) : (
                <p className="py-6 text-center text-[13px] text-[#6e6e73]">No history available.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
