import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WNLQ9 B2B — Wholesale Catalogue',
  description: 'Wholesale catalogue for trade buyers. Password-protected.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
