/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./index.tsx",
    "./components/**/*.{ts,tsx}",
    "./views/**/*.{ts,tsx}",
    "./main/**/*.{ts,tsx}",
    "./utils/**/*.{ts,tsx,js}",
    "./integrations/pptist/src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
