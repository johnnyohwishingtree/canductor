---
name: <kebab-case-name>
description: <one line — what this skill does>
argument-hint: "[optional args]"
---

# /<skill-name> — <Title>

<One paragraph: what this skill does and when to use it.>

## Usage
```
/<skill-name>              # Default invocation
/<skill-name> --flag       # With options
```

## Steps

### Step 1: <Check preconditions>

Before doing work, verify the environment is ready. Exit early if not.

```bash
# Check for required state — fail fast
<command to verify preconditions>
```

If <precondition not met>, say "<reason>" and stop.

### Step 2: <Do the work>

<Clear instructions with explicit bash commands.>

Rules:
- <Specific constraint>
- <Another constraint>

### Step 3: <Verify the work>

Run checks before considering the work done:
```bash
<verification command>
```

If verification fails:
- <What to fix>
- <How many retries>
- <What to do if all retries fail — the discard path>

### Step 4: <Commit/deliver the result>

Only reached if Step 3 passed.

```bash
<delivery commands>
```

### Step 5: <Clean up and report>

```bash
<cleanup commands>
```

## Template Maintenance

<!-- canductor:skill-template-version:1 -->
<!-- Last updated: YYYY-MM-DD -->
<!-- Update this skill when: new CLI flags are added, new verification layers exist, or the pipeline loop changes -->
