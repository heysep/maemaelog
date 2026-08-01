import { useEffect, useMemo, useRef, useState } from 'react';
import {
  computeStats,
  EMOTIONS,
  formatQty,
  formatPnlHeadline,
  formatSigned,
  formatWon,
  monthReturnRate,
  type Side,
  type Trade,
} from './core/journal';
import { analyzeHabits, type HabitReport } from './core/insight';
import { parseTradeText, type ParsedTrade } from './core/ocrParse';
import { buildStatsPayload } from './core/statsPayload';
import { ANALYSIS_ENDPOINT, requestAiAnalysis, type AiReport } from './api/analysis';
import {
  adsRemoved,
  canAddRecord,
  consumeInsight,
  dailyInsightLimit,
  FREE_RECORD_LIMIT,
  isActive,
  remainingInsights,
  type Entitlements,
} from './core/limits';
import { wipeAllData } from './core/wipe';
import { isLoginSupported, loadAuthConnected, loginWithToss, logout } from './auth/tossLogin';
import { decideOcrGate, passAfterAd } from './core/ocrGate';
import { loadTrades, saveTrades } from './core/storage';
import {
  grantEntitlement,
  loadEntitlements,
  loadInsightCounter,
  loadOcrPass,
  saveInsightCounter,
  saveOcrPass,
} from './iap/entitlements';
import { entKeyForSku, PRODUCTS } from './iap/products';
import { ensureIapModule, isIapSupported, purchase } from './iap/purchase';
import { makeThumbnail, recognizeImage, warmupOcr, type OcrError } from './ocr/ocr';
import { showRewardedAd } from './ads/rewarded';
import { BannerAd } from './ads/BannerAd';
import { AD_GROUP_ID, REWARDED_AD_ID } from './ads/config';
import { EmotionIcon, IconCamera, IconChart, IconHome, IconInfo, IconList, IconPen, IconTrash, IconUser } from './components/icons';

