#!/usr/bin/env python3
"""Copies the Little Butler frames the GNOME pet uses out of design/little-butler.

Run it again after changing the kit:  python3 desktop/gnome/update-sprites.py
Needs Pillow (sudo apt install python3-pil).
"""
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / "design" / "little-butler" / "assets"
PETS = Path(__file__).resolve().parent / "butler-pet@anasmasama.dev" / "pets"

# Clips the pet plays. The peeking pet is a still pose, so its eyes show above the edge.
CLIPS = ["summon", "idle", "blink", "think", "work", "success", "error", "hide"]

atlas = json.loads((KIT / "butler-atlas.json").read_text())
size = atlas["meta"]["frameSize"]

if PETS.exists():
    shutil.rmtree(PETS)
PETS.mkdir(parents=True)
shutil.copy(KIT / "poses" / "peek.png", PETS / "peek.png")

clips = {}
for name in CLIPS:
    clip = atlas["animations"][name]
    strip = Image.open(KIT / clip["strip"])
    count = len(clip["frames"])
    (PETS / name).mkdir()
    for i in range(count):
        box = (i * size["w"], 0, (i + 1) * size["w"], size["h"])
        strip.crop(box).save(PETS / name / f"{i:02}.png", optimize=True)
    clips[name] = {"frames": count, "duration": clip["duration"], "loop": clip["loop"], "next": clip["next"]}

(PETS / "clips.json").write_text(json.dumps(clips, indent=2) + "\n")
print(f"Wrote {len(CLIPS)} clips to {PETS.relative_to(ROOT)}")
