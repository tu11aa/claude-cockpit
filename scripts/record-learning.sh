#!/bin/bash
# Usage: record-learning.sh <spoke-vault-path> <category> <content> [tags]
# Tags: comma-separated keywords for selective loading (e.g., "cairo,escrow,pvp")
set -euo pipefail
VAULT="${1:?Usage: record-learning.sh <vault-path> <category> <content> [tags]}"
CATEGORY="${2:?}"
CONTENT="${3:?}"
TAGS="${4:-}"
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
times_loaded: 0
times_useful: 0
tags: [${TAGS}]
---

## What happened
${CONTENT}

## Suggestion

EOF
echo "Recorded learning: $FILENAME"
