/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fef7ee',
          100: '#fdead6',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          900: '#9a3412',
        }
      }
    },
  },
  plugins: [],
}