#!/bin/sh
# Guard script for Claude Code PreToolUse hook.
# Blocks Edit/Write operations when on the main/master branch.
# Exit 0 = allow, exit 2 = block with message on stderr.
#
# The hook receives tool input as JSON on stdin. We extract file_path
# and resolve the git repo it belongs to — this way worktree edits
# check the worktree's branch, not the main checkout's CWD branch.

input="$(cat)"

# Extract file_path from JSON stdin (works without jq)
file_path="$(echo "$input" | sed -n 's/.*"file_path" *: *"\([^"]*\)".*/\1/p')"

if [ -n "$file_path" ] && [ -d "$(dirname "$file_path")" ]; then
  # Resolve the branch for the repo containing the target file
  branch="$(cd "$(dirname "$file_path")" && git rev-parse --abbrev-ref HEAD 2>/dev/null)"
else
  # Fallback to CWD branch (e.g. if file_path is missing or dir doesn't exist yet)
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
fi

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "BLOCKED: You are on $branch. Create a feature branch first:" >&2
  echo "  git checkout -b <descriptive-branch-name>" >&2
  exit 2
fi

exit 0
