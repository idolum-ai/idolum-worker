#!/bin/bash
# Set worker name from branch name
# Run before build: ./scripts/set-worker-name.sh && npm run build

BRANCH="${CF_PAGES_BRANCH:-$(git branch --show-current)}"

if [ -z "$BRANCH" ] || [ "$BRANCH" = "main" ]; then
  echo "Warning: No branch name or on main, using default names"
  exit 0
fi

echo "Setting worker name to: $BRANCH"

# Update package.json name
sed -i.bak "s/\"name\": \"[^\"]*\"/\"name\": \"$BRANCH\"/" package.json

# Update wrangler.jsonc worker name
sed -i.bak "s/\"name\": \"[^\"]*\"/\"name\": \"$BRANCH\"/" wrangler.jsonc

# Update R2 bucket name to match
sed -i.bak "s/\"bucket_name\": \"[^\"]*-data\"/\"bucket_name\": \"$BRANCH-data\"/" wrangler.jsonc

# Cleanup backup files
rm -f package.json.bak wrangler.jsonc.bak

echo "Worker name set to: $BRANCH"
echo "R2 bucket: $BRANCH-data"
