/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        base: 'rgb(var(--color-base) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        elevated: 'rgb(var(--color-elevated) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        'line-strong': 'rgb(var(--color-line-strong) / <alpha-value>)',
        'row-hover': 'rgb(var(--color-row-hover) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-accent) / 0.14)',
        },
      },
      fontFamily: {
        sans: ['var(--app-font-family)'],
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
