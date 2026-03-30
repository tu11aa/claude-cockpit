#!/bin/bash
# Usage: record-learning.sh <spoke-vault-path> <category> <content>
set -euo pipefail
VAULT="${1:?Usage: record-learning.sh <vault-path> <category> <content>}"
CATEGORY="${2:?}"
CONTENT="${3:?}"
DATE=$(date +"%Y-%m-%d")
TIMESTAMP=$(date +"%H%M%S")
SLUG=$(echo "$CONTENT" | head -c 40 | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]//g')
FILENAME="${VAULT}/learnings/${DATE}-${SLUG}-${TIMESTAMP}.md"
mkdir -p "${VAULT}/learnings"
cat > "$FILENAME" << EOF
---
type: learning
date: ${DATE}
category: ${CATEGORY}
applied: false
---

## What happened
${CONTENT}

## Suggestion

EOF
echo "Recorded learning: $FILENAME"
