import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

type SupplierProblem = {
  supplier_code: string;
  supplier_name: string;
  drive_supplier_folder_name: string;
  normalization_readiness: string;
  blocker_or_risk: string;
  recommended_solution: string;
  master_sku_count: string;
};

type SupplierIntakeSummary = {
  generated_at: string;
  total_supplier_codes: number;
  problem_supplier_codes: number;
  readiness_counts: Record<string, number>;
  profiled_supplier_codes: number;
  mapped_folder_supplier_codes: number;
  master_sku_rows_represented: number;
  top_problem_suppliers: SupplierProblem[];
  ready_supplier_codes: SupplierProblem[];
};

const summaryPath = path.join(process.cwd(), 'data', 'supplier-intake', 'supplier_intake_dashboard_summary.json');

const fallbackSummary: SupplierIntakeSummary = {
  generated_at: '',
  total_supplier_codes: 0,
  problem_supplier_codes: 0,
  readiness_counts: {},
  profiled_supplier_codes: 0,
  mapped_folder_supplier_codes: 0,
  master_sku_rows_represented: 0,
  top_problem_suppliers: [],
  ready_supplier_codes: [],
};

export async function GET() {
  try {
    const raw = await fs.readFile(summaryPath, 'utf-8');
    const summary = JSON.parse(raw) as SupplierIntakeSummary;
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json({
      summary: fallbackSummary,
      error: error instanceof Error ? error.message : 'Supplier intake summary unavailable',
    }, { status: 200 });
  }
}

