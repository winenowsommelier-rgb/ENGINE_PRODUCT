# WN/LIQ9 Product Engine — Operating Rules

## ABSOLUTE RULES (do not violate — they exist because of past costly failures)

### Rule 1 — Verify, don't infer, that paid work landed where it should
Whenever you spend money calling an external API (Anthropic, OpenAI, any
paid LLM), do not declare the run "complete" or report progress until you
have **verified the data actually arrived in the user-facing destination**.

Counting cache rows, log lines, or "X/N processed" is NOT verification.
Run a direct query against the final destination (products table, the UI
endpoint, Supabase) and confirm the field you paid to populate is actually
populated. Show the user a SQL count or a curl response. If the field is
NULL or empty, the work is NOT done — re-investigate before claiming success.

History: in May 2026, ~$56 of Anthropic credit was wasted on Phase 5
enrichment because the descriptive payload was silently dropped by a
threshold gate in LocalRouter. Progress was reported as "33% enriched"
based on taste_profile rows, while desc_en_short / wine_body / flavor_tags
were 0/3,807. The user paid for data that the UI never showed.

### Rule 2 — Log-line warnings are warnings; investigate them
If the pipeline prints status like "→ CSV ONLY", "skipped", "below
threshold", "fallback used", or any non-success state for the majority of
items, STOP and explain to the user why. Do not let "CSV ONLY" appear on
hundreds of lines without asking what it means.

### Rule 3 — Inherited thresholds & magic numbers are NOT validated by the caller
Constants from prior versions (e.g. write_threshold=0.85 in LocalRouter)
were tuned for a different data distribution. When you add a new
classification, category, or pipeline stage, audit every threshold for
whether it still makes sense — especially confidence cutoffs, retry caps,
and timeout values. Don't assume the previous engineer got it right.

### Rule 4 — Cost reports require a "what shipped to users" line
Every cost summary must include:
- Total spend
- Number of API calls
- **Number of rows where the final user-facing fields are populated**
- Per-successful-row cost

Spend-without-shipping is the failure mode this rule prevents.

### Rule 5 — Tests that lock in a bug are anti-tests; rewrite them
If a unit test asserts behavior that turns out to be the bug
(e.g. `assert wine_body is None  # unchanged` on a sub-threshold row),
do not keep it green by preserving the bug. Update the test to assert
the correct behavior, add a regression-guard comment explaining the
history, and verify the new behavior fixes the user-visible problem.

### Rule 6 — End-to-end invariants are NOT optional
For any pipeline that writes to a user-facing table, write an integration
test that asserts the invariant:
**if upstream cache/state has data for record X, then the user-facing
table has the corresponding field populated for record X**.
See `tests/test_enrichment_db_invariants.py` for the canonical pattern.
Run it after every bulk write.

### Rule 7 — UI changes require browser verification
For ANY change that affects the UI (component, API endpoint, data shape):
- Start the dev server
- Open the actual URL the user would visit
- Click through the user journey end-to-end
- Verify the change renders, doesn't crash, and looks right

"TypeScript compiles" / "tests pass" is necessary but NOT sufficient.
A working UI is the only proof a UI change works.

### Rule 8 — When the user is angry, fix what they're angry about first
Do not lecture, do not over-explain, do not add unrelated work.
Identify the smallest action that produces visible improvement for them.
Execute that action. Show them the result. Then continue.

### Rule 9 — There are TWO data sources; know which one you're reading
The explore UI reads `data/live_products_export.json`, NOT the SQLite DB
directly. Bulk writes to products.db must be followed by:

    .venv/bin/python scripts/refresh_live_export.py

If users say "I don't see the change", check that file's age first.

### Rule 10 — Pre-flight checklist before any bulk paid run
Before kicking off any Phase-5-style bulk enrichment that will spend money:
1. Backup the target table (`cp products.db products.db.bak-pre-X`)
2. Run on a 5-SKU canary; verify in the UI before scaling up
3. Confirm the success/skip ratio on the canary matches expectations
4. Estimate full-run cost from canary's per-SKU rate; show user the number
5. Get user sign-off on the estimate
6. Run the full job
7. Verify with a count query AND a UI walkthrough that the data shipped

Skipping any step is how money gets wasted.

## Ruflo — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — use `/src`, `/tests`, `/docs`, `/config`, `/scripts`
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Agent Comms (SendMessage-First Coordination)

Named agents coordinate via `SendMessage`, not polling or shared state.

```
Lead (you) ←→ architect ←→ developer ←→ tester ←→ reviewer
              (named agents message each other directly)
```

### Spawning a Coordinated Team

