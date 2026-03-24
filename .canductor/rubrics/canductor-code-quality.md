# Canductor Code Quality Rubric

Evaluate TypeScript source modules (following `.canductor/templates/module.md`) against these criteria. Score each 0-100 and flag issues.

## Architecture (weight: 30%)
- Functions are small and single-purpose
- Dependencies flow in one direction (cli → core, not the reverse)
- No circular imports between packages
- Types are precise (no `any`, no loose unions)
- Errors are handled explicitly, not swallowed

## Verification Engine (weight: 25%)
- Verification layers are composable and independent
- Policy expressions are correctly parsed and evaluated
- Results log is append-only and consistent (TSV format)
- Feedback loop correctly detects recurring patterns
- Agent-review gracefully handles missing API keys

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
