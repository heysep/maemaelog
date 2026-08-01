import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 서버리스 매매일지: 모든 기록은 localStorage(maemaelog.*)에만 저장.
// tesseract.js는 이미지 기능 사용 시점에만 dynamic import(수동 청크 분리).
export default defineConfig({
  plugins: [react()],
});
