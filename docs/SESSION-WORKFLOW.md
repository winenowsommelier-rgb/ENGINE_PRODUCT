# Session Workflow — working safely in a shared checkout

This repo's working directory is **shared**: parallel processes (background
swarms / workflows) check out branches and revert files **between turns**. Files
you edited can silently change under you; the current branch can be one you never
created. Observed repeatedly (see project memory `feedback_catalog_worktree_isolation`,
`feedback_shared_db_reverts_between_turns`).

**`origin/main` is the source of truth. The local working tree is not.**

## Root cause: shared worktrees

The repo uses multiple git **worktrees** (one clone, several branches checked out
at once): `git worktree list` shows e.g. `.worktrees/phase-b-run2`,
`.claude/worktrees/catalog-work`, etc. Background agents spawn these and switch
branches — including in the MAIN working directory — which is why files "revert"
and the branch changes between turns.

**Do MY work in a dedicated worktree** so a parallel process can't disturb the
main checkout mid-task:

```bash
git fetch origin
git worktree add .worktrees/<task-name> -b <task-branch> origin/main
cd .worktrees/<task-name>
# (for the catalog, symlink deps:  ln -s ../../apps/catalog/node_modules apps/catalog/node_modules)
# ...do the work, commit, push, open PR from here...
git worktree remove .worktrees/<task-name>   # when done & merged
```

The main checkout stays untouched; the parallel automation keeps running.

### Realigning a drifted local `main`

If local `main` has stale commits not on origin (check:
`git rev-list --left-right --count main...origin/main` → left>0 means local-only),
and those commits are already on origin via PRs (verify before discarding):

```bash
git tag backup-local-main-$(date +%F) main   # recoverable safety net
git fetch origin
git checkout main
git reset --hard origin/main                  # local main == deployed
```

## Before trusting anything local

```bash
git fetch origin
git log --oneline origin/main -5        # what is actually shipped
git branch --show-current               # may NOT be the branch you left on
git status --short                       # files may have reverted
```

Never assume a file on disk is what you last wrote. To check what is really
merged/deployed, read from the remote, not the working tree:

```bash
git show origin/main:path/to/file        # the real, shipped content
git cat-file -e origin/main:path/to/file # exists on main? (exit 0 = yes)
```

## Doing work

1. **Branch off the remote**, not local main (local main drifts):
   ```bash
   git fetch origin && git checkout -b my-task origin/main
   ```
2. Make changes, **stage explicitly by path** — never `git add -A`/`.`; a
   parallel process leaves unrelated files in the tree and they get bundled into
   your commit/PR (this caused bundling into PR #26, and a stray `page.tsx`
   nearly rode along with the invariant test).
   ```bash
   git status --short        # confirm what changed
   git add path/to/only/your/files
   git diff --cached --name-only   # verify scope before commit
   ```
3. Push and open a PR. **Do NOT push to `main` directly.**
4. **Squash-merge note:** after a squash merge, `gh pr merge` may print
   `fatal: Not possible to fast-forward` — that is `gh` failing to update the
   *local* checkout only. The remote merge still succeeded. Verify with
   `gh pr view <n> --json state` (look for `MERGED`) and `git log origin/main`.

## Verifying paid / data work shipped (CLAUDE.md Rule 1)

Counting local rows is not verification — the local export drifts. Verify at the
real destination:

```bash
# what CI/Vercel actually see (committed export on the remote):
git show origin/main:data/live_products_export.json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); print(sum(1 for p in d if p.get('special_price')))"

# and on the live storefront:
curl -s https://wnlq9-catalog.vercel.app/product/<SKU> | grep -c bg-destructive
```

## Don't

- ❌ `git reset --hard` to "fix" drift (irreversibly discards work; blocked for good reason).
- ❌ `git push --force` to a shared branch (rewrites history others may build on).
  When a branch's history got tangled by a squash merge, **open a fresh branch**
  from `origin/main` instead of force-pushing (this is how PR #39 → #40 was handled).
- ❌ Trust a session summary's description of file state — verify on disk + remote.

## Safety nets that now exist

- **Vercel build guard** — `apps/catalog/scripts/check-export-invariants.mjs` runs
  in the catalog `prebuild` (so it runs on EVERY Vercel deploy, before `next build`).
  If the committed `live_products_export.json` has lost its `special_price` rows, it
  throws and **fails the deploy** — the bad export never reaches production. Mirrors
  `tests/test_special_price_export_invariant.py`.
- The Python invariant tests (`tests/test_special_price_export_invariant.py`) still
  exist for local/manual runs (`pytest`). Run them after any bulk DB write/refresh.

> Note: GitHub Actions is NOT used as the gate — runners would not start on this
> account (first-ever run failed at provisioning, 0 steps). The guard lives in the
> Vercel build instead, which already runs on every PR/deploy. If Actions is fixed
> later, the pytest + vitest suites can be wired back in.
