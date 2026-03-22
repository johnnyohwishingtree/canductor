# Canductor Code Quality Rubric

Evaluate the code changes against these criteria. Score each 0-100 and flag issues.

## Architecture (weight: 30%)
- Functions are small and single-purpose
- Dependencies flow in one direction (pipeline → core, not the reverse)
- No circular imports between packages
- Types are precise (no `any`, no loose unions)
- Errors are handled explicitly, not swallowed

## Inngest Patterns (weight: 25%)
- Each step is idempotent (safe to retry)
- Steps are named descriptively (for observability)
- `waitForEvent` has reasonable timeouts
- Side effects (GitHub API calls, LLM calls) happen inside steps, not outside
- Concurrency is considered (no race conditions between parallel runs)

## Testing (weight: 25%)
- New functions have corresponding tests
- Tests cover the happy path AND at least one error path
- Mocks are minimal — prefer testing real logic over mocking everything
- No snapshot tests (use inline assertions)

## Code Style (weight: 20%)
- TypeScript strict mode passes
- No unused imports or variables
- Functions are exported from barrel index.ts files
- Consistent naming: camelCase for functions, PascalCase for types
- Comments explain WHY, not WHAT