type Tab = 'home' | 'write' | 'stats' | 'me';
type OcrState = 'idle' | 'gate' | 'ad' | 'running' | 'done' | 'failed';

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [trades, setTrades] = useState<Trade[]>(() => loadTrades());
  const [ent, setEnt] = useState<Entitlements>(() => loadEntitlements());

  // ---- 입력 폼 상태 ----
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<Side>('buy');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [date, setDate] = useState(todayStr);
  const [time, setTime] = useState('');
  const [memo, setMemo] = useState('');
  const [emotion, setEmotion] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // ---- OCR 골라 넣기 ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [ocrState, setOcrState] = useState<OcrState>('idle');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState<OcrError | null>(null);
  const [parsedPreview, setParsedPreview] = useState<ParsedTrade | null>(null);

  // ---- 목록/통계 ----
  const [filterSymbol, setFilterSymbol] = useState('전체');
  const [showAllList, setShowAllList] = useState(false);
  const [statsView, setStatsView] = useState<'stats' | 'insight'>('stats');
  const [report, setReport] = useState<HabitReport | null>(null);
  const [aiReport, setAiReport] = useState<AiReport | null>(null);
  const [reportMode, setReportMode] = useState<'ai' | 'offline' | 'local'>('local');
  const [analyzing, setAnalyzing] = useState(false);
  const [insightNotice, setInsightNotice] = useState('');
  const [iapNotice, setIapNotice] = useState('');
  const [buying, setBuying] = useState('');

  // ---- 내정보 ----
  const [authConnected, setAuthConnected] = useState(() => loadAuthConnected());
  const [loginSupported, setLoginSupported] = useState(false);
  const [loginNotice, setLoginNotice] = useState('');
  const [showWipeSheet, setShowWipeSheet] = useState(false);
  useEffect(() => {
    void isLoginSupported().then(setLoginSupported).catch(() => setLoginSupported(false));
  }, []);

  // 입력 탭 첫 진입 시 OCR 언어 데이터 백그라운드 프리로드(최초 1회 지연 완화)
  useEffect(() => {
    if (tab === 'write') warmupOcr();
  }, [tab]);

  const now = new Date();
  const todayKey = todayStr();
  const stats = useMemo(() => computeStats(trades), [trades]);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const noAds = adsRemoved(ent, now);
  const insightLeft = remainingInsights(loadInsightCounter(), ent, now, todayKey);
  const insightLimit = dailyInsightLimit(ent, now);
  const insightUsedToday = insightLimit - insightLeft;
  const hasUnlimited = isActive(ent, 'pro', now) || isActive(ent, 'records', now);
  const monthSavedCount = trades.filter((t) => t.date.startsWith(todayKey.slice(0, 7))).length;
  const ocrReady = decideOcrGate(loadOcrPass(), ent, now, todayKey, REWARDED_AD_ID) === 'allow';
  const recordOk = canAddRecord(trades.length, ent, now);
  const [iapAvailable, setIapAvailable] = useState(false);
  useEffect(() => {
    void ensureIapModule().then(() => setIapAvailable(isIapSupported()));
  }, []);

  const priceNum = Number(price);
  const qtyNum = Number(qty);
  const canSave =
    recordOk &&
    symbol.trim() !== '' &&
    Number.isFinite(priceNum) && priceNum > 0 &&
    Number.isFinite(qtyNum) && qtyNum > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  const persist = (next: Trade[]) => {
    setTrades(next);
    if (!saveTrades(next)) setNotice('저장 공간이 가득 차 저장하지 못했어요. 오래된 기록을 지워 주세요.');
  };

  const resetForm = () => {
    setSymbol(''); setPrice(''); setQty(''); setMemo(''); setEmotion(''); setTime('');
    setThumb(null); setImageFile(null); setOcrState('idle'); setOcrProgress(0); setParsedPreview(null);
    setDate(todayStr());
    if (fileRef.current) fileRef.current.value = '';
  };

  const addTrade = () => {
    if (!canSave) return;
    setNotice('');
    const t: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: symbol.trim(),
      side,
      price: Math.round(priceNum),
      qty: Math.round(qtyNum * 1e6) / 1e6, // 소수점 주식 허용(소수 6자리)
      date,
      ...(time !== '' ? { time } : {}),
      memo: memo.trim(),
      emotion,
      ...(thumb ? { thumb } : {}),
    };
    persist([...trades, t]);
    resetForm();
    setReport(null);
    setAiReport(null);
    setTab('home');
  };

  const removeTrade = (id: string) => {
    persist(trades.filter((t) => t.id !== id));
    setReport(null);
    setAiReport(null);
  };

  /** 이미지 선택 즉시: 썸네일 → (필요 시 광고 게이트 1회) → OCR 자동 시작 */
  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setParsedPreview(null);
    setOcrState('idle');
    const t = await makeThumbnail(file);
    setThumb(t);
    if (t === null) setNotice('이미지가 너무 크거나 읽을 수 없어 첨부 없이 기록돼요.');
    else setNotice('');
    // 오늘 패스가 있거나 광고 미설정이면 완전 무마찰로 바로 인식 시작
    const decision = decideOcrGate(loadOcrPass(), ent, now, todayKey, REWARDED_AD_ID);
    if (decision === 'allow') void runOcr(file);
    else setOcrState('gate');
  };

  const watchAdThenOcr = async () => {
    if (!imageFile) return;
    setOcrState('ad');
    // 광고 로드/재생 실패 시에도 통과시킨다(사용자를 벌주지 않기)
    const result = await showRewardedAd(REWARDED_AD_ID);
    saveOcrPass(passAfterAd(result, todayKey));
    await runOcr(imageFile);
  };

  /** OCR → 파싱 → 인식된 것만 자동 채움 + 누락 필드로 포커스 이동 */
  const runOcr = async (file: File) => {
    setOcrState('running');
    setOcrProgress(0);
    setOcrError(null);
    const result = await recognizeImage(file, (p) => setOcrProgress(p));
    if (!result.ok) {
      setOcrError(result.error);
      setOcrState('failed');
      return;
    }
    const parsed = parseTradeText(result.text);
    if (parsed.symbol !== undefined) setSymbol(parsed.symbol);
    if (parsed.side !== undefined) setSide(parsed.side);
    if (parsed.price !== undefined) setPrice(String(parsed.price));
    if (parsed.qty !== undefined) setQty(String(parsed.qty));
    if (parsed.date !== undefined) setDate(parsed.date);
    if (parsed.time !== undefined) setTime(parsed.time);
    const anyFilled =
      parsed.symbol !== undefined || parsed.price !== undefined || parsed.qty !== undefined || parsed.side !== undefined;
    if (!anyFilled) {
      setOcrError('image');
      setOcrState('failed');
      return;
    }
    setParsedPreview(parsed);
    setOcrState('done');
    // 누락 필드로 포커스 이동 — 이어서 수동 입력
    const missing = parsed.symbol === undefined ? 'f-symbol' : parsed.price === undefined ? 'f-price' : parsed.qty === undefined ? 'f-qty' : null;
    if (missing !== null) setTimeout(() => document.getElementById(missing)?.focus(), 50);
  };

  const runInsight = async () => {
    if (analyzing) return;
    setInsightNotice('');
    const counter = loadInsightCounter();
    const left = remainingInsights(counter, ent, new Date(), todayKey);
    if (left <= 0) {
      setInsightNotice('오늘 분석 횟수를 다 썼어요. 내일 다시 하거나 프로로 하루 3회까지 쓸 수 있어요.');
      return;
    }
    const tier: 'free' | 'pro' = isActive(ent, 'pro', new Date()) ? 'pro' : 'free';
    if (ANALYSIS_ENDPOINT !== '') {
      setAnalyzing(true);
      const r = await requestAiAnalysis(buildStatsPayload(trades), { authConnected, tier });
      setAnalyzing(false);
      if (r.status === 'ok') {
        // 서버 used/limit을 로컬 카운터에 동기화(내정보 이용 현황 반영)
        saveInsightCounter({ date: todayKey, used: r.used });
        setAiReport(r.report);
        setReport(null);
        setReportMode('ai');
        return;
      }
      if (r.status === 'limit') {
        saveInsightCounter({ date: todayKey, used: r.limit });
        setInsightNotice('오늘 AI 분석 한도를 다 썼어요. 프로 이용권으로 하루 3회까지 쓸 수 있어요.');
        return;
      }
      if (r.status === 'few') {
        setInsightNotice('AI 분석은 기록 3건부터 가능해요. 조금만 더 쌓아 볼까요?');
        return;
      }
      // 서버 불가(503/네트워크) → 규칙 엔진 폴백 + "오프라인 분석" 배지
      saveInsightCounter(consumeInsight(counter, todayKey));
      setAiReport(null);
      setReport(analyzeHabits(trades));
      setReportMode('offline');
      return;
    }
    saveInsightCounter(consumeInsight(counter, todayKey));
    setAiReport(null);
    setReport(analyzeHabits(trades));
    setReportMode('local');
  };

  const buy = async (sku: string) => {
    if (buying !== '') return;
    setBuying(sku);
    setIapNotice('');
    const result = await purchase(sku);
    if (result === 'success') {
      const key = entKeyForSku(sku);
      if (key !== null) setEnt(grantEntitlement(key, new Date()));
      setIapNotice('결제가 완료됐어요. 바로 적용돼요.');
    } else if (result === 'unsupported') {
      setIapNotice('결제는 토스 앱 안에서만 가능해요.');
    } else {
      setIapNotice('결제가 완료되지 않았어요. 잠시 후 다시 시도해 주세요.');
    }
    setBuying('');
  };

  const doLogin = async () => {
    setLoginNotice('');
    const r = await loginWithToss();
    if (r === 'success') setAuthConnected(true);
    else if (r === 'unsupported') setLoginNotice('토스 로그인은 토스 앱 안에서만 가능해요.');
    else setLoginNotice('로그인이 완료되지 않았어요. 잠시 후 다시 시도해 주세요.');
  };

  const doLogout = () => {
    logout();
    setAuthConnected(false);
  };

  const doWipe = () => {
    wipeAllData();
    setTrades([]);
    setEnt({});
    setAuthConnected(false);
    setReport(null);
    setAiReport(null);
    setReportMode('local');
    setShowWipeSheet(false);
    setFilterSymbol('전체');
    setShowAllList(false);
    resetForm();
    setTab('home');
  };

  const sortedDesc = useMemo(
    () => [...trades].reverse().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [trades]
  );
  const recent5 = sortedDesc.slice(0, 5);
  const listTrades = useMemo(
    () => (filterSymbol === '전체' ? sortedDesc : sortedDesc.filter((t) => t.symbol === filterSymbol)),
    [sortedDesc, filterSymbol]
  );

  const thisMonth = todayKey.slice(0, 7);
  const monthStat = stats.byMonth.find((m) => m.month === thisMonth) ?? { month: thisMonth, realized: 0, costBasis: 0 };
  const monthRate = monthReturnRate(monthStat);
  const monthSells = useMemo(() => {
    let total = 0, win = 0, loss = 0;
    for (const t of trades) {
      if (t.side !== 'sell' || !t.date.startsWith(thisMonth)) continue;
      const pnl = stats.pnlByTradeId[t.id];
      if (pnl === undefined) continue;
      total += 1;
      if (pnl > 0) win += 1;
      else if (pnl < 0) loss += 1;
    }
    return { total, win, loss };
  }, [trades, stats, thisMonth]);

  const renderTradeRow = (t: Trade, withDelete: boolean) => {
    const pnl = stats.pnlByTradeId[t.id];
    return (
      <article key={t.id} className="trade-item">
        {t.thumb && <img className="trade-thumb" src={t.thumb} alt={`${t.symbol} 체결 스크린샷`} />}
        <div className="trade-main">
          <div className="trade-top">
            <span className="trade-symbol">{t.symbol}</span>
            <span className={`badge ${t.side}`}>{t.side === 'buy' ? '매수' : '매도'}</span>
            {t.emotion !== '' && <span className="badge emo"><EmotionIcon emotion={t.emotion} size={13} />{t.emotion}</span>}
            {t.side === 'sell' && pnl !== undefined && (
              <span className={`badge ${pnl > 0 ? 'pnl-up' : pnl < 0 ? 'pnl-down' : 'emo'}`}>{formatSigned(pnl)}</span>
            )}
          </div>
          <p className="trade-detail">{formatWon(t.price)} · {formatQty(t.qty)}주</p>
          {t.memo !== '' && <p className="trade-memo">{t.memo}</p>}
          <p className="trade-date">{t.date}{t.time ? ` ${t.time}` : ''}</p>
        </div>
        {withDelete && (
          <button className="trade-del" onClick={() => removeTrade(t.id)} aria-label={`${t.symbol} 기록 삭제`}>
            <IconTrash size={20} />
          </button>
        )}
      </article>
    );
  };

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-badge"><IconChart size={22} /></div>
        <div>
          <h1 className="hdr-title">주식 매매일지</h1>
          <p className="hdr-sub">매매 이유와 감정까지 남기는 나만의 기록장</p>
        </div>
      </header>

      {tab === 'home' && (
        <>
          <section className="stat-hero">
            <div className="stat-hero-top">
              <span className="stat-hero-label">{Number(thisMonth.slice(5, 7))}월 수익 (수수료·세금 미반영)</span>
              <button
                className="hero-link"
                onClick={() => { setStatsView('insight'); setTab('stats'); }}
              >
                분석 보기 ›
              </button>
            </div>
            <span className={`stat-hero-value ${monthStat.realized > 0 ? 'up' : monthStat.realized < 0 ? 'down' : ''}`}>
              {formatPnlHeadline(monthStat.realized)}
            </span>
            <span className="stat-hero-sub">
              총 {monthSells.total}건 · 수익 {monthSells.win}건 · 손실 {monthSells.loss}건
            </span>
            <span className="stat-hero-sub">
              수익률 {monthRate === null ? '—' : `${monthRate > 0 ? '+' : ''}${monthRate}%`} · 승률{' '}
              {stats.winRate === null ? '—' : `${stats.winRate}%`}
            </span>
          </section>

          {trades.length === 0 && (
            <button className="panel empty-card" onClick={() => setTab('write')}>
              <span className="empty-title">첫 매매를 기록해보세요</span>
              <span className="empty-sub">기록 탭에서 오늘의 매매를 추가할 수 있어요</span>
            </button>
          )}

          {trades.length > 0 && (
          <section className="panel">
            <h2 className="panel-title"><IconList size={18} />최근 매매 5건</h2>
            <div className="list">
              {recent5.map((t) => renderTradeRow(t, false))}
            </div>
            {trades.length > 0 && (
              <button className="btn-ghost" onClick={() => setShowAllList(!showAllList)}>
                {showAllList ? '전체 기록 접기' : `전체 기록 보기 (${trades.length}건)`}
              </button>
            )}
            {showAllList && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="f-filter">종목 필터</label>
                  <select id="f-filter" className="field-input" value={filterSymbol} onChange={(e) => setFilterSymbol(e.target.value)}>
                    <option value="전체">전체</option>
                    {symbols.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="list">{listTrades.map((t) => renderTradeRow(t, true))}</div>
              </>
            )}
          </section>
          )}

          {!noAds && <BannerAd adGroupId={AD_GROUP_ID} />}
        </>
      )}

      {tab === 'write' && (
        <section className="panel">
          <h2 className="panel-title"><IconPen size={18} />매매 기록 남기기</h2>

          {!recordOk && (
            <p className="notice">
              무료로는 기록을 {FREE_RECORD_LIMIT}건까지 저장할 수 있어요. 통계 탭의 이용권으로 무제한으로 쓸 수 있어요.
            </p>
          )}

          <div className="seg" role="group" aria-label="매수 매도 구분">
            <button className={`seg-btn buy ${side === 'buy' ? 'on' : ''}`} onClick={() => setSide('buy')}>매수</button>
            <button className={`seg-btn sell ${side === 'sell' ? 'on' : ''}`} onClick={() => setSide('sell')}>매도</button>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="f-symbol">종목명</label>
            <input
              id="f-symbol"
              className="field-input"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="예: 삼성전자"
            />
          </div>

          <div className="row2">
            <div className="field">
              <label className="field-label" htmlFor="f-price">단가(원)</label>
              <input
                id="f-price"
                className="field-input"
                inputMode="numeric"
                value={price}
                onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="72000"
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="f-qty">수량(주)</label>
              <input
                id="f-qty"
                className="field-input"
                inputMode="decimal"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="10 (소수점 가능)"
              />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label className="field-label" htmlFor="f-date">매매 날짜</label>
              <input id="f-date" className="field-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="f-time">시각(선택)</label>
              <input id="f-time" className="field-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <span className="field-label">그때의 감정</span>
            <div className="chips">
              {EMOTIONS.map((e) => (
                <button
                  key={e}
                  className={`chip ${emotion === e ? 'on' : ''}`}
                  onClick={() => setEmotion(emotion === e ? '' : e)}
                >
                  <EmotionIcon emotion={e} size={17} />{e}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="f-memo">매매 이유 메모</label>
            <textarea
              id="f-memo"
              className="field-input"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="왜 샀는지, 왜 팔았는지 한 줄이라도 남겨두면 다음 매매가 달라져요"
            />
          </div>

          <div className="ocr-box">
            <input
              ref={fileRef}
              id="f-image"
              type="file"
              accept="image/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            <button className="btn-ghost" onClick={() => fileRef.current?.click()}>
              <IconCamera size={20} />체결 스크린샷 첨부
            </button>
            {thumb && <img className="ocr-thumb" src={thumb} alt="첨부한 체결 스크린샷 미리보기" />}
            {ocrState === 'gate' && (
              <div className="gate-sheet">
                <p className="ocr-note">영상 광고를 한 번 보면 오늘 하루 종일 스크린샷 인식을 무료로 쓸 수 있어요.</p>
                <button className="btn-primary" onClick={() => void watchAdThenOcr()}>영상 광고 보고 오늘 하루 무료로 쓰기</button>
                <button className="btn-ghost" onClick={() => setOcrState('idle')}>다음에 할게요(직접 입력)</button>
              </div>
            )}
            {ocrState === 'ad' && <p className="ocr-status">광고 재생 중…</p>}
            {ocrState === 'running' && (
              <p className="ocr-status">
                {ocrProgress > 0 ? `인식 중… ${Math.round(ocrProgress * 100)}%` : '문자 인식기를 준비하고 있어요(최초 1회는 조금 걸려요)…'}
              </p>
            )}
            {ocrState === 'failed' && (
              <p className="ocr-status ocr-fail">
                {ocrError === 'unsupported'
                  ? '이 환경에서는 문자 인식이 지원되지 않아요. 직접 입력해 주세요.'
                  : ocrError === 'image'
                    ? '이미지를 읽지 못했어요. JPG·PNG 스크린샷으로 다시 시도하거나 직접 입력해 주세요.'
                    : ocrError === 'timeout'
                      ? '인식이 너무 오래 걸려 중단했어요. 다시 시도하거나 직접 입력해 주세요.'
                      : '인식 엔진을 불러오지 못했어요. 잠시 후 다시 시도하거나 직접 입력해 주세요.'}
              </p>
            )}
            {ocrState === 'done' && parsedPreview !== null && (
              <div className="gate-sheet ocr-confirm">
                <p className="ocr-status">자동으로 채웠어요</p>
                <div className="ocr-preview">
                  <span>종목 <strong>{parsedPreview.symbol ?? '—'}</strong></span>
                  <span>구분 <strong>{parsedPreview.side === 'buy' ? '매수' : parsedPreview.side === 'sell' ? '매도' : '—'}</strong></span>
                  <span>단가 <strong>{parsedPreview.price !== undefined ? formatWon(parsedPreview.price) : '—'}</strong></span>
                  <span>수량 <strong>{parsedPreview.qty !== undefined ? `${formatQty(parsedPreview.qty)}주` : '—'}</strong></span>
                  <span>날짜 <strong>{parsedPreview.date ?? date}</strong></span>
                </div>
                <button className="btn-primary" disabled={!canSave} onClick={addTrade}>바로 입력하기</button>
              </div>
            )}
            <p className="ocr-note">사진을 고르면 바로 인식해 채워 드려요. 원본 이미지는 저장하지 않고, 512px 미리보기만 기록에 남아요.</p>
          </div>

          {notice !== '' && <p className="notice">{notice}</p>}

          <button className="btn-primary" disabled={!canSave} onClick={addTrade}>기록 저장</button>
        </section>
      )}

      {tab === 'stats' && (
        <>
          <div className="seg" role="group" aria-label="통계 분석 전환">
            <button className={`seg-btn ${statsView === 'stats' ? 'on view' : ''}`} onClick={() => setStatsView('stats')}>통계</button>
            <button className={`seg-btn ${statsView === 'insight' ? 'on view' : ''}`} onClick={() => setStatsView('insight')}>분석</button>
          </div>

          {statsView === 'stats' && (
          <section className="panel">
            <h2 className="panel-title"><IconChart size={18} />매매 통계</h2>
            <div className="stat-hero">
              <span className="stat-hero-label">실현손익 합계 (수수료·세금 미반영)</span>
              <span className={`stat-hero-value ${stats.totalRealized > 0 ? 'up' : stats.totalRealized < 0 ? 'down' : ''}`}>
                {formatSigned(stats.totalRealized)}
              </span>
            </div>
            <div className="grid2">
              <div className="mini-card">
                <span className="mini-label">승률</span>
                <span className="mini-value">{stats.winRate === null ? '—' : `${stats.winRate}%`}</span>
                <span className="stat-sub">{stats.sellCount}번 매도 중 {stats.winCount}번 이익</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">기록 수</span>
                <span className="mini-value">{trades.length}건</span>
                <span className="stat-sub">종목 {symbols.length}개</span>
              </div>
            </div>

            <div>
              <h3 className="field-label">종목별 실현손익 순위</h3>
              {stats.bySymbol.length === 0 && <p className="empty">아직 계산할 기록이 없어요.</p>}
              {stats.bySymbol.map((s) => (
                <div key={s.symbol} className="stat-row">
                  <div style={{ minWidth: 0 }}>
                    <p className="stat-name">{s.symbol}</p>
                    <p className="stat-sub">
                      {s.holdingQty > 0 ? `보유 ${formatQty(s.holdingQty)}주 · 평단 ${formatWon(s.avgPrice)}` : '전량 청산'}
                    </p>
                  </div>
                  <span className={`stat-val ${s.realized > 0 ? 'up-txt' : s.realized < 0 ? 'down-txt' : ''}`}>
                    {formatSigned(s.realized)}
                  </span>
                </div>
              ))}
            </div>

            <div>
              <h3 className="field-label">월별 실현손익</h3>
              {stats.byMonth.length === 0 && <p className="empty">매도 기록이 생기면 월별로 정리돼요.</p>}
              {stats.byMonth.map((m) => (
                <div key={m.month} className="stat-row">
                  <span className="stat-name">{m.month}</span>
                  <span className={`stat-val ${m.realized > 0 ? 'up-txt' : m.realized < 0 ? 'down-txt' : ''}`}>
                    {formatSigned(m.realized)}
                  </span>
                </div>
              ))}
            </div>
          </section>
          )}

          {statsView === 'insight' && (
          <>
          <section className="panel">
            <h2 className="panel-title"><IconChart size={18} />{ANALYSIS_ENDPOINT !== '' ? 'AI 분석' : '습관 분석'}</h2>
            <p className="ocr-note">
              {ANALYSIS_ENDPOINT !== ''
                ? '기록의 익명 요약 통계만 AI에게 보내 매매 습관을 진단해요(메모·종목명은 보내지 않아요).'
                : '기록의 감정 태그와 매매 패턴을 규칙 기반으로 살펴보는 리포트예요.'}
              {' '}오늘 남은 횟수: {insightLeft}회
            </p>
            {report === null && aiReport === null && (
              <button className="btn-primary" onClick={() => void runInsight()} disabled={trades.length === 0 || analyzing}>
                {analyzing ? '분석 중…' : ANALYSIS_ENDPOINT !== '' ? 'AI 분석 보기' : '습관 분석 보기'}
              </button>
            )}
            {insightNotice !== '' && <p className="notice">{insightNotice}</p>}
            {aiReport !== null && (
              <>
                <div>
                  <h3 className="field-label">진단</h3>
                  {aiReport.diagnosis.map((d) => (
                    <p key={d} className="rx">{d}</p>
                  ))}
                </div>
                <div>
                  <h3 className="field-label">가장 아픈 습관</h3>
                  <p className="rx"><strong>{aiReport.worstHabit.title}</strong><br />{aiReport.worstHabit.evidence}</p>
                </div>
                <div>
                  <h3 className="field-label">강점</h3>
                  <p className="rx">{aiReport.strength}</p>
                </div>
                <div>
                  <h3 className="field-label">다음 주 처방</h3>
                  <p className="rx">{aiReport.prescription}</p>
                </div>
              </>
            )}
            {report !== null && (
              <>
                {reportMode === 'offline' && <span className="badge emo offline-badge">오프라인 분석</span>}
                <div>
                  <h3 className="field-label">한 줄 처방</h3>
                  {report.prescriptions.map((p) => (
                    <p key={p} className="rx">{p}</p>
                  ))}
                </div>
                {report.emotionStats.length > 0 && (
                  <div>
                    <h3 className="field-label">감정 태그별 성과</h3>
                    {report.emotionStats.map((e) => (
                      <div key={e.emotion} className="stat-row">
                        <div style={{ minWidth: 0 }}>
                          <p className="stat-name">{e.emotion}</p>
                          <p className="stat-sub">
                            {e.count}건{e.sellCount > 0 ? ` · 매도 승률 ${Math.round((e.winCount / e.sellCount) * 100)}%` : ''}
                          </p>
                        </div>
                        <span className={`stat-val ${e.realized > 0 ? 'up-txt' : e.realized < 0 ? 'down-txt' : ''}`}>
                          {e.sellCount > 0 ? formatSigned(e.realized) : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid2">
                  <div className="mini-card">
                    <span className="mini-label">추격성 매수</span>
                    <span className="mini-value">{report.chaseBuyCount}회</span>
                    <span className="stat-sub">매수 {report.buyCount}회 중</span>
                  </div>
                  <div className="mini-card">
                    <span className="mini-label">물타기</span>
                    <span className="mini-value">{report.averagingDownCount}회</span>
                    <span className="stat-sub">평단 아래 재매수</span>
                  </div>
                </div>
                {(report.peakWeekday !== null || report.hourBandStats.length > 0) && (
                  <p className="ocr-note">
                    {report.peakWeekday !== null ? `매매가 가장 몰린 요일은 ${report.peakWeekday}요일이에요. ` : ''}
                    {report.hourBandStats.length > 0 ? `시간대는 "${report.hourBandStats[0].band}"에 많았어요.` : ''}
                  </p>
                )}
              </>
            )}
          </section>

          <p className="ocr-note">
            무료로는 습관 분석을 하루 1회 쓸 수 있어요. 내정보 탭의 이용권으로 하루 3회까지 늘릴 수 있어요.
          </p>
          </>
          )}
        </>
      )}

      {tab === 'me' && (
        <>
          <section className="panel">
            <h2 className="panel-title"><IconUser size={18} />내 정보</h2>
            {authConnected ? (
              <p className="auth-ok">토스 계정 연결됨</p>
            ) : loginSupported ? (
              <button className="btn-primary" onClick={() => void doLogin()}>토스로 로그인</button>
            ) : (
              <p className="stat-sub">토스 로그인은 토스 앱에서 이용 가능해요.</p>
            )}
            {loginNotice !== '' && <p className="notice">{loginNotice}</p>}
          </section>

          <section className="panel">
            <h2 className="panel-title"><IconList size={18} />이용 현황</h2>
            <div className="grid2">
              <div className="mini-card">
                <span className="mini-label">총 기록</span>
                <span className="mini-value">{trades.length}건</span>
                <span className="stat-sub">{hasUnlimited ? '무제한' : `무료 한도 ${FREE_RECORD_LIMIT}건`}</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">이번 달 저장</span>
                <span className="mini-value">{monthSavedCount}건</span>
                <span className="stat-sub">{thisMonth}</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">오늘 습관 분석</span>
                <span className="mini-value">{insightUsedToday}/{insightLimit}</span>
                <span className="stat-sub">자정에 초기화돼요</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">OCR 자동 입력</span>
                <span className="mini-value">{ocrReady ? '사용 가능' : '광고 후 가능'}</span>
                <span className="stat-sub">{ocrReady ? '바로 쓸 수 있어요' : '영상 광고 1회 시청'}</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title"><IconHome size={18} />이용권</h2>
            {PRODUCTS.map((p) => {
              const key = entKeyForSku(p.sku);
              const active = key !== null && isActive(ent, key, now);
              return (
                <div key={p.sku} className="stat-row">
                  <div style={{ minWidth: 0 }}>
                    <p className="stat-name">
                      {p.name} · {p.priceLabel}
                      {active && <span className="badge active-badge">이용 중</span>}
                    </p>
                    <p className="stat-sub">{p.desc}</p>
                  </div>
                  {active ? (
                    <span className="stat-sub">활성</span>
                  ) : iapAvailable ? (
                    <button className="chip" onClick={() => void buy(p.sku)} disabled={buying !== ''}>
                      {buying === p.sku ? '결제 중…' : '구독'}
                    </button>
                  ) : (
                    <span className="stat-sub">토스 앱에서 이용 가능</span>
                  )}
                </div>
              );
            })}
            {iapNotice !== '' && <p className="ocr-note">{iapNotice}</p>}
            <p className="ocr-note">
              무료로는 기록 {FREE_RECORD_LIMIT}건, 습관 분석 하루 1회까지 쓸 수 있어요. 이용권 상태는 이 기기에만 저장돼요.
            </p>
          </section>

          <section className="panel">
            {authConnected && <button className="btn-ghost" onClick={doLogout}>로그아웃</button>}
            <button className="danger-link" onClick={() => setShowWipeSheet(true)}>회원탈퇴</button>
            <p className="ocr-note">
              기록·통계는 참고용이며 투자 권유가 아니에요. 개인 데이터는 이 기기에만 저장돼요.
            </p>
          </section>

          {showWipeSheet && (
            <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="회원탈퇴 확인">
              <div className="sheet">
                <p className="sheet-title">정말 탈퇴할까요?</p>
                <p className="sheet-body">
                  모든 기록이 삭제됩니다. 매매 기록·통계·이용권 상태를 포함한 이 기기의 앱 데이터가
                  전부 지워지고 되돌릴 수 없어요.
                </p>
                <button className="btn-danger" onClick={doWipe}>모든 기록 삭제하고 탈퇴</button>
                <button className="btn-ghost" onClick={() => setShowWipeSheet(false)}>취소</button>
              </div>
            </div>
          )}
        </>
      )}

      <nav className="tabs bottom">
        <button className={`tab ${tab === 'home' ? 'on' : ''}`} onClick={() => setTab('home')}>
          <IconHome size={18} />홈
        </button>
        <button className={`tab ${tab === 'write' ? 'on' : ''}`} onClick={() => setTab('write')}>
          <IconPen size={18} />입력
        </button>
        <button className={`tab ${tab === 'stats' ? 'on' : ''}`} onClick={() => setTab('stats')}>
          <IconChart size={18} />통계
        </button>
        <button className={`tab ${tab === 'me' ? 'on' : ''}`} onClick={() => setTab('me')}>
          <IconUser size={18} />내정보
        </button>
      </nav>

      <p className="disclaimer">
        <IconInfo size={16} />
        <span>
          이 앱의 기록과 통계·분석은 개인 참고용이며 투자 권유가 아니에요. 실현손익은 같은 종목의
          평균단가 기준 모의 계산으로 수수료·세금을 반영하지 않아, 실제 손익과 다를 수 있어요.
          모든 데이터는 이 기기에만 저장돼요.
        </span>
      </p>
    </div>
  );
}
