import fs from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';

type SupplierIntakeRow = Record<string, string>;

type SupplierProblem = {
  supplier_code: string;
  supplier_name: string;
  drive_supplier_folder_name: string;
  normalization_readiness: string;
  blocker_or_risk: string;
  recommended_solution: string;
  master_sku_count: string;
};

type SupplierProcessStep = {
  step: string;
  status: string;
  artifact: string;
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
  process_steps: SupplierProcessStep[];
};

const dataRoot = path.join(process.cwd(), 'data', 'supplier-intake');
const summaryPath = path.join(dataRoot, 'supplier_intake_dashboard_summary.json');
const statusPath = path.join(dataRoot, 'supplier_normalization_status.csv');

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
  process_steps: [],
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value);
  return values;
}

function parseCsv(raw: string): SupplierIntakeRow[] {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? '');

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    return headers.reduce<SupplierIntakeRow>((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });
}

export async function GET() {
  try {
    const [summaryRaw, statusRaw] = await Promise.all([
      fs.readFile(summaryPath, 'utf-8'),
      fs.readFile(statusPath, 'utf-8'),
    ]);
    const summary = JSON.parse(summaryRaw) as SupplierIntakeSummary;
    const suppliers = parseCsv(statusRaw);

    return NextResponse.json({
      summary,
      suppliers,
    });
  } catch (error) {
    return NextResponse.json({
      summary: fallbackSummary,
      suppliers: [],
      error: error instanceof Error ? error.message : 'Supplier intake data unavailable',
    }, { status: 200 });
  }
}
