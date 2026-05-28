import { buildMatchProposal } from '@/lib/supplier-intake/matching';

const products = [
  { id: 'p1', sku: 'WRW0001AA', name: 'Chateau Example Rouge 2020', brand: 'Chateau Example', bottle_size: '750ml', vintage: '2020' },
  { id: 'p2', sku: 'WRW0002AA', name: 'Other Wine 2021', brand: 'Other', bottle_size: '750ml', vintage: '2021' },
];

describe('buildMatchProposal', () => {
  it('returns strong match for exact SKU', () => {
    const proposal = buildMatchProposal({ sku: 'WRW0001AA', name: 'Different label', cost: 400, currency: 'THB' }, products);
    expect(proposal.status).toBe('strong_match');
    expect(proposal.selected_sku).toBe('WRW0001AA');
  });

  it('returns likely match from brand, name, size, and vintage', () => {
    const proposal = buildMatchProposal({
      name: 'Chateau Example Rouge',
      brand: 'Chateau Example',
      bottle_size: '750ml',
      vintage: '2020',
      cost: 455,
      currency: 'THB',
    }, products);
    expect(proposal.status).toBe('likely_match');
    expect(proposal.candidates[0].sku).toBe('WRW0001AA');
  });
});
