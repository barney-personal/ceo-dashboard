#!/bin/sh
# Ensure this checkout has access to npm dependencies.
# In git worktrees whose node_modules lives *inside* this repo root, reuse it
# via a symlink to avoid reinstalling. Sibling worktrees (e.g. Conductor
# workspaces) install locally — Turbopack rejects symlinks whose target
# escapes the project root ("Symlink [project]/node_modules is invalid").

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

  if [ ! -f "$shared_lockfile" ] || [ ! -d "$shared_node_modules" ]; then
    continue
  fi
  if ! cmp -s "$lockfile_path" "$shared_lockfile"; then
    continue
  fi

  # Turbopack refuses symlinks that resolve outside the project root. Only
  # reuse when the real path of the shared node_modules is a descendant of
  # repo_root (e.g. .claude/worktrees/* under the main checkout). Sibling
  # worktrees fall through to a local install.
  shared_real="$(cd "$shared_node_modules" && pwd -P)"
  case "$shared_real/" in
    "$repo_root"/*)
      ln -s "$shared_node_modules" "$node_modules_path"
      echo "Linked dependencies from $shared_node_modules"
      IFS="$old_ifs"
      exit 0
      ;;
  esac
done

IFS="$old_ifs"

echo "No in-tree worktree dependencies found; installing locally..."
(cd "$repo_root" && npm install)
