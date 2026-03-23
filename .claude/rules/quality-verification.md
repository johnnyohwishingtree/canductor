# Quality Verification

After implementing a story and before merging, run canductor verification:

```bash
node packages/cli/dist/cli.js verify "$REF" --review-json '<self-review JSON>'
```

The decision must be `auto_merge` before proceeding. If `human_review` or `block`, fix the issues and re-verify.

After merging, commit the updated results log:

```bash
git add .canductor/results.tsv
git diff --cached --quiet || git commit -m "chore: log canductor result for #$NUMBER" && git push origin master
```

The results log is the project's quality history. Never skip logging.
