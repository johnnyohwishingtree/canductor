#!/bin/bash
# PostToolUse hook: auto-run typecheck after file edits
# Catches type errors immediately instead of at commit time

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Only typecheck TypeScript files
if [[ "$FILE" == *.ts || "$FILE" == *.tsx ]]; then
  cd "$(echo "$INPUT" | jq -r '.cwd // "."')"
  ERRORS=$(pnpm typecheck 2>&1 | grep "error TS" | head -5)
  if [ -n "$ERRORS" ]; then
    echo '{"result": "Type errors detected after edit:\n'"$(echo "$ERRORS" | tr '\n' ' ')"'"}'
  fi
fi
