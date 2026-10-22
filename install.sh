#!/usr/bin/env bash
# Link herdr-dsh into a DSH TUI profile and add its insert entry.
set -euo pipefail

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
dsh_home=${DSH_HOME:-"$HOME/.dsh"}
profile="$dsh_home/profiles/tui"
link="$profile/node_modules/herdr-dsh"
patch_file="$profile/cordis.patch.yml"

if [ ! -d "$profile" ]; then
  echo "error: $profile does not exist." >&2
  echo "Start the DSH TUI once so it creates the tui profile, then rerun this script." >&2
  exit 1
fi

if [ -e "$link" ] && [ ! -L "$link" ]; then
  echo "error: $link exists and is not a symlink; remove it first." >&2
  exit 1
fi

mkdir -p "$profile/node_modules"
ln -sfn "$repo_dir" "$link"
echo "linked $link -> $repo_dir"

if [ ! -f "$patch_file" ]; then
  printf '%s\n' \
    '- insert:' \
    '    - id: herdr-dsh' \
    "      name: 'herdr-dsh'" >"$patch_file"
  echo "created $patch_file"
else
  if grep -q 'herdr-dsh' "$patch_file"; then
    echo "$patch_file already mentions herdr-dsh; leaving it unchanged"
  else
    backup="$patch_file.bak-herdr-$(date +%Y%m%d-%H%M%S)"
    cp -p "$patch_file" "$backup"
    echo "backed up $patch_file -> $backup"

    if ! command -v python3 >/dev/null 2>&1; then
      echo "error: python3 is required to patch YAML." >&2
      echo "Add this to $patch_file manually:" >&2
      echo "  - insert:" >&2
      echo "      - id: herdr-dsh" >&2
      echo "        name: 'herdr-dsh'" >&2
      exit 1
    fi

    python3 - "$patch_file" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
lines = path.read_text(encoding="utf-8").splitlines()
# A profile patch file is a YAML list. Replace a bare trailing empty list with
# the insert item; otherwise append the item after the existing entries.
for index in range(len(lines) - 1, -1, -1):
    text = lines[index].strip()
    if not text or text.startswith("#"):
        continue
    if text == "[]":
        lines[index] = ""
    break
block = "\n- insert:\n    - id: herdr-dsh\n      name: 'herdr-dsh'\n"
path.write_text("\n".join(lines).rstrip() + "\n" + block, encoding="utf-8")
PY
    echo "patched $patch_file"
  fi
fi

if command -v dsh >/dev/null 2>&1; then
  if dsh --profile tui --dump-config 2>/dev/null | grep -q 'herdr-dsh'; then
    echo "profile composes with herdr-dsh"
  else
    echo "error: the patched profile does not compose with herdr-dsh." >&2
    if [ -n "${backup:-}" ] && [ -f "$backup" ]; then
      cp -p "$backup" "$patch_file"
      echo "restored $patch_file from $backup" >&2
    fi
    exit 1
  fi
fi

echo
echo "Restart the DSH TUI in its Herdr pane to load herdr-dsh."
