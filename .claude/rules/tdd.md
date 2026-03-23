# Test-Driven Bug Fixes

Every bug fix follows TDD. Discovery tools (CI logs, user reports, canductor verify) reveal bugs; **tests** fix them.

## When any bug is discovered:

1. **Note the symptom.** What failed, what was expected.
2. **Read the relevant source code** to understand the root cause.
3. **Write a failing test** that reproduces the exact bug. The test must fail BEFORE the fix.
4. **Fix the code** so the test passes.
5. **Run the full test suite** to verify no regressions.

## Do NOT:

- Fix a bug without writing a test first
- Skip the test because "it's a small fix"
- Write a test that only passes — verify it fails without the fix too
