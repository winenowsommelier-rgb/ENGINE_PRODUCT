import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono:    ['var(--font-mono)', 'monospace'],
        sans:    ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      colors: {
        background: '#080808',
        surface:    '#111111',
        border:     'rgba(255,255,255,0.07)',
        muted:      '#737373',
        subtle:     '#333333',
        card:       '#111111',
        accent:     '#ffffff',
      },
      boxShadow: {
        panel:  '0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
        lifted: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.07)',
      },
      backgroundImage: {
        glass: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
        noise: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
    },
  },
  plugins: [],
};

export default config;
