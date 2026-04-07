#!/bin/sh
# Guard script for Claude Code PreToolUse hook.
# Blocks Edit/Write operations when on the main/master branch.
# Exit 0 = allow, exit 2 = block with message on stderr.

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  echo "BLOCKED: You are on $branch. Create a feature branch first:" >&2
  echo "  git checkout -b <descriptive-branch-name>" >&2
  exit 2
fi

exit 0
