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
import urllib.request

DOPPLER_PROJECT = "ceo-dashboard"
DOPPLER_CONFIG = "prd"

# Render service IDs — keep in sync with render.yaml service names.
SERVICES = {
    "ceo-dashboard": "srv-d7b2ed94tr6s73c2m8ag",
    "ceo-dashboard-sync-worker": "srv-d7b4qaudqaus73c8r3dg",
    # cron service inherits CRON_SECRET / RENDER_EXTERNAL_URL via fromService;
    # no Doppler sync needed.
}

# Keys Render manages for itself — never overwrite.
RENDER_MANAGED = {
    "DATABASE_URL",        # from fromDatabase ref in render.yaml
    "CRON_SECRET",         # generateValue: true in render.yaml
    "RENDER_EXTERNAL_URL", # auto-injected by Render
    "NODE_ENV",            # static value: production in render.yaml
}


def fetch_doppler_secrets() -> dict[str, str]:
    raw = subprocess.check_output(
        ["doppler", "secrets", "--project", DOPPLER_PROJECT,
         "--config", DOPPLER_CONFIG, "--json"],
        text=True,
    )
    data = json.loads(raw)
    out = {}
    for k, v in data.items():
        if k.startswith("DOPPLER_"):
            continue
        val = v.get("computed") if isinstance(v, dict) else v
        if val:
            out[k] = val
    return out


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
    with urllib.request.urlopen(req, timeout=30) as r:
        if r.status >= 300:
            raise RuntimeError(f"Render PUT failed: {r.status} {r.read()[:200]}")


def main() -> int:
    token = os.environ.get("RENDER_API_KEY")
    if not token:
        print("error: RENDER_API_KEY env var required", file=sys.stderr)
        return 2

    doppler = fetch_doppler_secrets()
    print(f"Doppler {DOPPLER_PROJECT}/{DOPPLER_CONFIG}: {len(doppler)} secrets")

    for name, sid in SERVICES.items():
        current = render_get_env(sid, token)
        merged = dict(current)
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
        if preserved:print(f"   ⊘ preserved Render-managed: {', '.join(sorted(preserved))}")

        render_put_env(sid, token, merged)
        print(f"   ✓ PUT succeeded")

    print("\n✓ all services synced")
    return 0


if __name__ == "__main__":
    sys.exit(main())
