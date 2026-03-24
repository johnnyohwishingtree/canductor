# Test Quality Rubric

Evaluate test files (following `.canductor/templates/test.md`) against these criteria.

## Coverage (weight: 35%)
- Every exported function has a corresponding `describe` block
- Happy path is tested (valid input → expected output)
- At least one error path is tested per function (invalid input, missing file, command failure)
- Edge cases are tested where applicable (empty input, boundary values, zero-length arrays)

## Assertions (weight: 25%)
- Assertions check specific values, not just existence (`toBe(100)` not `toBeDefined()`)
- Error messages are asserted (`toContain('descriptive message')` not just `pass === false`)
- Return type shape is verified (all relevant fields checked, not just one)
- No snapshot files — inline assertions only

## Isolation (weight: 20%)
- Tests use temp directories for filesystem operations (`mkdtempSync` + `rmSync` in setup/teardown)
- Tests do not depend on execution order — each `it()` sets up its own state
- Mocks are minimal — real logic tested where possible
- Environment mutations (e.g., `process.env`) are restored in `afterEach`

## Clarity (weight: 20%)
- Test names describe behavior, not implementation (`'returns pass when command exits 0'` not `'calls execSync'`)
- Factory functions abstract repeated test data — individual tests only set scenario-specific fields
- One logical assertion group per `it()` — not 10 unrelated expects in one test
- `describe` blocks have section separator comments for visual scanning

<!-- canductor:rubric-version:1 -->
