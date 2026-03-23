# Skill Quality Rubric

Evaluate Claude Code skill files (.claude/skills/*/SKILL.md) against these criteria.

## Clarity (weight: 30%)
- Every step has an explicit bash command or concrete action — no vague verbs like "handle", "process", "deal with"
- Success and failure paths are both defined for every step that can fail
- No implicit assumptions — if a tool/command is needed, it's spelled out
- Steps are numbered and sequential with clear control flow (if/else, loops)

## Completeness (weight: 25%)
- All edge cases are covered: empty results, API failures, merge conflicts, permission errors
- Error recovery paths exist: what happens when a step fails? Retry? Skip? Abort?
- The skill has a clear entry condition (when to run) and exit condition (when to stop)
- State transitions are explicit: what labels/status change at each phase?

## Self-Awareness (weight: 20%)
- If the skill modifies code that the skill itself references, it includes a self-update check
- The skill references files by path, not by memory — reads CLAUDE.md, rubrics, etc. at runtime
- The skill doesn't hardcode values that come from config (repo names, branch prefixes, label names)
- The skill logs its own results so future runs can learn from past outcomes

## Efficiency (weight: 15%)
- No redundant steps — each step produces a meaningful state change
- Long operations happen early so failures are caught before wasting work
- Context is loaded once and reused, not re-read at every step
- The skill minimizes unnecessary git operations and API calls

## Anti-Patterns (weight: 10%)
- No "hope-based" merging — always verify before merge, never assume CI will catch issues
- No silent failures — every command that can fail has its output checked
- No unbounded loops — retry limits are explicit (e.g., "up to 6 attempts")
- No self-grading without criteria — if the skill evaluates its own output, it uses a rubric file
- No context window bloat — the skill doesn't read entire codebases when targeted reads suffice
