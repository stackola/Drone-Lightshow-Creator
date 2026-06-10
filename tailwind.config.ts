import type { Config } from 'tailwindcss'

// L5-tokens (2026-05-21) — Figma-tier design system foundation.
// Semantic color tokens, type scale, motion vocabulary. Ad-hoc Tailwind classes
// across the app should migrate to these tokens incrementally. The raw slate-*
// /white/* classes still work; tokens are additive.

const motionDurations = {
  // The motion palette. Use `transition-[X]` with these ms values.
  '0': '0ms',
  '75': '75ms',
  '100': '100ms',
  '150': '150ms', // micro — hover/focus
  '200': '200ms',
  '300': '300ms', // short — expand/collapse, panel reveals
  '500': '500ms', // medium — page transitions
  '800': '800ms', // long — onboarding, attention
} as const

const motionEasings = {
  // Material-design-style ease curves.
  'standard': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'enter':    'cubic-bezier(0.0, 0, 0.2, 1)',
  'exit':     'cubic-bezier(0.4, 0, 1, 1)',
  'spring':   'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      // Semantic color tokens. The app is dark-mode-first; these resolve to
      // CSS variables defined in index.html so light-mode can later be a
      // single class flip on <html>.
      colors: {
        // Surfaces
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--surface-raised) / <alpha-value>)',
        'surface-hover': 'rgb(var(--surface-hover) / <alpha-value>)',
        'surface-active': 'rgb(var(--surface-active) / <alpha-value>)',
        // Borders
        'border-subtle': 'rgb(var(--border-subtle) / <alpha-value>)',
        'border-strong': 'rgb(var(--border-strong) / <alpha-value>)',
        // Text
        'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
        'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
        'text-tertiary': 'rgb(var(--text-tertiary) / <alpha-value>)',
        'text-disabled': 'rgb(var(--text-disabled) / <alpha-value>)',
        // Accents
        'accent-primary': 'rgb(var(--accent-primary) / <alpha-value>)',
        'accent-secondary': 'rgb(var(--accent-secondary) / <alpha-value>)',
        'accent-transition': 'rgb(var(--accent-transition) / <alpha-value>)',
        // Status
        'status-info': 'rgb(var(--status-info) / <alpha-value>)',
        'status-success': 'rgb(var(--status-success) / <alpha-value>)',
        'status-warning': 'rgb(var(--status-warning) / <alpha-value>)',
        'status-error': 'rgb(var(--status-error) / <alpha-value>)',
      },
      // Type scale.
      fontSize: {
        'micro':   ['10px', { lineHeight: '13px', letterSpacing: '0.01em' }],
        'caption': ['11px', { lineHeight: '14px', letterSpacing: '0.01em' }],
        'body-sm': ['12px', { lineHeight: '16px' }],
        'body':    ['14px', { lineHeight: '20px' }],
        'h3':      ['16px', { lineHeight: '22px', fontWeight: '600' }],
        'h2':      ['20px', { lineHeight: '26px', fontWeight: '600' }],
        'h1':      ['24px', { lineHeight: '30px', fontWeight: '600' }],
      },
      transitionDuration: motionDurations,
      transitionTimingFunction: motionEasings,
      animationDuration: motionDurations,
      animationTimingFunction: motionEasings,
    },
  },
  plugins: [],
} satisfies Config
