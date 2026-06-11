import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1440px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--sh-border))',
        input: 'hsl(var(--sh-input))',
        ring: 'hsl(var(--sh-ring))',
        background: 'hsl(var(--sh-background))',
        foreground: 'hsl(var(--sh-foreground))',
        primary: {
          DEFAULT: 'hsl(var(--sh-primary))',
          foreground: 'hsl(var(--sh-primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--sh-secondary))',
          foreground: 'hsl(var(--sh-secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--sh-destructive))',
          foreground: 'hsl(var(--sh-destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--sh-muted))',
          foreground: 'hsl(var(--sh-muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--sh-accent))',
          foreground: 'hsl(var(--sh-accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--sh-popover))',
          foreground: 'hsl(var(--sh-popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--sh-card))',
          foreground: 'hsl(var(--sh-card-foreground))',
        },
        ok: 'hsl(var(--status-ok))',
        warn: 'hsl(var(--status-warn))',
        danger: 'hsl(var(--status-danger))',
        info: 'hsl(var(--status-info))',
        term: {
          bg: 'rgb(var(--term-bg) / <alpha-value>)',
          surface: 'rgb(var(--term-surface) / <alpha-value>)',
          raised: 'rgb(var(--term-raised) / <alpha-value>)',
          line: 'rgb(var(--term-line) / <alpha-value>)',
          'line-2': 'rgb(var(--term-line-2) / <alpha-value>)',
          text: 'rgb(var(--term-text) / <alpha-value>)',
          muted: 'rgb(var(--term-muted) / <alpha-value>)',
          faint: 'rgb(var(--term-faint) / <alpha-value>)',
          mint: 'rgb(var(--term-mint) / <alpha-value>)',
          'mint-ink': 'rgb(var(--term-mint-ink) / <alpha-value>)',
          uv: 'rgb(var(--term-uv) / <alpha-value>)',
          'uv-tint': 'rgb(var(--term-uv-tint) / <alpha-value>)',
          warn: 'rgb(var(--term-warn) / <alpha-value>)',
          danger: 'rgb(var(--term-danger) / <alpha-value>)',
        },
        tag: {
          ig: 'rgb(var(--term-tag-ig) / <alpha-value>)',
          tt: 'rgb(var(--term-tag-tt) / <alpha-value>)',
          yt: 'rgb(var(--term-tag-yt) / <alpha-value>)',
          li: 'rgb(var(--term-tag-li) / <alpha-value>)',
          th: 'rgb(var(--term-tag-th) / <alpha-value>)',
          fb: 'rgb(var(--term-tag-fb) / <alpha-value>)',
          tw: 'rgb(var(--term-tag-tw) / <alpha-value>)',
        },
      },
      borderRadius: {
        lg: 'var(--radius-lg-tw)',
        md: 'calc(var(--radius-lg-tw) - 4px)',
        sm: 'calc(var(--radius-lg-tw) - 6px)',
      },
      fontFamily: {
        display: ['var(--font-display, Manrope)', 'Manrope', 'system-ui', 'sans-serif'],
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Inter',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'var(--font-mono, ui-monospace)',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.55', transform: 'scale(0.85)' },
        },
        'term-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-soft': 'pulse-soft 1.6s infinite ease-in-out',
        'term-blink': 'term-blink 1.1s step-end infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
