import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // src/config.ts APP_NAME과 문자 단위 동일. 딥링크 intoss://maemaelog.
  appName: 'maemaelog',
  brand: {
    displayName: '주식 매매일지',
    primaryColor: '#143A5C',
    icon: 'https://static.toss.im/appsintoss/61245/38f96ae6-a16a-46a0-b2aa-e1c543436080.png',
  },
  web: { host: 'localhost', port: 5173, commands: { dev: 'vite', build: 'vite build' } },
  permissions: [],
  outdir: 'dist',
});
