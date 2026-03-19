import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#0F172A',
        card: '#111827',
        accent: '#7C3AED',
        muted: '#9CA3AF'
      },
      boxShadow: {
        panel: '0 20px 45px rgba(15, 23, 42, 0.45)'
      },
      backgroundImage: {
        glass: 'linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))'
      }
    }
  },
  plugins: []
};

export default config;
