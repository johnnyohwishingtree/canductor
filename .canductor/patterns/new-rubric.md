# Pattern: Add a New Quality Rubric

When adding a new quality dimension to evaluate (e.g., documentation quality, security review).

**Templates used:** `templates/rubric.md`
**Rubrics applied:** Self-evaluating (rubric template defines rubric structure)

## Files to create/modify (in order)

### 1. `.canductor/rubrics/<domain>-quality.md` — Create the rubric

Follow `.canductor/templates/rubric.md`:
- Weights sum to 100%
- 2-5 categories
- Every criterion is observable (can be checked by reading code or running a command)
- Reference the matching template if one exists

### 2. `.canductor/config.yaml` — Wire it up

Add an `agent-review` layer that uses the rubric:
```yaml
<domain>_review:
  name: <domain>_review
  type: agent-review
  rubric: ".canductor/rubrics/<domain>-quality.md"
  context: ["<paths to evaluate>"]
  weight: 0.6
```

### 3. `.canductor/templates/rubric.md` — Update cross-reference table

Add the new rubric to the template-rubric pairs table so future pipeline runs know the mapping.

### 4. Create a matching template (if applicable)

If this rubric evaluates a new type of artifact the pipeline creates, also create a matching template in `.canductor/templates/`. See `templates/rubric.md` for the pairs table.

### 5. Update policy (if needed)

If the new layer should affect merge decisions, update the policy expressions in `config.yaml`:
```yaml
policy:
  auto_merge: "all_deterministic_pass AND all_pass"  # all_pass now includes the new layer
```

### 6. Test the rubric

Run a self-review to verify the rubric produces meaningful results:
```bash
node packages/cli/dist/cli.js verify --self-review
```

Read the output for the new layer and evaluate manually. Criteria that are too vague or too strict should be revised before committing.

## Checklist

- [ ] Rubric file created following template
- [ ] Weights sum to 100%
- [ ] All criteria are observable (not subjective)
- [ ] config.yaml layer added
- [ ] Cross-reference table in `templates/rubric.md` updated
- [ ] Matching template created (if applicable)
- [ ] Self-review produces meaningful output
- [ ] `pnpm build && pnpm typecheck && pnpm test` passes

<!-- canductor:pattern-version:1 -->
