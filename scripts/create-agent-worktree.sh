#!/bin/sh
# Create an isolated git worktree for a parallel Claude Code agent.
# Usage: scripts/create-agent-worktree.sh <agent-name> <task-name> [base-branch]

set -eu

if [ "$#" -lt 2 ] || [ "$#" -gt 3 ]; then
  echo "Usage: $0 <agent-name> <task-name> [base-branch]"
  exit 1
fi

agent_name="$1"
task_name="$2"
base_branch="${3:-main}"

repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
parent_dir="$(dirname "$repo_root")"

slug() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9' '-'
}

agent_slug="$(slug "$agent_name")"
task_slug="$(slug "$task_name")"
branch_name="agent/${agent_slug}/${task_slug}"
worktree_path="${parent_dir}/${repo_name}-${agent_slug}-${task_slug}"

git fetch origin "$base_branch"

if git show-ref --verify --quiet "refs/heads/$branch_name"; then
  echo "Local branch already exists: $branch_name"
  exit 1
fi

if [ -e "$worktree_path" ]; then
  echo "Worktree path already exists: $worktree_path"
  exit 1
fi

git worktree add "$worktree_path" -b "$branch_name" "origin/$base_branch"

# Ensure git hooks are active in the new worktree
git -C "$worktree_path" config core.hooksPath .githooks

# Reuse dependencies from an existing checkout when possible.
"$worktree_path/scripts/ensure-node-modules.sh"

printf 'Created worktree:\n  %s\n' "$worktree_path"
printf 'Branch:\n  %s\n' "$branch_name"
