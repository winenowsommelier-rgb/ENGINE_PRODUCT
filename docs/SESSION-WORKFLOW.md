# Session Workflow — working safely in a shared checkout

This repo's working directory is **shared**: parallel processes (background
swarms / workflows) check out branches and revert files **between turns**. Files
you edited can silently change under you; the current branch can be one you never
created. Observed repeatedly (see project memory `feedback_catalog_worktree_isolation`,
`feedback_shared_db_reverts_between_turns`).

**`origin/main` is the source of truth. The local working tree is not.**

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

- **CI** (`.github/workflows/ci.yml`) runs on every PR to `main`:
  the `special_price` export invariant (`tests/test_special_price_export_invariant.py`)
  + catalog typecheck + vitest. A refresh that drops `special_price` fails the PR.
- The full Next.js production build runs on **Vercel** for every PR (CI does not
  duplicate it).
