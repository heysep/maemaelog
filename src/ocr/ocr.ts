/**
 * 이미지 기능 — CDN 의존 없음(전부 같은 오리진 번들 자산).
 * - worker JS / core wasm / 언어 데이터(tessdata_fast kor+eng)는 public/ocr/ 아래에 동봉,
 *   createWorker에 workerPath·corePath·langPath 상대경로를 지정한다 (토스 웹뷰 대응).
 * - 워커는 싱글턴. 입력 탭 진입 시 warmupOcr()로 백그라운드 프리로드.
 * - 실패는 단계별로 구분해 돌려준다: 'unsupported'(Worker 차단) / 'load'(엔진 로드 실패)
 *   / 'image'(이미지 해석 불가) / 'timeout'. throw하지 않는다 — 수동 입력으로 우아하게 저하.
 * - 인식 전 이미지를 canvas로 최대 1600px 리사이즈(HEIC·대용량 정규화, 정확도에도 유리).
 * - E2E 훅: window.__MAEMAE_DISABLE_OCR 이 참이면 네트워크 없이 즉시 'load' 실패 경로.
 */

export const THUMB_WIDTH = 512;
/** localStorage 보호: 이 길이(약 1.5MB)를 넘는 dataURL은 첨부하지 않는다 */
export const MAX_THUMB_DATAURL = 1_500_000;
/** 인식 입력 정규화 최대 변 길이 */
export const OCR_MAX_DIM = 1600;
/** 엔진 로드/인식 타임아웃(ms) — 진행률 0%에서 방치되는 상태 방지 */
export const OCR_INIT_TIMEOUT = 30_000;
export const OCR_RECOGNIZE_TIMEOUT = 45_000;

export type OcrError = 'unsupported' | 'load' | 'image' | 'timeout';
export type OcrResult = { ok: true; text: string } | { ok: false; error: OcrError };

declare global {
  interface Window {
    __MAEMAE_DISABLE_OCR?: boolean;
  }
}

function ocrDisabled(): boolean {
  return typeof window !== 'undefined' && window.__MAEMAE_DISABLE_OCR === true;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  return Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))]);
}

/** 토스 웹뷰 등에서 worker-src 제한으로 new Worker가 막혀 있는지 사전 감지 */
export function isWorkerSupported(): boolean {
  if (typeof Worker === 'undefined') return false;
  try {
    const blob = new Blob([';'], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    try {
      const w = new Worker(url);
      w.terminate();
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.error('[ocr] Worker 생성 불가(웹뷰 worker-src 제한 가능):', e);
    return false;
  }
}

/** 파일 → 이미지 로드 (HEIC 등 디코드 실패 시 null) */
function loadImage(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function drawScaled(img: HTMLImageElement, maxDim: number, quality: number): string | null {
  try {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return null;
  }
}

/** 파일을 512px 폭 JPEG dataURL로 축소. 실패하거나 너무 크면 null. */
export async function makeThumbnail(file: File): Promise<string | null> {
  const img = await loadImage(file);
  if (img === null) return null;
  // 폭 기준 512px — 세로가 더 길어도 폭이 512를 넘지 않게 최대 변을 환산
  const maxDim = Math.round((THUMB_WIDTH / img.naturalWidth) * Math.max(img.naturalWidth, img.naturalHeight));
  const dataUrl = drawScaled(img, Math.min(maxDim, Math.max(img.naturalWidth, img.naturalHeight)), 0.8);
  URL.revokeObjectURL(img.src);
  if (dataUrl === null) return null;
  return dataUrl.length <= MAX_THUMB_DATAURL ? dataUrl : null;
}

/** 인식용 정규화: canvas로 최대 1600px JPEG dataURL (HEIC·대용량 대응) */
export async function normalizeForOcr(file: File): Promise<string | null> {
  const img = await loadImage(file);
  if (img === null) return null;
  const dataUrl = drawScaled(img, OCR_MAX_DIM, 0.92);
  URL.revokeObjectURL(img.src);
  return dataUrl;
}

type TesseractWorker = {
  recognize: (image: File | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker | OcrError> | null = null;
let progressListener: ((p: number) => void) | null = null;

function createOcrWorker(): Promise<TesseractWorker | OcrError> {
  return (async () => {
    if (!isWorkerSupported()) return 'unsupported';
    try {
      const { createWorker } = await import('tesseract.js');
      const init = createWorker(['kor', 'eng'], undefined, {
        // CDN 금지 — 전부 같은 오리진 번들 자산(public/ocr/)
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        gzip: true,
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            progressListener?.(m.progress);
          }
        },
      });
      const worker = await withTimeout(init, OCR_INIT_TIMEOUT);
      if (worker === 'timeout') {
        console.error('[ocr] 엔진 초기화 타임아웃(30s)');
        return 'timeout';
      }
      return worker as unknown as TesseractWorker;
    } catch (e) {
      console.error('[ocr] 엔진 로드 실패(자산 fetch/wasm 초기화):', e);
      return 'load';
    }
  })();
}

/** 언어 데이터·엔진 백그라운드 프리로드 — 입력 탭 첫 진입 시 호출 */
export function warmupOcr(): void {
  if (ocrDisabled()) return;
  if (workerPromise === null) workerPromise = createOcrWorker();
}

/** OCR 실행. onProgress는 0~1. */
export async function recognizeImage(file: File, onProgress?: (p: number) => void): Promise<OcrResult> {
  if (ocrDisabled()) return { ok: false, error: 'load' };
  try {
    // 이미지 정규화 먼저 — 엔진 문제와 이미지 문제를 구분
    const normalized = await normalizeForOcr(file);
    if (normalized === null) {
      console.error('[ocr] 이미지 디코드 실패(HEIC 미지원 또는 손상 파일)');
      return { ok: false, error: 'image' };
    }
    if (workerPromise === null) workerPromise = createOcrWorker();
    let worker = await workerPromise;
    if (worker === 'load' || worker === 'timeout') {
      // 일시적 실패였을 수 있으므로 1회 재시도
      workerPromise = createOcrWorker();
      worker = await workerPromise;
    }
    if (typeof worker === 'string') return { ok: false, error: worker };
    progressListener = onProgress ?? null;
    try {
      const res = await withTimeout(worker.recognize(normalized), OCR_RECOGNIZE_TIMEOUT);
      if (res === 'timeout') {
        console.error('[ocr] 인식 타임아웃(45s)');
        return { ok: false, error: 'timeout' };
      }
      return { ok: true, text: res.data.text };
    } finally {
      progressListener = null;
    }
  } catch (e) {
    console.error('[ocr] 인식 실패:', e);
    return { ok: false, error: 'load' };
  }
}
