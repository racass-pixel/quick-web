import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:     'var(--color-bg)',
        panel:  'var(--color-panel)',
        raised: 'var(--color-raised)',
        line:   'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        ink: {
          1: 'var(--color-ink-1)',
          2: 'var(--color-ink-2)',
          3: 'var(--color-ink-3)',
        },
        ember:        'var(--color-ember)',
        'ember-soft': 'var(--color-ember-soft)',
        'ember-glow': 'var(--color-ember-glow)',
        ok:   'var(--color-ok)',
        warn: 'var(--color-warn)',
        err:  'var(--color-err)',
        // legacy qk-* aliases — kept so the existing Health page compiles
        'qk-bg':      'var(--color-bg)',
        'qk-surface': 'var(--color-panel)',
        'qk-border':  'var(--color-line-strong)',
        'qk-muted':   'var(--color-ink-2)',
        'qk-text':    'var(--color-ink-1)',
        'qk-accent':  'var(--color-ember)',
        'qk-danger':  'var(--color-err)',
        'qk-success': 'var(--color-ok)',
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
      fontSize: {
        kicker: 'var(--font-size-kicker)',
      },
      letterSpacing: {
        kicker:  'var(--font-tracking-kicker)',
        tight:   'var(--font-tracking-tight)',
        tighter: 'var(--font-tracking-tighter)',
      },
    },
  },
};

export default config;
