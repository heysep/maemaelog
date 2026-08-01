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
import { hasMissingCoreFields, mergeParsed } from './core/mergeParse';
import { isAiParseAvailable, PARSE_LIMIT, requestAiParse, type ParseTier } from './api/parseTrade';
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
import { loadFeeRates, loadTrades, saveFeeRates, saveTrades } from './core/storage';
import { EXAMPLE_FEES, feesEnabled, ZERO_FEES, type FeeRates } from './core/fees';
import {
  buildRoundTrips,
  computeRoundTripStats,
  computeRStats,
  entryEmotionPerf,
  exitEmotionPerf,
  MIN_R_TRIPS,
  MIN_RATIO_TRIPS,
} from './core/roundTrip';
import {
  grantEntitlement,
  loadAiParseUsage,
  loadEntitlements,
  saveAiParseUsage,
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

function daysSince(date: string): number {
  const ms = Date.now() - Date.parse(`${date}T00:00:00`);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

function todayStr(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function App() {
  const [tab, setTab] = useState<Tab>('home');
  const [trades, setTrades] = useState<Trade[]>(() => loadTrades());
  const [feeRates, setFeeRates] = useState<FeeRates>(() => loadFeeRates());
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
  const [stopPrice, setStopPrice] = useState('');
  const [thumb, setThumb] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  // ---- OCR 골라 넣기 ----
  const fileRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [ocrState, setOcrState] = useState<OcrState>('idle');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState<OcrError | null>(null);
  const [ocrRawText, setOcrRawText] = useState('');
  const [aiFilled, setAiFilled] = useState<string[]>([]);
  /** null=안내 없음 / 'used'=이번에 무료 1회 사용 / 'limit'=한도 소진 */
  const [aiNotice, setAiNotice] = useState<'used' | 'limit' | null>(null);
  const [aiUsage, setAiUsage] = useState(() => loadAiParseUsage());
  const [copied, setCopied] = useState(false);
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
  const stats = useMemo(() => computeStats(trades, feeRates), [trades, feeRates]);
  const roundTrips = useMemo(() => buildRoundTrips(trades, feeRates), [trades, feeRates]);
  const rtStats = useMemo(() => computeRoundTripStats(roundTrips), [roundTrips]);
  const rStats = useMemo(() => computeRStats(roundTrips), [roundTrips]);
  const entryPerf = useMemo(() => entryEmotionPerf(roundTrips), [roundTrips]);
  const exitPerf = useMemo(() => exitEmotionPerf(roundTrips), [roundTrips]);
  const openPositions = useMemo(() => roundTrips.filter((r) => r.open), [roundTrips]);
  const feesOn = feesEnabled(feeRates);
  const symbols = useMemo(() => [...new Set(trades.map((t) => t.symbol))].sort(), [trades]);
  const noAds = adsRemoved(ent, now);
  const insightLeft = remainingInsights(loadInsightCounter(), ent, now, todayKey);
  const insightLimit = dailyInsightLimit(ent, now);
  const insightUsedToday = insightLimit - insightLeft;
  const hasPro = isActive(ent, 'pro', now);
  const hasUnlimited = hasPro || isActive(ent, 'records', now);
  const aiLimitToday = aiUsage !== null && aiUsage.date === todayKey ? aiUsage.limit : PARSE_LIMIT[hasPro ? 'pro' : 'free'];
  const aiUsedToday = aiUsage !== null && aiUsage.date === todayKey ? aiUsage.used : 0;
  const monthSavedCount = trades.filter((t) => t.date.startsWith(todayKey.slice(0, 7))).length;
  const ocrReady = decideOcrGate(loadOcrPass(), ent, now, todayKey, REWARDED_AD_ID) === 'allow';
  const recordOk = canAddRecord(trades.length, ent, now);
  const [iapAvailable, setIapAvailable] = useState(false);
  useEffect(() => {
    void ensureIapModule().then(() => setIapAvailable(isIapSupported()));
  }, []);

  const stopNum = Number(stopPrice);
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
    setStopPrice(''); setThumb(null); setImageFile(null); setOcrState('idle'); setOcrProgress(0); setParsedPreview(null);
    setDate(todayStr());
    if (fileRef.current) fileRef.current.value = '';
  };

  interface EffTrade { symbol: string; side: Side; price: number; qty: number; date: string; time: string }

  const effFromState = (): EffTrade => ({ symbol: symbol.trim(), side, price: priceNum, qty: qtyNum, date, time });

  /** 바로 입력하기 방어: 폼 상태가 비어 있으면 OCR 프리뷰 값으로 보강(계산 단가 포함) */
  const effFromPreview = (m: ParsedTrade | null): EffTrade => ({
    symbol: symbol.trim() !== '' ? symbol.trim() : (m?.symbol ?? ''),
    side: m?.side ?? side,
    price: price !== '' ? priceNum : (m?.price ?? NaN),
    qty: qty !== '' ? qtyNum : (m?.qty ?? NaN),
    date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : (m?.date ?? date),
    time: time !== '' ? time : (m?.time ?? ''),
  });

  const isEffValid = (e: EffTrade): boolean =>
    recordOk &&
    e.symbol !== '' &&
    Number.isFinite(e.price) && e.price > 0 &&
    Number.isFinite(e.qty) && e.qty > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(e.date);

  const saveTrade = (e: EffTrade) => {
    if (!isEffValid(e)) return;
    setNotice('');
    const t: Trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: e.symbol,
      side: e.side,
      price: Math.round(e.price),
      qty: Math.round(e.qty * 1e6) / 1e6, // 소수점 주식 허용(소수 6자리)
      date: e.date,
      ...(e.time !== '' ? { time: e.time } : {}),
      memo: memo.trim(),
      emotion,
      ...(e.side === 'buy' && stopNum > 0 ? { stopPrice: Math.round(stopNum) } : {}),
      ...(thumb ? { thumb } : {}),
    };
    persist([...trades, t]);
    resetForm();
    setReport(null);
    setAiReport(null);
    setTab('home');
  };

  /** 요율 변경 — 기록은 그대로, 통계만 즉시 재계산 */
  const updateFees = (next: FeeRates) => {
    setFeeRates(next);
    saveFeeRates(next);
  };

  const addTrade = () => saveTrade(effFromState());
  const quickAdd = () => saveTrade(effFromPreview(parsedPreview));

  /** 인식 원문 복사 — 인식 품질 확인·문의용 */
  const copyRawText = async () => {
    if (ocrRawText === '') return;
    let done = false;
    try {
      await navigator.clipboard.writeText(ocrRawText);
      done = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = ocrRawText;
        document.body.appendChild(ta);
        ta.select();
        done = document.execCommand('copy');
        ta.remove();
      } catch {
        done = false;
      }
    }
    if (done) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
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
    setOcrRawText(result.text);
    setAiFilled([]);
    setAiNotice(null);
    // 1) 항상 로컬 규칙 파서 먼저 (오프라인·무료·비전송)
    let parsed = parseTradeText(result.text);
    // 2) 핵심 필드가 비었을 때만 서버(AI 정밀 인식) 호출 — 무료 하루 1회·프로 하루 20회
    const tier: ParseTier = isActive(ent, 'pro', new Date()) ? 'pro' : 'free';
    if (hasMissingCoreFields(parsed) && isAiParseAvailable()) {
      const r = await requestAiParse(result.text, { authConnected, tier });
      if (r.status === 'ok') {
        const { merged, filledByAi } = mergeParsed(parsed, r.parsed);
        parsed = merged;
        setAiFilled(filledByAi);
        const usage = { date: todayKey, used: r.used, limit: r.limit };
        saveAiParseUsage(usage);
        setAiUsage(usage);
        if (tier === 'free') setAiNotice('used');
      } else if (r.status === 'limit') {
        const usage = { date: todayKey, used: r.used, limit: r.limit };
        saveAiParseUsage(usage);
        setAiUsage(usage);
        setAiNotice('limit'); // 조용히 로컬 결과 유지 + 안내 한 줄
      }
      // fail: 조용히 로컬 결과만 유지
    }
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
      const r = await requestAiAnalysis(buildStatsPayload(trades, feeRates), { authConnected, tier });
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
    setAiUsage(null);
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

          <div className="ocr-box">
            <input
              ref={fileRef}
              id="f-image"
              type="file"
              accept="image/*"
              onChange={onFileChange}
              style={{ display: 'none' }}
            />
            <button className="btn-primary ocr-cta" onClick={() => fileRef.current?.click()}>
              <IconCamera size={20} />거래내역 넣으면 자동 입력
            </button>
            <p className="ocr-note">증권앱 체결 화면 스크린샷을 고르면 종목·단가·수량·날짜를 자동으로 채워요.</p>
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
                <p className="ocr-status">
                  자동으로 채웠어요
                  {aiFilled.length > 0 && <span className="badge ai-badge">AI 정밀 인식</span>}
                </p>
                <div className="ocr-preview">
                  <span>종목 <strong>{parsedPreview.symbol ?? '—'}</strong></span>
                  <span>구분 <strong>{parsedPreview.side === 'buy' ? '매수' : parsedPreview.side === 'sell' ? '매도' : '—'}</strong></span>
                  <span>단가 <strong>{parsedPreview.price !== undefined ? formatWon(parsedPreview.price) : '—'}</strong></span>
                  <span>수량 <strong>{parsedPreview.qty !== undefined ? `${formatQty(parsedPreview.qty)}주` : '—'}</strong></span>
                  <span>날짜 <strong>{parsedPreview.date ?? date}</strong></span>
                </div>
                <button className="btn-primary" disabled={!isEffValid(effFromPreview(parsedPreview))} onClick={quickAdd}>바로 입력하기</button>
                {aiNotice === 'used' && (
                  <p className="ocr-note">오늘 무료 AI 인식 1회를 사용했어요. 프로를 쓰면 하루 20번까지 쓸 수 있어요.</p>
                )}
                {aiNotice === 'limit' && (
                  <p className="ocr-note">
                    {isActive(ent, 'pro', now)
                      ? '오늘 AI 인식 한도를 다 썼어요. 내일 다시 쓸 수 있어요.'
                      : '오늘 무료 AI 인식을 다 썼어요. 프로를 쓰면 하루 20번까지 쓸 수 있어요. '}
                    {!isActive(ent, 'pro', now) && (
                      <button className="inline-link" onClick={() => setTab('me')}>이용권 보기</button>
                    )}
                  </p>
                )}
                {aiFilled.length > 0 && (
                  <p className="ocr-note">스크린샷 이미지는 보내지 않고, 기기에서 인식한 텍스트만 사용해요.</p>
                )}
                <button className="raw-copy" onClick={() => void copyRawText()}>
                  {copied ? '복사됨' : '인식 원문 복사'}
                </button>
              </div>
            )}
            <p className="ocr-note">사진을 고르면 바로 인식해 채워 드려요. 원본 이미지는 저장하지 않고, 512px 미리보기만 기록에 남아요.</p>
          </div>

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

          {side === 'buy' && (
            <div className="field">
              <label className="field-label" htmlFor="f-stop">손절가 (선택)</label>
              <input
                id="f-stop"
                className="field-input"
                inputMode="numeric"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="여기까지 빠지면 판다 (R 계산에 쓰여요)"
              />
              {stopNum > 0 && Number.isFinite(priceNum) && priceNum > 0 && Number.isFinite(qtyNum) && qtyNum > 0 && (
                stopNum < priceNum ? (
                  <p className="risk-preview">
                    이 매매의 위험액 <strong>{formatWon(Math.round((priceNum - stopNum) * qtyNum))}</strong>
                    <span className="risk-formula"> (단가−손절가)×수량</span>
                  </p>
                ) : (
                  <p className="notice">손절가는 매수가보다 낮아야 해요.</p>
                )
              )}
            </div>
          )}

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
            <p className="fee-state">{feesOn ? '수수료·세금 반영' : '수수료·세금 미반영'}</p>
            <div className="grid2">
              <div className="mini-card">
                <span className="mini-label">승률</span>
                <span className="mini-value">{rtStats.winRate === null ? '—' : `${rtStats.winRate}%`}</span>
                <span className="stat-sub">매매 {rtStats.closedCount}건 중 {rtStats.winCount}건 이익</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">평균 보유</span>
                <span className="mini-value">{rtStats.avgHoldDays === null ? '—' : `${rtStats.avgHoldDays}일`}</span>
                <span className="stat-sub">진행 중 {rtStats.openCount}건</span>
              </div>
            </div>

            {rtStats.closedCount >= MIN_RATIO_TRIPS && (
              <>
                <div className="grid2">
                  <div className="mini-card">
                    <span className="mini-label">손익비</span>
                    <span className="mini-value">
                      {rtStats.payoffRatio === null ? '—' : `${rtStats.payoffRatio} : 1`}
                    </span>
                    <span className="stat-sub">평균이익 ÷ 평균손실</span>
                  </div>
                  <div className="mini-card">
                    <span className="mini-label">Profit Factor</span>
                    <span className="mini-value">{rtStats.profitFactor === null ? '—' : rtStats.profitFactor}</span>
                    <span className="stat-sub">총이익 ÷ 총손실</span>
                  </div>
                </div>
                <p className="ocr-note">승률이 높아도 손익비가 1 미만이면 결국 잃어요. 두 숫자를 같이 보세요.</p>
              </>
            )}

            {rStats.count >= MIN_R_TRIPS && (
              <div>
                <h3 className="field-label">R 지표 · 손절가를 적은 {rStats.count}건 기준</h3>
                <div className="grid2">
                  <div className="mini-card">
                    <span className="mini-label">평균 R (기대값)</span>
                    <span className="mini-value">{rStats.avgR === null ? '—' : `${rStats.avgR > 0 ? '+' : ''}${rStats.avgR}R`}</span>
                    <span className="stat-sub">1회 매매의 기대 성과</span>
                  </div>
                  <div className="mini-card">
                    <span className="mini-label">최고 · 최저 R</span>
                    <span className="mini-value">
                      {rStats.bestR === null ? '—' : `${rStats.bestR > 0 ? '+' : ''}${rStats.bestR}R`}
                    </span>
                    <span className="stat-sub">최저 {rStats.worstR === null ? '—' : `${rStats.worstR}R`}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="grid2">
              <div className="mini-card">
                <span className="mini-label">기록 수</span>
                <span className="mini-value">{trades.length}건</span>
                <span className="stat-sub">종목 {symbols.length}개</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">매매 건수</span>
                <span className="mini-value">{rtStats.closedCount}건</span>
                <span className="stat-sub">진입~청산 1건 기준</span>
              </div>
            </div>

            {openPositions.length > 0 && (
              <div>
                <h3 className="field-label">보유 중</h3>
                {openPositions.map((r) => (
                  <div key={`${r.symbol}-${r.entryDate}`} className="stat-row">
                    <div style={{ minWidth: 0 }}>
                      <p className="stat-name">{r.symbol}</p>
                      <p className="stat-sub">
                        {formatQty(r.openQty)}주 · 평단 {formatWon(r.avgEntry)} · {daysSince(r.entryDate)}일째
                      </p>
                    </div>
                    <span className="stat-val">{formatWon(Math.round(r.avgEntry * r.openQty))}</span>
                  </div>
                ))}
                <p className="ocr-note">매수원금 기준이에요. 평가손익은 시세를 쓰지 않아 표시하지 않아요.</p>
              </div>
            )}

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
                {(entryPerf.length > 0 || exitPerf.length > 0) && (
                  <div>
                    <h3 className="field-label">살 때 감정 · 매매 결과</h3>
                    {entryPerf.length === 0 && <p className="empty">청산된 매매가 생기면 보여요.</p>}
                    {entryPerf.map((e) => (
                      <div key={`in-${e.emotion}`} className="stat-row">
                        <div style={{ minWidth: 0 }}>
                          <p className="stat-name"><EmotionIcon emotion={e.emotion} size={14} />{e.emotion}</p>
                          <p className="stat-sub">{e.trips}건 · 승률 {e.winRate}%</p>
                        </div>
                        <span className={`stat-val ${e.realized > 0 ? 'up-txt' : e.realized < 0 ? 'down-txt' : ''}`}>
                          {formatSigned(e.realized)}
                        </span>
                      </div>
                    ))}
                    <h3 className="field-label" style={{ marginTop: 14 }}>팔 때 감정 · 매매 결과</h3>
                    {exitPerf.length === 0 && <p className="empty">청산된 매매가 생기면 보여요.</p>}
                    {exitPerf.map((e) => (
                      <div key={`out-${e.emotion}`} className="stat-row">
                        <div style={{ minWidth: 0 }}>
                          <p className="stat-name"><EmotionIcon emotion={e.emotion} size={14} />{e.emotion}</p>
                          <p className="stat-sub">{e.trips}건 · 승률 {e.winRate}%</p>
                        </div>
                        <span className={`stat-val ${e.realized > 0 ? 'up-txt' : e.realized < 0 ? 'down-txt' : ''}`}>
                          {formatSigned(e.realized)}
                        </span>
                      </div>
                    ))}
                    <p className="ocr-note">라운드트립(진입~청산) 손익을 살 때 감정과 팔 때 감정에 각각 귀속해 봤어요.</p>
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
                <span className="mini-label">오늘 AI 인식</span>
                <span className="mini-value">{aiUsedToday}/{aiLimitToday}</span>
                <span className="stat-sub">{hasPro ? '프로 한도' : '무료 체험 한도'}</span>
              </div>
              <div className="mini-card">
                <span className="mini-label">OCR 자동 입력</span>
                <span className="mini-value">{ocrReady ? '사용 가능' : '광고 후 가능'}</span>
                <span className="stat-sub">{ocrReady ? '바로 쓸 수 있어요' : '영상 광고 1회 시청'}</span>
              </div>
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title"><IconList size={18} />수수료·세금</h2>
            <div className="row2">
              <div className="field">
                <label className="field-label" htmlFor="f-comm">매매 수수료율(%)</label>
                <input
                  id="f-comm"
                  className="field-input"
                  inputMode="decimal"
                  value={feeRates.commissionPct === 0 ? '' : String(feeRates.commissionPct)}
                  placeholder={`예: ${EXAMPLE_FEES.commissionPct}`}
                  onChange={(e) => updateFees({ ...feeRates, commissionPct: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor="f-tax">매도 세율(%)</label>
                <input
                  id="f-tax"
                  className="field-input"
                  inputMode="decimal"
                  value={feeRates.sellTaxPct === 0 ? '' : String(feeRates.sellTaxPct)}
                  placeholder={`예: ${EXAMPLE_FEES.sellTaxPct}`}
                  onChange={(e) => updateFees({ ...feeRates, sellTaxPct: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })}
                />
              </div>
            </div>
            <p className="ocr-note">
              증권사 앱에서 내 수수료율과 세율을 확인해 입력하면 실제 손에 쥐는 금액으로 계산해 드려요.
              비워 두면 수수료·세금을 반영하지 않아요. 저장된 기록은 그대로 두고 통계만 다시 계산해요.
            </p>
            {feesOn && <button className="btn-ghost" onClick={() => updateFees(ZERO_FEES)}>비우기(미반영으로)</button>}
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
              AI 정밀 인식과 습관 분석은 스크린샷 이미지가 아니라 기기에서 인식한 텍스트·익명 통계만 사용해요.
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
