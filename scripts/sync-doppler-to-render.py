#!/usr/bin/env python3
"""Push Doppler `prd` secrets to Render services.

Idempotent merge: reads Render's current env, overlays Doppler `prd` values
for matching keys, leaves Render-managed keys (DATABASE_URL, CRON_SECRET,
RENDER_*) untouched, PUTs the merged set.

Run any time secrets change in Doppler:
    doppler run -- python scripts/sync-doppler-to-render.py

Or with the token inline (for one-off runs):
    RENDER_API_KEY=rnd_xxx python scripts/sync-doppler-to-render.py
"""
from __future__ import annotations
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

DOPPLER_PROJECT = "ceo-dashboard"
DOPPLER_CONFIG = "prd"

# Render service IDs.
#
# Each entry maps the `name:` declared in render.yaml to its Render service
# ID (the `srv-...` slug). Find an ID via:
#     curl -H "Authorization: Bearer $RENDER_API_KEY" \
#       https://api.render.com/v1/services?limit=50 | jq '.[].service | {name, id}'
# If a service is recreated (delete + new), update the ID here — the script
# has no way to detect a stale ID; it'll silently sync to the wrong service.
#
# Cron services (ceo-dashboard-cron, ceo-dashboard-probe-heartbeat) inherit
# their secrets via `fromService:` refs in render.yaml — no Doppler sync.
SERVICES = {
    "ceo-dashboard":             "srv-d7b2ed94tr6s73c2m8ag",  # web
    "ceo-dashboard-sync-worker": "srv-d7b4qaudqaus73c8r3dg",  # worker
}

# Keys Render manages for itself — never overwrite.
RENDER_MANAGED = {
    "DATABASE_URL",        # from fromDatabase ref in render.yaml
    "CRON_SECRET",         # generateValue: true in render.yaml
    "RENDER_EXTERNAL_URL", # auto-injected by Render
    "NODE_ENV",            # static value: production in render.yaml
}

# Operator credentials used by THIS script — must never become service env
# vars. If they did, a compromised service container could bootstrap to full
# Doppler/Render account access. Stripped from both the Doppler view and the
# merged Render env so a re-sync also REMOVES any historical leak.
#
# DOPPLER_TOKEN is also caught by the `DOPPLER_*` prefix skip in
# fetch_doppler_secrets(); listing it here is defence-in-depth in case the
# Doppler CLI ever changes its naming convention.
NEVER_PUSH = {
    "RENDER_API_KEY",
    "DOPPLER_TOKEN",
}


def fetch_doppler_secrets() -> tuple[dict[str, str], list[str]]:
    """Return (non-empty secrets, names of skipped empty-string secrets).

    Empty-string values are skipped to avoid pushing them to Render and
    overwriting real values, but they're surfaced in the returned list so
    operators can spot misconfigured Doppler entries (e.g. a key created in
    the dashboard but never given a value).
    """
    raw = subprocess.check_output(
        ["doppler", "secrets", "--project", DOPPLER_PROJECT,
         "--config", DOPPLER_CONFIG, "--json"],
        text=True,
    )
    data = json.loads(raw)
    out: dict[str, str] = {}
    skipped: list[str] = []
    for k, v in data.items():
        if k.startswith("DOPPLER_"):
            continue
        val = v.get("computed") if isinstance(v, dict) else v
        if val:
            out[k] = val
        else:
            skipped.append(k)
    return out, skipped


def render_get_env(service_id: str, token: str) -> dict[str, str]:
    """List all env vars on a Render service. Paginates if needed (max 100/page)."""
    out: dict[str, str] = {}
    cursor: str | None = None
    while True:
        url = f"https://api.render.com/v1/services/{service_id}/env-vars?limit=100"
        if cursor:
            url += f"&cursor={cursor}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        if not data:
            break
        for x in data:
            e = x.get("envVar", x)
            if e.get("key"):
                out[e["key"]] = e.get("value", "")
        if len(data) < 100:
            break
        cursor = data[-1].get("cursor")
        if not cursor:
            break
    return out


