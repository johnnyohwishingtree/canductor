#!/bin/bash
# Stop hook: log session stats for cost tracking
# Appends to .canductor/session-log.tsv

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // "."')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

LOG_FILE="$CWD/.canductor/session-log.tsv"

# Create header if file doesn't exist
if [ ! -f "$LOG_FILE" ]; then
  mkdir -p "$(dirname "$LOG_FILE")"
  echo -e "timestamp\tstop_reason" > "$LOG_FILE"
fi

STOP_REASON=$(echo "$INPUT" | jq -r '.stop_reason // "unknown"' 2>/dev/null)
echo -e "${TIMESTAMP}\t${STOP_REASON}" >> "$LOG_FILE"
