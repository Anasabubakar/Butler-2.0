#!/usr/bin/env bash
# Right-click → Scripts → "Send to phone" in Files: hands the selected files to the Butler pet,
# which sends the real files to your phone (directly on the same Wi-Fi, else through Butler).
# update-pet installs it into ~/.local/share/nautilus/scripts.
set -euo pipefail

dir="${XDG_CACHE_HOME:-$HOME/.cache}/butler/send"
mkdir -p "$dir"
request="$dir/$(date +%s%N)"

# Files gives the picked paths one a line; anything else (a terminal) passes them as arguments.
python3 - "$request" "$@" <<'PY'
import json, os, sys
request, args = sys.argv[1], sys.argv[2:]
picked = os.environ.get("NAUTILUS_SCRIPT_SELECTED_FILE_PATHS", "")
paths = [p for p in picked.split("\n") if p] or [os.path.abspath(a) for a in args]
with open(request + ".tmp", "w") as f:
    json.dump({"target": "phone", "paths": paths}, f)
os.rename(request + ".tmp", request + ".json")  # the pet only reads finished requests
PY
