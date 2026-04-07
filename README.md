# [Project Name]

[Description]

## Getting Started

### Prerequisites

- Git
- [Your language runtime]
- (Optional) [Doppler CLI](https://docs.doppler.com/docs/install-cli) for secrets management

### Setup

```bash
git clone <repo-url>
cd <repo-name>
./scripts/setup.sh
```

This configures git hooks (branch protection) and optionally sets up environment variables via Doppler or `.env`.

### Development

Always create a branch before making changes:

```bash
git checkout -b my-feature
# ... make changes ...
make test
git add <specific-files>
git commit -m "Description of changes"
git push -u origin my-feature
gh pr create
```

## Agent / Claude Code Workflow

This repo uses three layers of main-branch protection:

| Layer | Mechanism | What it blocks |
|-------|-----------|---------------|
| 1 | `.claude/settings.json` PreToolUse hook | Claude Code Edit/Write on main |
| 2 | `.githooks/pre-commit` | `git commit` on main |
| 3 | `.githooks/pre-push` | `git push` on main |

**Important:** Run `./scripts/setup.sh` after cloning to activate git hooks. Without this, Layers 2 and 3 are inactive.

### Parallel agents

Multiple Claude Code agents must use separate worktrees to avoid file conflicts:

```bash
scripts/create-agent-worktree.sh <agent-name> <task-name>
```

This creates a sibling directory (e.g., `../repo-name-agent-1-task/`) with its own isolated branch (`agent/<name>/<task>`). Hooks are automatically configured in the new worktree.

## Testing

```bash
make test
```

Edit the `Makefile` to configure your test runner.

## Environment Variables

See `.env.example` for the full list. Use either:

- **Doppler** (recommended): `doppler setup` then `doppler run -- <command>`
- **.env file**: `cp .env.example .env` and fill in values

## Created from template

This repo was created from [repo-template](https://github.com/barneyhussey-yeo/repo-template). After creating from the template:

1. Run `./scripts/setup.sh`
2. Update `CLAUDE.md` with project-specific instructions
3. Update this `README.md` with project-specific docs
4. Edit `Makefile` to set your test command
5. Edit `.env.example` with your project's required variables
6. Update `.github/workflows/ci.yml` if you need language-specific setup steps
