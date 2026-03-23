# Commit Gate

Before EVERY `git commit`, run the verification commands from the **Run Commands** section in `CLAUDE.md`. All must exit 0.

If any fail, fix the errors first. Only commit after all checks pass.

Never use `git add -A` or `git add .` — always add specific files.
Check `git status` before committing to verify only intended files are staged.
