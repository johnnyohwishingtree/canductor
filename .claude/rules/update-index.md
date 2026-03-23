# Update Index on .claude/ Changes

When you add, remove, or rename any file in `.claude/` (rules, templates, patterns, rubrics, or skills), update `.claude/index.md` to reflect the change.

The index is the single lookup table for the entire system. If it's stale, the pipeline reads the wrong files or misses new ones.

Also update `CLAUDE.md` if the change affects the project's rules or skills reference sections.
