# Commit Gate

Before EVERY `git commit`, run these in order:

1. `pnpm build` — must exit 0
2. `pnpm typecheck` — must exit 0
3. `pnpm test` — must exit 0

If any fail, fix the errors first. Only commit after all checks pass.

Never use `git add -A` or `git add .` — always add specific files.
Check `git status` before committing to verify only intended files are staged.
