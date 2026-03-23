# /canductor-verify — Run Quality Verification

Score the current branch with canductor's verification layers.

## Usage
```
/canductor-verify              # Verify current branch
/canductor-verify --ref PR#N   # Verify a specific ref
```

## Instructions

1. Build canductor if not already built:
```bash
pnpm build
```

2. Run verification:
```bash
node packages/cli/dist/cli.js verify "${REF:-HEAD}"
```

3. Print the composite score and decision.

4. If there are failing layers, show the errors for each.

5. The result is automatically logged to `.canductor/results.tsv`.
