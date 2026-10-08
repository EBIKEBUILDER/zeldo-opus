#!/usr/bin/env python3
"""Deploy zeldo-opus to Vercel via the MCP `vercel` CLI.

Two-phase:
  1. upload_file per source file (each far under the argv limit)
  2. create_deployment referencing the uploaded files by sha

Usage:  python3 scripts/vercel-deploy.py [--target production|preview]

Notes:
- package-lock.json is intentionally excluded: at 235KB it cannot fit in a
  single argv (Linux MAX_ARG_STRLEN 128KB, worse after base64). package.json
  pins every dependency exactly, so `npm install` on Vercel resolves the
  same tree that was verified locally.
- Excludes: .git, node_modules, .next, .vercel, scripts/, .env files.
"""

import base64
import concurrent.futures
import hashlib
import json
import os
import subprocess
import sys
import time

PROJECT_NAME = "zeldo-opus"
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

EXCLUDE_DIRS = {".git", "node_modules", ".next", ".vercel", "scripts"}
EXCLUDE_FILES = {"package-lock.json", "tsconfig.tsbuildinfo"}


def collect_files():
    paths = []
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f in EXCLUDE_FILES or f.startswith(".env"):
                continue
            full = os.path.join(root, f)
            rel = os.path.relpath(full, PROJECT_DIR)
            paths.append((rel, full))
    return sorted(paths)


def vercel_call(tool, args):
    payload = json.dumps(args)
    if len(payload.encode()) > 120_000:
        raise RuntimeError(f"arguments for {tool} exceed argv safety limit")
    p = subprocess.run(
        ["vercel", "call-tool", "--name", tool, "--arguments-json", payload],
        capture_output=True,
        text=True,
        timeout=300,
    )
    if p.returncode != 0:
        raise RuntimeError(f"{tool} failed: {p.stderr.strip()[:500]}")
    out = json.loads(p.stdout)
    if not out.get("ok"):
        raise RuntimeError(f"{tool} not ok: {p.stdout[:500]}")
    return out


def upload_one(item):
    rel, full = item
    with open(full, "rb") as fh:
        data = fh.read()
    sha = hashlib.sha1(data).hexdigest()
    vercel_call(
        "upload_file",
        {
            "contentLength": len(data),
            "requestBody": base64.b64encode(data).decode(),
            "xVercelDigest": sha,
        },
    )
    return {"file": rel, "sha": sha, "size": len(data)}


def unwrap(out):
    """Unwrap the double-encoded MCP response into a plain dict."""
    text = out["result"]["content"][0]["text"]
    data = json.loads(text)
    result = data["result"] if isinstance(data, dict) else data
    if isinstance(result, str):
        result = json.loads(result)
    return result


def find_deployment(obj):
    """Recursively find the deployment dict (has dpl_ id) in a response."""
    if isinstance(obj, dict):
        if isinstance(obj.get("id"), str) and obj["id"].startswith("dpl_"):
            return obj
        for v in obj.values():
            found = find_deployment(v)
            if found:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = find_deployment(v)
            if found:
                return found
    return None


def get_deployment_state(deployment_id):
    d = unwrap(vercel_call("get_deployment", {"idOrUrl": deployment_id}))
    found = find_deployment(d)
    return found if found else d


def main():
    target = "production"
    if "--target" in sys.argv:
        target = sys.argv[sys.argv.index("--target") + 1]

    files = collect_files()
    print(f"Uploading {len(files)} files...")
    refs = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(upload_one, item): item[0] for item in files}
        for i, fut in enumerate(concurrent.futures.as_completed(futs), 1):
            ref = fut.result()
            refs.append(ref)
            print(f"  [{i}/{len(files)}] {ref['file']}", flush=True)

    refs.sort(key=lambda r: r["file"])
    print("Creating deployment...")
    out = vercel_call(
        "create_deployment",
        {
            "target": target,
            "forceNew": "1",
            "skipAutoDetectionConfirmation": "1",
            "requestBody": {
                "name": PROJECT_NAME,
                "project": PROJECT_NAME,
                "files": refs,
                "projectSettings": {"framework": "nextjs"},
            },
        },
    )
    dep = find_deployment(unwrap(out))
    if not dep:
        raise RuntimeError("could not find deployment in create_deployment response")
    dep_id = dep["id"]
    print(f"Deployment {dep_id} created, state={dep.get('readyState')}")

    deadline = time.time() + 900
    while time.time() < deadline:
        time.sleep(15)
        d = get_deployment_state(dep_id)
        state = d.get("readyState") or d.get("state")
        print(f"  ... {state}", flush=True)
        if state in ("READY", "ERROR", "CANCELED"):
            url = d.get("url")
            print(f"Final state: {state}  https://{url}")
            if state != "READY":
                sys.exit(1)
            break
    else:
        print("Timed out waiting for deployment to finish", file=sys.stderr)
        sys.exit(1)

    # NOTE: create_deployment's target flag does not promote the build.
    # New deployments land with target=null, so the production alias must
    # be moved explicitly, or the site keeps serving the old build.
    if target == "production":
        alias = "opus.zeldo.site"
        print(f"Assigning alias {alias} to {dep_id}...")
        out = vercel_call(
            "assign_alias",
            {"id": dep_id, "requestBody": {"alias": alias}},
        )
        print(f"Alias assigned: https://{alias}")
    return


if __name__ == "__main__":
    main()