def render_put_env(service_id: str, token: str, env: dict[str, str]) -> None:
    """PUT a complete env-var set to Render. Raises with a clean message on
    HTTP error (urllib raises HTTPError for 4xx/5xx; without this wrapper
    the traceback is noisy and hides the response body)."""
    body = json.dumps([{"key": k, "value": v} for k, v in env.items()]).encode()
    req = urllib.request.Request(
        f"https://api.render.com/v1/services/{service_id}/env-vars",
        method="PUT",
        data=body,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30):
            pass
    except urllib.error.HTTPError as e:
        body_preview = e.read()[:300].decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Render PUT failed (HTTP {e.code}) for {service_id}: {body_preview}"
        ) from e


def render_trigger_deploy(service_id: str, token: str) -> str:
    """Trigger a fresh deploy for `service_id` and return the new deploy id.
    Required because env-var changes via the API don't auto-redeploy — pods
    keep their old env until the next deploy."""
    req = urllib.request.Request(
        f"https://api.render.com/v1/services/{service_id}/deploys",
        method="POST",
        data=b'{"clearCache":"do_not_clear"}',
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
            return str(data.get("id", "?"))
    except urllib.error.HTTPError as e:
        body_preview = e.read()[:300].decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Render deploy POST failed (HTTP {e.code}) for {service_id}: {body_preview}"
        ) from e


def main() -> int:
    token = os.environ.get("RENDER_API_KEY")
    if not token:
        print("error: RENDER_API_KEY env var required", file=sys.stderr)
        return 2

    doppler, skipped_empty = fetch_doppler_secrets()
    # Strip NEVER_PUSH keys from the Doppler view so they don't reach Render.
    stripped_from_doppler = sorted(k for k in NEVER_PUSH if k in doppler)
    for k in stripped_from_doppler:
        doppler.pop(k, None)

    print(f"Doppler {DOPPLER_PROJECT}/{DOPPLER_CONFIG}: {len(doppler)} secrets")
    if stripped_from_doppler:
        print(f"  ⊘ never-push (operator creds, kept in Doppler only): "
              f"{', '.join(stripped_from_doppler)}")
    if skipped_empty:
        print(f"  ⚠ skipping {len(skipped_empty)} empty-string secrets "
              f"(set them in Doppler if needed): {', '.join(sorted(skipped_empty))}")

    for name, sid in SERVICES.items():
        current = render_get_env(sid, token)
        merged = dict(current)
        # Strip NEVER_PUSH from merged BEFORE applying Doppler — this removes
        # any historical leak (e.g. an earlier sync that pushed RENDER_API_KEY
        # by mistake). Doppler view has already been stripped, so the Doppler
        # loop won't re-add them.
        removed = sorted(k for k in NEVER_PUSH if k in merged)
        for k in removed:
            merged.pop(k, None)

        added, updated, preserved = [], [], []
        for k, v in doppler.items():
            if k in RENDER_MANAGED:
                preserved.append(k)
                continue
            if k not in current:
                added.append(k)
            elif current[k] != v:
                updated.append(k)
            merged[k] = v

        print(f"\n→ {name} ({sid})")
        print(f"   current: {len(current)} vars | will push: {len(merged)} vars")
        if added:    print(f"   + adding   ({len(added)}): {', '.join(sorted(added))}")
        if updated:  print(f"   ↺ updating ({len(updated)}): {', '.join(sorted(updated))}")
        if removed:  print(f"   - removing ({len(removed)}) never-push: "
                          f"{', '.join(removed)}")
        if preserved:print(f"   ⊘ preserved Render-managed: {', '.join(sorted(preserved))}")

        render_put_env(sid, token, merged)
        print(f"   ✓ PUT succeeded")

    # Trigger fresh deploys — env-var changes via the API don't auto-redeploy.
    # Service IDs come from SERVICES so the workflow / operator never has to
    # repeat them.
    if os.environ.get("SKIP_DEPLOY") == "1":
        print("\n⏭  skipping deploys (SKIP_DEPLOY=1)")
    else:
        print("\nTriggering fresh deploys:")
        for name, sid in SERVICES.items():
            deploy_id = render_trigger_deploy(sid, token)
            print(f"  → {name}: deploy {deploy_id} queued")

    print("\n✓ all services synced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
