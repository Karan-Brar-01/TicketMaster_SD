/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070d18',
          900: '#0b1424',
          800: '#122038',
          700: '#1a2d4d',
        },
        sand: {
          50: '#f7f3ea',
          100: '#ebe3d4',
          300: '#c9b89a',
        },
        ember: {
          400: '#f0b429',
          500: '#d9940f',
          600: '#b87309',
        },
      },
      fontFamily: {
        display: ['"Syne"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(240, 180, 41, 0.12)',
      },
      keyframes: {
        pulseSeat: {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.06)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        barGrow: {
          '0%': { transform: 'scaleX(0)' },
          '100%': { transform: 'scaleX(1)' },
        },
      },
      animation: {
        pulseSeat: 'pulseSeat 1.6s ease-in-out infinite',
        slideIn: 'slideIn 0.45s ease-out both',
        barGrow: 'barGrow 0.5s ease-out both',
      },
    },
  },
  plugins: [],
};
