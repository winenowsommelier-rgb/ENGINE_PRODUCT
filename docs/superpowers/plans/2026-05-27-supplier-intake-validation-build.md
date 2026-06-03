# Supplier Intake Validation Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a validated supplier intake process that turns supplier files into normalized CSV, matches or proposes SKUs, detects supplier changes, and produces a reviewable masterfile update path.

**Architecture:** Keep supplier file extraction evidence-first and approval-first. Local scripts produce CSV artifacts from Google Drive folder mappings and the masterfile; the Next.js Settings page exposes readiness, blockers, and review metrics. Matching is split into product identity matching, supplier mapping memory, and SKU proposal so supplier changes do not overwrite existing SKUs silently.

**Tech Stack:** Python CSV tooling for reproducible data processing, Next.js API routes for Settings data, React/Tailwind UI, existing local masterfile CSV, future Google Drive API wiring.

---

### Task 1: Supplier Intake Data Contracts

**Files:**
- Create: `data/supplier-intake/supplier_intake_contract.md`
- Modify: `data/supplier-intake/normalizers/README.md`

- [ ] Define the canonical normalized supplier row fields.
- [ ] Define review statuses: `exact_match`, `probable_match`, `possible_duplicate`, `supplier_changed`, `new_product`, `blocked`.
- [ ] Define required audit references: source file ID, source row, normalized row hash, reviewer, approval timestamp.

### Task 2: Product Identity And Matching Engine

**Files:**
- Create: `data/supplier-intake/product_identity_matcher.py`
- Test by running: `python3 data/supplier-intake/product_identity_matcher.py --self-test`

- [ ] Load the masterfile.
- [ ] Build product identity keys from brand, normalized name, bottle size, vintage, category, country, and region.
- [ ] Match normalized supplier rows by supplier item code, exact product identity, and fuzzy token similarity.
- [ ] Detect supplier changes when identity matches but supplier suffix differs.
- [ ] Output review status, matched SKU, proposed SKU action, confidence score, and reason.

### Task 3: Supplier Mapping Memory

**Files:**
- Create: `data/supplier-intake/supplier_product_mapping_memory.csv`
- Create: `data/supplier-intake/build_supplier_mapping_memory.py`

- [ ] Seed memory from masterfile using SKU suffix and supplier item code where available.
- [ ] Store raw supplier name aliases and product identity ID.
- [ ] Keep first seen, last seen, source file, approval status, and notes columns.

### Task 4: Process Audit And Problem Reports

**Files:**
- Modify: `data/supplier-intake/audit_supplier_normalization.py`
- Output: `data/supplier-intake/supplier_normalization_status.csv`
- Output: `data/supplier-intake/supplier_folder_problem_list.csv`
- Output: `data/supplier-intake/supplier_intake_dashboard_summary.json`

- [ ] Add counts for normalizable, needs profile, blocked, PDF review, and shared-folder rules.
- [ ] Add current SKU counts by SKU suffix.
- [ ] Add recommended next action for each supplier.

### Task 5: Settings API And UI

**Files:**
- Create: `app/api/settings/supplier-intake/route.ts`
- Modify: `components/pages/SettingsPage.tsx`

- [ ] Serve dashboard summary and problem rows from generated CSV/JSON.
- [ ] Add Supplier Intake section in Settings.
- [ ] Show readiness counters, top blocked suppliers, and next actions.

### Task 6: Verification

**Files:**
- Use existing scripts and `npm run typecheck`.

- [ ] Run Python compile checks for new scripts.
- [ ] Run supplier audit generation.
- [ ] Run Next.js typecheck.
- [ ] If the app is run locally, verify the Settings page renders the Supplier Intake section.

