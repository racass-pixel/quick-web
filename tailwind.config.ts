import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'qk-bg':      'var(--color-bg)',
        'qk-surface': 'var(--color-surface)',
        'qk-border':  'var(--color-border)',
        'qk-muted':   'var(--color-muted)',
        'qk-text':    'var(--color-text)',
        'qk-accent':  'var(--color-accent)',
        'qk-danger':  'var(--color-danger)',
        'qk-success': 'var(--color-success)',
      },
      borderRadius: {
        'qk-sm':  'var(--radius-sm)',
        'qk-md':  'var(--radius-md)',
        'qk-lg':  'var(--radius-lg)',
      },
      fontFamily: {
        sans: ['var(--font-family-sans)'],
        mono: ['var(--font-family-mono)'],
      },
    },
  },
};

export default config;
