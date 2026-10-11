/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [require('./src/malphas/preset.cjs')],
  content: ['./*.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
