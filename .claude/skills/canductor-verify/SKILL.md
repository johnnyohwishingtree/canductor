---
name: canductor-verify
description: Run canductor quality verification on the current branch
argument-hint: "[--ref REF] [--self-review] [--review-json JSON]"
---

# /canductor-verify — Run Quality Verification

Score the current branch with canductor's verification layers (typecheck, tests, code_quality). Outputs a composite score and auto_merge/block/human_review decision. Use after implementing a story to check if it meets the quality bar.

## Usage
```
/canductor-verify              # Verify current branch
/canductor-verify --ref PR#N   # Verify a specific ref
/canductor-verify --self-review # Get the rubric prompt for self-evaluation
```

## Steps

### Step 1: Check preconditions

Ensure canductor is built before running verification.

```bash
pnpm build
```

If build fails, say "Build failed — fix compilation errors before verifying" and stop.

### Step 2: Run verification

Choose the appropriate mode based on what's needed:

**Standard verification** (typecheck + tests only, code_quality skipped without API key):
```bash
node packages/cli/dist/cli.js verify "${REF:-HEAD}"
```

**Self-review mode** (get the rubric prompt for the parent Claude to evaluate):
```bash
node packages/cli/dist/cli.js verify --self-review
```

Read the output carefully. It contains the rubric criteria and code context. Evaluate the code against:
- **Architecture (30%)**: small functions, correct dependency direction, no `any`, explicit error handling
- **Verification Engine (25%)**: layers composable and independent, results log consistent
- **Testing (25%)**: new functions have tests, happy path + at least one error path
- **Code Style (20%)**: strict mode passes, no unused imports, barrel exports, camelCase/PascalCase

Produce a JSON result:
```json
{"pass": true, "score": 85, "issues": [], "summary": "Clean implementation"}
```

**Full verification with self-review result injected:**
```bash
node packages/cli/dist/cli.js verify "${REF:-HEAD}" --review-json '{"pass":true,"score":85,"issues":[],"summary":"Clean implementation"}'
```

### Step 3: Evaluate the result

Read the composite score and decision from the output:
- **`auto_merge`** (score >= 80): Code meets the quality bar. Safe to merge.
- **`human_review`** (score 60-79): Code needs improvement. Review the failing layers.
- **`block`** (score < 60): Code has critical issues. Do not merge.

If there are failing layers, show the errors for each.

### Step 4: Report

Print the composite score, decision, and per-layer breakdown.

The result is automatically logged to `.canductor/results.tsv`.

If the decision is not `auto_merge`:
- List the specific issues from each failing layer
- Suggest concrete fixes for each issue
- Recommend re-running after fixes: `/canductor-verify`

## Template Maintenance

<!-- canductor:skill-template-version:1 -->
<!-- Last updated: 2026-03-23 -->
<!-- Update this skill when: new CLI flags are added, new verification layers exist, or scoring thresholds change -->
