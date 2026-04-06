#!/bin/bash
# Usage: mark-learning-useful.sh <learning-file-path>
# Increments times_useful counter on a learning
set -euo pipefail
FILE="${1:?Usage: mark-learning-useful.sh <learning-file-path>}"

if [ ! -f "$FILE" ]; then
  echo "Learning file not found: $FILE"
  exit 1
fi

# Increment times_useful
CURRENT=$(grep '^times_useful:' "$FILE" | sed 's/^times_useful: //')
NEW=$((${CURRENT:-0} + 1))
sed -i '' "s/^times_useful: .*/times_useful: ${NEW}/" "$FILE"

# Increment times_loaded
LOADED=$(grep '^times_loaded:' "$FILE" | sed 's/^times_loaded: //')
NEW_LOADED=$((${LOADED:-0} + 1))
sed -i '' "s/^times_loaded: .*/times_loaded: ${NEW_LOADED}/" "$FILE"

echo "Marked useful (${NEW}x): $FILE"
