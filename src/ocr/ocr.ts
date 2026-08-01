/**
 * 이미지 기능 — 전부 lazy.
 * - tesseract.js는 warmup/recognize가 처음 호출될 때만 dynamic import된다.
 * - 언어 데이터(kor+eng)는 tesseract.js 기본 CDN에서 lazy load — 최초 1회가 느리므로
 *   입력 탭 진입 시 warmupOcr()로 백그라운드 프리로드한다.
 * - 워커는 싱글턴으로 유지(사진마다 재로드 방지).
 * - 실패(오프라인 포함)해도 throw하지 않고 null — 수동 입력으로 우아하게 저하.
 * - E2E 훅: window.__MAEMAE_DISABLE_OCR 이 참이면 네트워크를 쓰지 않고 즉시 실패 경로.
 */

export const THUMB_WIDTH = 512;
/** localStorage 보호: 이 길이(약 1.5MB)를 넘는 dataURL은 첨부하지 않는다 */
export const MAX_THUMB_DATAURL = 1_500_000;

declare global {
  interface Window {
    __MAEMAE_DISABLE_OCR?: boolean;
  }
}

function ocrDisabled(): boolean {
  return typeof window !== 'undefined' && window.__MAEMAE_DISABLE_OCR === true;
}

/** 파일을 512px 폭 JPEG dataURL로 축소. 실패하거나 너무 크면 null. */
export function makeThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, THUMB_WIDTH / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        resolve(dataUrl.length <= MAX_THUMB_DATAURL ? dataUrl : null);
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

type TesseractWorker = {
  recognize: (image: File | string) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker | null> | null = null;
let progressListener: ((p: number) => void) | null = null;

function createOcrWorker(): Promise<TesseractWorker | null> {
  return (async () => {
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker(['kor', 'eng'], undefined, {
        logger: (m: { status?: string; progress?: number }) => {
          if (m.status === 'recognizing text' && typeof m.progress === 'number') {
            progressListener?.(m.progress);
          }
        },
      });
      return worker as unknown as TesseractWorker;
    } catch {
      return null;
    }
  })();
}

/** 언어 데이터 백그라운드 프리로드 — 입력 탭 첫 진입 시 호출 */
export function warmupOcr(): void {
  if (ocrDisabled()) return;
  if (workerPromise === null) workerPromise = createOcrWorker();
}

/** OCR. 성공 시 인식 텍스트, 실패 시 null. onProgress는 0~1. */
export async function recognizeImage(file: File, onProgress?: (p: number) => void): Promise<string | null> {
  if (ocrDisabled()) return null;
  try {
    if (workerPromise === null) workerPromise = createOcrWorker();
    let worker = await workerPromise;
    if (worker === null) {
      // 이전 로드 실패(일시적 네트워크 문제일 수 있음) → 1회 재시도
      workerPromise = createOcrWorker();
      worker = await workerPromise;
      if (worker === null) return null;
    }
    progressListener = onProgress ?? null;
    try {
      const { data } = await worker.recognize(file);
      return data.text;
    } finally {
      progressListener = null;
    }
  } catch {
    return null;
  }
}
