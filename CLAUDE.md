# [Project Name]

[One-line project description.]

## Quick Start

```bash
./scripts/setup.sh          # One-time: configure git hooks + optionally set up Doppler/.env
# ... add project-specific setup steps here ...
```

## Architecture

[Describe your project structure here.]

## Environment Variables

Managed via **Doppler** (recommended) or `.env` file. See `.env.example` for the full list.

```bash
# Option A: Doppler
doppler setup                              # One-time config
doppler run -- <your-command>              # Run with secrets injected

# Option B: .env file
cp .env.example .env                       # One-time
# Edit .env with your values
```

**Never hardcode secrets. Never commit `.env`.**

## Testing

```bash
make test
```

Edit the `Makefile` to configure your project's test runner.

## Git Workflow (MUST follow -- enforced by hooks)

**Never commit or push directly to `main`.** Three layers of protection enforce this:

1. **Claude Code hook** blocks Edit/Write on main (`.claude/settings.json` -> `scripts/guard-branch.sh`)
2. **Git pre-commit hook** blocks `git commit` on main (`.githooks/pre-commit`)
3. **Git pre-push hook** blocks `git push` on main (`.githooks/pre-push`)

### Workflow

1. `git checkout -b descriptive-branch-name` -- create a branch **before any edits**
2. Make changes, run tests (`make test`)
3. `git add <specific files>` -- **never use `git add -A`** (risks committing `.claude/worktrees/`, `.env`, etc.)
4. `git commit` then `git push -u origin <branch>` then `gh pr create`
5. Wait for human to merge (do not merge yourself unless explicitly asked)
6. After merge: `git checkout main && git pull` to sync

If the user says "get it live" or "deploy": push branch, create PR, give them the URL.

### Parallel agents MUST use worktrees

Multiple agents in the same checkout will overwrite each other's uncommitted changes:

```bash
scripts/create-agent-worktree.sh <agent-name> <task-name>
```

Creates a sibling directory with its own branch (`agent/<name>/<task>`). Never run multiple agents in the same directory.

## Key Conventions

- **Secrets**: Never hardcode. Use Doppler or `.env`. Never commit `.env`.
- **Staging**: Always `git add <specific files>`. Never `git add -A` or `git add .`.
- **Branches**: Always work on a feature branch. Main is protected at 3 levels.
