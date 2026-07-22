/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './App.jsx', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // サイドパネルを横並びにしてもボードを圧迫しない幅
        wide: '1100px',
      },
    },
  },
  plugins: [],
};
