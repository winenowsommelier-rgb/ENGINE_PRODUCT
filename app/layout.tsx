import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WineNow Flavor Intelligence System',
  description: 'Full-stack wine and liquor data intelligence workspace for taxonomy, flavor DNA, batch processing, and merchandising export.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
