#!/bin/sh
# One-time project setup. Safe to re-run (idempotent).

set -eu

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Project Setup ==="

# 1. Configure git hooks (CRITICAL -- hooks don't work without this)
echo "Configuring git hooks..."
git -C "$REPO_ROOT" config core.hooksPath .githooks
echo "  Done: core.hooksPath set to .githooks"

# 2. Make scripts executable
echo "Making scripts executable..."
chmod +x "$REPO_ROOT"/scripts/*.sh
echo "  Done"

# 3. Ensure local dependencies exist (or reuse another checkout's install)
echo "Ensuring npm dependencies are available..."
"$REPO_ROOT/scripts/ensure-node-modules.sh"
echo "  Done"

# 4. Set up Doppler
if command -v doppler >/dev/null 2>&1; then
  if [ -t 0 ]; then
    # Interactive terminal — ask
    printf "Doppler CLI detected. Run 'doppler setup' now? [y/N] "
    read -r answer
    if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
      (cd "$REPO_ROOT" && doppler setup)
    else
      echo "  Skipped. Run 'doppler setup' later to configure secrets."
    fi
  else
    # Non-interactive (CI, Conductor, worktrees) — auto-configure
    echo "Configuring Doppler (non-interactive)..."
    doppler setup --project ceo-dashboard --config dev --no-interactive --scope "$REPO_ROOT" \
      && echo "  Done: ceo-dashboard/dev" \
      || echo "  Warning: doppler setup failed — run 'doppler setup' manually"
  fi
else
  echo "Doppler CLI not found. Install with: brew install dopplerhq/cli/doppler"
  echo "  Or use a .env file (copy .env.example to .env and fill in values)."
fi

# 5. Create .env from example if it doesn't exist
if [ ! -f "$REPO_ROOT/.env" ]; then
  if [ -f "$REPO_ROOT/.env.example" ]; then
    if [ -t 0 ]; then
      printf "Create .env from .env.example? [y/N] "
      read -r answer
      if [ "$answer" = "y" ] || [ "$answer" = "Y" ]; then
        cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
        echo "  Created .env -- edit it to add your secrets."
      else
        echo "  Skipped."
      fi
    else
      echo "Skipping .env creation (non-interactive). Use Doppler or copy .env.example manually."
    fi
  fi
else
  echo ".env already exists, skipping."
fi

echo ""
echo "=== Setup complete ==="
echo "Next steps:"
echo "  1. Edit .env with your API keys (or use 'doppler run -- <command>')"
echo "  2. Create a feature branch before making changes:"
echo "     git checkout -b <your-branch-name>"
