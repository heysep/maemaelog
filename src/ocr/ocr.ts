/**
 * 이미지 기능 — 전부 lazy.
 * - tesseract.js는 이 모듈의 recognizeImage가 처음 호출될 때만 dynamic import된다.
 * - 언어 데이터(kor+eng)는 tesseract.js 기본 CDN에서 lazy load.
 * - 실패(오프라인 포함)해도 throw하지 않고 null을 돌려 수동 입력으로 우아하게 저하.
 */

export const THUMB_WIDTH = 512;
/** localStorage 보호: 이 길이(약 1.5MB)를 넘는 dataURL은 첨부하지 않는다 */
export const MAX_THUMB_DATAURL = 1_500_000;

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

/** OCR. 성공 시 인식 텍스트, 실패 시 null. */
export async function recognizeImage(file: File): Promise<string | null> {
  try {
    const { createWorker } = await import('tesseract.js');
    const worker = await createWorker(['kor', 'eng']);
    try {
      const { data } = await worker.recognize(file);
      return data.text;
    } finally {
      await worker.terminate();
    }
  } catch {
    return null;
  }
}