```javascript
// ALL agents in ONE message, each knows WHO to message next
Agent({ prompt: "Research the codebase. SendMessage findings to 'architect'.",
  subagent_type: "researcher", name: "researcher", run_in_background: true })
Agent({ prompt: "Wait for 'researcher'. Design solution. SendMessage to 'coder'.",
  subagent_type: "system-architect", name: "architect", run_in_background: true })
Agent({ prompt: "Wait for 'architect'. Implement it. SendMessage to 'tester'.",
  subagent_type: "coder", name: "coder", run_in_background: true })
Agent({ prompt: "Wait for 'coder'. Write tests. SendMessage results to 'reviewer'.",
  subagent_type: "tester", name: "tester", run_in_background: true })
Agent({ prompt: "Wait for 'tester'. Review code quality and security.",
  subagent_type: "reviewer", name: "reviewer", run_in_background: true })

// Kick off the pipeline
SendMessage({ to: "researcher", summary: "Start", message: "[task context]" })
```

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | A → B → C → D | Sequential dependencies (feature dev) |
| **Fan-out** | Lead → A, B, C → Lead | Independent parallel work (research) |
| **Supervisor** | Lead ↔ workers | Ongoing coordination (complex refactor) |

### Rules

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Swarm & Routing

### Config
- **Topology**: hierarchical-mesh (anti-drift)
- **Max Agents**: 15
- **Memory**: hybrid
- **HNSW**: Enabled
- **Neural**: Enabled

```bash
npx @claude-flow/cli@latest swarm init --topology hierarchical --max-agents 8 --strategy specialized
```

### Agent Routing

| Task | Agents | Topology |
|------|--------|----------|
| Bug Fix | researcher, coder, tester | hierarchical |
| Feature | architect, coder, tester, reviewer | hierarchical |
| Refactor | architect, coder, reviewer | hierarchical |
| Performance | perf-engineer, coder | hierarchical |
| Security | security-architect, auditor | hierarchical |

### When to Swarm
- **YES**: 3+ files, new features, cross-module refactoring, API changes, security, performance
- **NO**: single file edits, 1-2 line fixes, docs updates, config changes, questions

### 3-Tier Model Routing

| Tier | Handler | Use Cases |
|------|---------|-----------|
| 1 | Agent Booster (WASM) | Simple transforms — skip LLM, use Edit directly |
| 2 | Haiku | Simple tasks, low complexity |
| 3 | Sonnet/Opus | Architecture, security, complex reasoning |

## Memory & Learning

### Before Any Task
```bash
npx @claude-flow/cli@latest memory search --query "[task keywords]" --namespace patterns
npx @claude-flow/cli@latest hooks route --task "[task description]"
```

### After Success
```bash
npx @claude-flow/cli@latest memory store --namespace patterns --key "[name]" --value "[what worked]"
npx @claude-flow/cli@latest hooks post-task --task-id "[id]" --success true --store-results true
```

### MCP Tools (use `ToolSearch("keyword")` to discover)

| Category | Key Tools |
|----------|-----------|
| **Memory** | `memory_store`, `memory_search`, `memory_search_unified` |
| **Bridge** | `memory_import_claude`, `memory_bridge_status` |
| **Swarm** | `swarm_init`, `swarm_status`, `swarm_health` |
| **Agents** | `agent_spawn`, `agent_list`, `agent_status` |
| **Hooks** | `hooks_route`, `hooks_post-task`, `hooks_worker-dispatch` |
| **Security** | `aidefence_scan`, `aidefence_is_safe`, `aidefence_has_pii` |
| **Hive-Mind** | `hive-mind_init`, `hive-mind_consensus`, `hive-mind_spawn` |

### Background Workers

| Worker | When |
|--------|------|
| `audit` | After security changes |
| `optimize` | After performance work |
| `testgaps` | After adding features |
| `map` | Every 5+ file changes |
| `document` | After API changes |

```bash
npx @claude-flow/cli@latest hooks worker dispatch --trigger audit
```

## Agents

**Core**: `coder`, `reviewer`, `tester`, `planner`, `researcher`
**Architecture**: `system-architect`, `backend-dev`, `mobile-dev`
**Security**: `security-architect`, `security-auditor`
**Performance**: `performance-engineer`, `perf-analyzer`
**Coordination**: `hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`
**GitHub**: `pr-manager`, `code-review-swarm`, `issue-tracker`, `release-manager`

Any string works as a custom agent type.

## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing

```bash
npm run build && npm test
```

## CLI Quick Reference

```bash
npx @claude-flow/cli@latest init --wizard           # Setup
npx @claude-flow/cli@latest swarm init --v3-mode     # Start swarm
npx @claude-flow/cli@latest memory search --query "" # Vector search
npx @claude-flow/cli@latest hooks route --task ""    # Route to agent
npx @claude-flow/cli@latest doctor --fix             # Diagnostics
npx @claude-flow/cli@latest security scan            # Security scan
npx @claude-flow/cli@latest performance benchmark    # Benchmarks
```

26 commands, 140+ subcommands. Use `--help` on any command for details.

## Setup

```bash
claude mcp add claude-flow -- npx -y @claude-flow/cli@latest
npx @claude-flow/cli@latest daemon start
npx @claude-flow/cli@latest doctor --fix
```

**Agent tool** handles execution (agents, files, code, git). **MCP tools** handle coordination (swarm, memory, hooks). **CLI** is the same via Bash.
