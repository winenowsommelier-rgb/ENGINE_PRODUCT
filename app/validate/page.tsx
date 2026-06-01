import type { Metadata } from 'next';
import ValidateClient from './ValidateClient';

export const metadata: Metadata = {
  title: 'Validate Supplier List — WNLQ9 PIM',
  description: 'Drop a supplier CSV and get back a taxonomy-validated CSV.',
};

export default function ValidatePage() {
  return <ValidateClient />;
}
