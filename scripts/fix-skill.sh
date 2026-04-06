#!/bin/bash
# Usage: fix-skill.sh <spoke-vault-path> <skill-name> <new-body>
# Fixes a broken skill in-place (FIX evolution) — backs up the old version
set -euo pipefail
VAULT="${1:?Usage: fix-skill.sh <vault-path> <skill-name> <new-body>}"
SKILL_NAME="${2:?}"
NEW_BODY="${3:?}"
DATE=$(date +"%Y-%m-%d")
SKILL_DIR="${VAULT}/skills/${SKILL_NAME}"
SKILL_FILE="${SKILL_DIR}/SKILL.md"

if [ ! -f "$SKILL_FILE" ]; then
  echo "Skill '${SKILL_NAME}' not found at ${SKILL_FILE}"
  exit 1
fi

# Backup old version
BACKUP="${SKILL_DIR}/SKILL.${DATE}.bak.md"
cp "$SKILL_FILE" "$BACKUP"

# Extract existing frontmatter fields, bump version info
OLD_DESC=$(grep '^description:' "$SKILL_FILE" | sed 's/^description: //')
OLD_TIMES_USED=$(grep '^times_used:' "$SKILL_FILE" | sed 's/^times_used: //' || echo "0")
OLD_TIMES_SUCCESS=$(grep '^times_successful:' "$SKILL_FILE" | sed 's/^times_successful: //' || echo "0")

cat > "$SKILL_FILE" << EOF
---
name: ${SKILL_NAME}
description: ${OLD_DESC}
captured: ${DATE}
origin: fixed
times_used: ${OLD_TIMES_USED}
times_successful: ${OLD_TIMES_SUCCESS}
last_fixed: ${DATE}
---

${NEW_BODY}
EOF
echo "Fixed skill: $SKILL_FILE (backup: $BACKUP)"
