import type { SupplierPriceProposal, SupplierPricingRule } from './types';

export function roundPrice(value: number, rounding: SupplierPricingRule['rounding']): number {
  if (rounding === 'none') return Math.round(value * 100) / 100;
  if (rounding === 'nearest_1') return Math.round(value);
  if (rounding === 'nearest_5') return Math.round(value / 5) * 5;
  if (rounding === 'nearest_9') return Math.max(9, Math.round(value / 10) * 10 - 1);
  return Math.round(value / 10) * 10;
}

export function calculateSupplierPrice(input: {
  cost: number;
  supplierRsp?: number;
  currentWebsitePrice?: number;
  rule: SupplierPricingRule;
}): SupplierPriceProposal {
  const issues: string[] = [];
  const vatMultiplier = 1 + ((input.rule.vat_pct ?? 0) / 100);
  const formulaBase = input.cost / (1 - input.rule.target_margin_pct / 100);
  const formulaPrice = roundPrice(formulaBase * vatMultiplier, input.rule.rounding);
  const canUseRsp = input.supplierRsp !== undefined && input.supplierRsp > 0;

  let finalPrice = formulaPrice;
  let decisionSource: SupplierPriceProposal['decision_source'] = 'formula';

  if (input.rule.mode === 'supplier_rsp' && canUseRsp) {
    finalPrice = roundPrice(input.supplierRsp!, input.rule.rounding);
    decisionSource = 'supplier_rsp';
  }

  if (input.rule.mode === 'hybrid' && canUseRsp) {
    finalPrice = roundPrice(input.supplierRsp!, input.rule.rounding);
    decisionSource = 'supplier_rsp';
  }

  const marginAmount = finalPrice - input.cost;
  const marginPct = finalPrice > 0 ? (marginAmount / finalPrice) * 100 : 0;

  if (input.cost <= 0) issues.push('Cost must be greater than zero');
  if (finalPrice <= input.cost) issues.push('Selling price must be greater than cost');
  if (marginPct < input.rule.minimum_margin_pct) issues.push('Margin below minimum');

  if (input.currentWebsitePrice && input.currentWebsitePrice > 0) {
    const changePct = Math.abs((finalPrice - input.currentWebsitePrice) / input.currentWebsitePrice) * 100;
    if (changePct > input.rule.review_price_change_pct) issues.push('Price change exceeds review threshold');
  }

  const blocked = issues.some(issue =>
    issue === 'Cost must be greater than zero' ||
    issue === 'Selling price must be greater than cost' ||
    issue === 'Margin below minimum'
  );

  return {
    cost: input.cost,
    supplier_rsp: input.supplierRsp,
    calculated_price: formulaPrice,
    final_selling_price: finalPrice,
    margin_amount: Math.round(marginAmount * 100) / 100,
    margin_pct: Math.round(marginPct * 10) / 10,
    decision_source: decisionSource,
    status: blocked ? 'blocked' : issues.length > 0 ? 'needs_review' : 'auto_approved',
    issues,
  };
}
