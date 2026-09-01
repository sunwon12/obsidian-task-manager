#!/usr/bin/env python3
"""Remove only cross-app ownership of Ratko's macOS 26 menu-bar item."""

from __future__ import annotations

import datetime
import os
import pathlib
import plistlib
import shutil
import sys


RATKO_BUNDLE_ID = "com.taskmaster.ratko"


def identity(value: object) -> str | None:
    if not isinstance(value, dict):
        return None
    bundle = value.get("bundle")
    if isinstance(bundle, dict):
        raw = bundle.get("_0")
        return raw if isinstance(raw, str) else None
    return None


def repair(entries: list[object]) -> bool:
    changed = False
    for item in entries:
        if not isinstance(item, dict):
            continue
        owner = identity(item.get("location"))
        if owner == RATKO_BUNDLE_ID and item.get("isAllowed") is not True:
            item["isAllowed"] = True
            changed = True
        locations = item.get("menuItemLocations")
        if owner == RATKO_BUNDLE_ID or not isinstance(locations, list):
            continue
        kept = [location for location in locations if identity(location) != RATKO_BUNDLE_ID]
        if len(kept) != len(locations):
            item["menuItemLocations"] = kept
            changed = True
    return changed


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: repair-ratko-control-center.py <group.com.apple.controlcenter.plist>", file=sys.stderr)
        return 2
    path = pathlib.Path(sys.argv[1])
    if not path.exists():
        print("unchanged")
        return 0

    outer = plistlib.loads(path.read_bytes())
    tracked = outer.get("trackedApplications")
    if not isinstance(tracked, bytes):
        print("unchanged")
        return 0
    entries = plistlib.loads(tracked)
    if not isinstance(entries, list) or not repair(entries):
        print("unchanged")
        return 0

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = pathlib.Path("/tmp") / f"group.com.apple.controlcenter.plist.ratko-backup-{stamp}"
    shutil.copy2(path, backup)
    outer["trackedApplications"] = plistlib.dumps(entries, fmt=plistlib.FMT_BINARY, sort_keys=False)
    temporary = path.with_name(f".{path.name}.ratko-{os.getpid()}")
    temporary.write_bytes(plistlib.dumps(outer, fmt=plistlib.FMT_BINARY, sort_keys=False))
    os.replace(temporary, path)
    print(f"repaired:{backup}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
