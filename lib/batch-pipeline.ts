import { buildFlavorProfile, calculateConfidence } from '@/lib/auto-mapping';
import { type ProductRecord } from '@/lib/data';

export type PipelineStage = {
  name: string;
  outcome: string;
  status: 'complete' | 'attention' | 'queued';
};

export function runPipelinePreview(products: ProductRecord[]): PipelineStage[] {
  const rejectedRows = products.filter((product) => !product.sku).length;
  const lowConfidence = products.filter((product) => calculateConfidence(product) < 3.5).length;
  const enriched = products.filter((product) => {
    const profile = buildFlavorProfile(product);
    return profile.intensity > 0;
  }).length;

  return [
    {
      name: 'Validate columns',
      outcome: rejectedRows === 0 ? 'Required identifiers and scoring ranges passed validation.' : `${rejectedRows} rows were rejected for missing SKU values.`,
      status: rejectedRows === 0 ? 'complete' : 'attention'
    },
    {
      name: 'Normalize taxonomy',
      outcome: 'Grape, style, and regional values mapped to controlled vocabularies before enrichment.',
      status: 'complete'
    },
    {
      name: 'Apply DNA engine',
      outcome: `${enriched} records received flavor structure from grape, style, and terroir mappings.`,
      status: 'complete'
    },
    {
      name: 'Flag low confidence',
      outcome: lowConfidence > 0 ? `${lowConfidence} records need human review before publishing.` : 'No records fell below the confidence threshold.',
      status: lowConfidence > 0 ? 'attention' : 'complete'
    },
    {
      name: 'Export and handoff',
      outcome: 'Magento-ready CSV/XLSX bundles can be generated for all approved rows.',
      status: 'queued'
    }
  ];
}
