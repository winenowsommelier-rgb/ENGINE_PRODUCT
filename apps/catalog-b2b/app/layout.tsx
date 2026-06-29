import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'WNLQ9 B2B Catalog',
  description: 'Wholesale catalog for trade buyers',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
