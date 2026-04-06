#!/bin/bash
# Usage: capture-skill.sh <spoke-vault-path> <skill-name> <description> <body>
# Captures a successful task pattern as a reusable skill (CAPTURED evolution)
set -euo pipefail
VAULT="${1:?Usage: capture-skill.sh <vault-path> <skill-name> <description> <body>}"
SKILL_NAME="${2:?}"
DESCRIPTION="${3:?}"
BODY="${4:?}"
DATE=$(date +"%Y-%m-%d")
SKILL_DIR="${VAULT}/skills/${SKILL_NAME}"
SKILL_FILE="${SKILL_DIR}/SKILL.md"

mkdir -p "${SKILL_DIR}"

if [ -f "$SKILL_FILE" ]; then
  echo "Skill '${SKILL_NAME}' already exists at ${SKILL_FILE} — use fix-skill.sh to update it"
  exit 1
fi

cat > "$SKILL_FILE" << EOF
---
name: ${SKILL_NAME}
description: ${DESCRIPTION}
captured: ${DATE}
origin: auto-captured
times_used: 0
times_successful: 0
---

${BODY}
EOF
echo "Captured skill: $SKILL_FILE"
