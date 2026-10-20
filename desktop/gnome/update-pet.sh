#!/usr/bin/env bash
# Updates the Butler pet on this laptop: gets the latest code and installs the new pet.
# Install once with: ln -sf "$PWD/desktop/gnome/update-pet.sh" ~/.local/bin/update-pet
set -euo pipefail

repo="$(cd "$(dirname "$(readlink -f "$0")")/../.." && pwd)"
uuid="butler-pet@anasmasama.dev"
dest="$HOME/.local/share/gnome-shell/extensions/$uuid"

git -C "$repo" pull --ff-only
rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -r "$repo/desktop/gnome/$uuid" "$dest"
gnome-extensions enable "$uuid" 2>/dev/null || true

echo "Butler pet updated. Log out and back in to see the new version."
