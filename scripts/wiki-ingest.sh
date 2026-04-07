#!/bin/bash
# Usage: wiki-ingest.sh <spoke-vault-path> <page-slug> <title> <category> <body> [tags] [source]
# Creates or updates a wiki page and updates the index and log.
# Categories: Architecture, Patterns, APIs, Configuration, Debugging, Conventions, Dependencies, Deployment
set -euo pipefail

VAULT="${1:?Usage: wiki-ingest.sh <vault> <slug> <title> <category> <body> [tags] [source]}"
SLUG="${2:?}"
TITLE="${3:?}"
CATEGORY="${4:?}"
BODY="${5:?}"
TAGS="${6:-}"
SOURCE="${7:-manual}"
DATE=$(date +"%Y-%m-%d")
TIME=$(date +"%H:%M:%S")

WIKI_DIR="${VAULT}/wiki"
PAGES_DIR="${WIKI_DIR}/pages"
PAGE_FILE="${PAGES_DIR}/${SLUG}.md"
INDEX_FILE="${WIKI_DIR}/index.md"
LOG_FILE="${WIKI_DIR}/log.md"

mkdir -p "${PAGES_DIR}"

# Determine if this is a create or update
ACTION="created"
if [ -f "$PAGE_FILE" ]; then
  ACTION="updated"
fi

# Write the page
cat > "$PAGE_FILE" << EOF
---
title: "${TITLE}"
category: ${CATEGORY}
created: "${DATE}"
updated: "${DATE}"
tags: [${TAGS}]
source: "${SOURCE}"
---

# ${TITLE}

${BODY}

## Related
<!-- Add [[page-slug]] links to related pages -->
EOF

# Append to log (newest first, after the marker comment)
if [ -f "$LOG_FILE" ]; then
  ENTRY="- **${DATE} ${TIME}** — ${ACTION} [${TITLE}](pages/${SLUG}.md) (${CATEGORY})"
  MARKER="<!-- Entries will be appended by wiki-ingest -->"
  if grep -qF "$MARKER" "$LOG_FILE"; then
    # Insert entry right after the marker line
    sed -i '' "/$MARKER/a\\
${ENTRY}
" "$LOG_FILE"
  else
    echo "$ENTRY" >> "$LOG_FILE"
  fi
fi

# Rebuild index by scanning all pages
if [ -f "$INDEX_FILE" ]; then
  python3 -c "
import os, re, glob

pages_dir = '${PAGES_DIR}'
index_file = '${INDEX_FILE}'

# Parse all pages
pages = {}
for f in sorted(glob.glob(os.path.join(pages_dir, '*.md'))):
    slug = os.path.basename(f).replace('.md', '')
    with open(f) as fh:
        content = fh.read()
    # Extract frontmatter
    m = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not m:
        continue
    fm = m.group(1)
    title = re.search(r'title:\s*\"?(.+?)\"?\s*$', fm, re.M)
    category = re.search(r'category:\s*(.+)', fm)
    title = title.group(1) if title else slug
    category = category.group(1).strip() if category else 'Uncategorized'
    pages.setdefault(category, []).append((slug, title))

# Detect index type from existing frontmatter
index_type = 'wiki-index'
project_line = ''
with open(index_file) as f:
    existing = f.read()
    tm = re.search(r'type:\s*(.+)', existing)
    if tm:
        index_type = tm.group(1).strip()
    pm = re.search(r'project:\s*(.+)', existing)
    if pm:
        project_line = f\"project: {pm.group(1).strip()}\"

# Build index
total = sum(len(v) for v in pages.values())
lines = ['---', f'type: {index_type}']
if project_line:
    lines.append(project_line)
lines += [f'last_updated: ${DATE}', f'page_count: {total}', '---', '',
          '# Wiki Index' if 'hub' not in index_type else '# Hub Wiki Index', '',
          '> Auto-maintained by wiki-ingest. Do not edit manually.', '',
          '## By Category']
for cat in sorted(pages):
    lines.append(f'### {cat}')
    for slug, title in sorted(pages[cat], key=lambda x: x[1]):
        lines.append(f'- [{title}](pages/{slug}.md)')
    lines.append('')

with open(index_file, 'w') as f:
    f.write('\n'.join(lines) + '\n')
" 2>/dev/null
fi

echo "Wiki ${ACTION}: ${PAGE_FILE}"
