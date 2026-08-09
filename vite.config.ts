import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages はサブディレクトリ配信（/dayservice-route/）になるため、
// CI（GitHub Actions）でビルドするときだけ base を切り替える。
const base = process.env.GITHUB_ACTIONS ? '/dayservice-route/' : '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: { port: 5173, open: false },
});
