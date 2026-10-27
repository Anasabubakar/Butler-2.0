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

# Inter, the Butler 2.0 interface font, for the pet's menu and bubble (B2 · 03).
fonts="$HOME/.local/share/fonts/butler"
mkdir -p "$fonts"
cp "$repo/desktop/gnome/fonts/"*.ttf "$repo/desktop/gnome/fonts/LICENSE-Inter.txt" "$fonts/"
fc-cache -f "$fonts" >/dev/null 2>&1 || true

# Right-click → Scripts → Send to phone, in Files.
scripts="$HOME/.local/share/nautilus/scripts"
mkdir -p "$scripts"
ln -sf "$repo/desktop/gnome/send-to-phone.sh" "$scripts/Send to phone"

# The file link needs python3 (Ubuntu has it) and openssl, for its own certificate.
command -v python3 >/dev/null || echo "Install python3 to send files to your phone: sudo apt install python3"
command -v openssl >/dev/null || echo "Install openssl to send files over Wi-Fi with no internet: sudo apt install openssl"

echo "Butler pet updated. Log out and back in to see the new version."
