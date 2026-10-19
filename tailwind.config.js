/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: '#0b0e13',
        panel: '#0f1218',
        surface: '#12161d',
        elevated: '#161b23',
        line: '#1c212a',
        'line-strong': '#262d38',
        accent: {
          DEFAULT: '#4f8cff',
          hover: '#6b9dff',
          soft: 'rgba(79, 140, 255, 0.14)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        indeterminate: {
          '0%': { transform: 'translateX(-40%)', width: '40%' },
          '100%': { transform: 'translateX(220%)', width: '60%' },
        },
      },
      animation: {
        'fade-in': 'fadeIn 140ms ease-out',
        indeterminate: 'indeterminate 1.1s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
