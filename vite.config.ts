import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * GitHub Pages はサブディレクトリ配信（/dayservice-route/）になるため、
 * ビルド時だけ base を切り替える。
 * （process.env はNodeの型定義が必要になるため使わない）
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dayservice-route/' : '/',
  plugins: [react()],
  server: { port: 5173, open: false },
}));
