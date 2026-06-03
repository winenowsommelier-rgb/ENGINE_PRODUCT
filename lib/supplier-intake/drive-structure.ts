import type { SupplierPricingStructure } from './types';

export interface SupplierDriveBucket {
  structure: SupplierPricingStructure;
  label: string;
  folder_id: string;
  folder_url: string;
  pricing_behavior: 'use_rsp_when_valid' | 'calculate_from_cost' | 'retail_cash_store_rule';
}

export const SUPPLIER_DRIVE_ROOT_FOLDER_ID = '1Tz6igFwVCCDzFh-k0L-osRRfxrvpPpxG';

export const SUPPLIER_DRIVE_BUCKETS: SupplierDriveBucket[] = [
  {
    structure: 'rsp_price',
    label: '1.RSP PRICE',
    folder_id: '1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY',
    folder_url: 'https://drive.google.com/drive/folders/1n8n0HeiCIh6b6-_rTNM6iN8oY2ONrECY',
    pricing_behavior: 'use_rsp_when_valid',
  },
  {
    structure: 'no_rsp_price',
    label: '2. NO RSP PRICE',
    folder_id: '132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf',
    folder_url: 'https://drive.google.com/drive/folders/132_vwRrD2uoyDUD1hPefgPc_rw5I3Ojf',
    pricing_behavior: 'calculate_from_cost',
  },
  {
    structure: 'retail_cash_store',
    label: '3.Retail Supplier (Cash on store)',
    folder_id: '1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz',
    folder_url: 'https://drive.google.com/drive/folders/1gd-ZHxEKjHlexzGvvYWy4FoyNGGGyNZz',
    pricing_behavior: 'retail_cash_store_rule',
  },
];
