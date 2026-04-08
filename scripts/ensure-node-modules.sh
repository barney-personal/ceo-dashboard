#!/bin/sh
# Ensure this checkout has access to npm dependencies.
# In git worktrees, prefer reusing another checkout's node_modules when the
# lockfile matches to avoid reinstalling the whole tree.

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
node_modules_path="$repo_root/node_modules"
lockfile_path="$repo_root/package-lock.json"

if [ -L "$node_modules_path" ] && [ ! -e "$node_modules_path" ]; then
  rm "$node_modules_path"
fi

if [ -e "$node_modules_path" ]; then
  echo "Dependencies already available at $node_modules_path"
  exit 0
fi

worktree_paths=$(git -C "$repo_root" worktree list --porcelain | awk '/^worktree / {print substr($0, 10)}')

old_ifs="$IFS"
IFS='
'

for worktree_path in $worktree_paths; do
  if [ "$worktree_path" = "$repo_root" ]; then
    continue
  fi

  shared_lockfile="$worktree_path/package-lock.json"
  shared_node_modules="$worktree_path/node_modules"

  if [ -f "$shared_lockfile" ] && [ -d "$shared_node_modules" ] && cmp -s "$lockfile_path" "$shared_lockfile"; then
    ln -s "$shared_node_modules" "$node_modules_path"
    echo "Linked dependencies from $shared_node_modules"
    IFS="$old_ifs"
    exit 0
  fi
done

IFS="$old_ifs"

echo "No compatible worktree dependencies found; installing locally..."
(cd "$repo_root" && npm install)
