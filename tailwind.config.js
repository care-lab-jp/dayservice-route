/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 注意: 'base' という名前は text-base（文字サイズ）と衝突し、
        // 文字色として解釈されてしまうため使わない
        pageBg: '#f7f8f7',
        ink: '#1f2933',
        accent: '#2f6f4e',
        accentSoft: '#e6f0ea',
        warn: '#c0392b',
        warnSoft: '#fdecea',
      },
    },
  },
  plugins: [],
};
