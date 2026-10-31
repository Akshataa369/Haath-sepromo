"""
Builds Haath Se's built-in ISL signs (numbers 1-9 and letters A-Z) from the
MIT-licensed ISL gesture chart by Karthikeyu Busa and Shravani Katte
(github.com/Karthikeyu/Indian-sign-language-recognition, all_gestures.jpg).

For each sign it:
  1. crops the chart cell and saves an upscaled reference picture,
  2. runs MediaPipe Hand Landmarker on several variations of the picture
     (scale, padding, small rotations, mirrored) and keeps the hand points,
  3. writes frontend/js/builtin-signs.js with the 129-number feature vectors
     the browser recogniser uses, plus one skeleton per sign for animation.

Usage: python build_builtin_signs.py <all_gestures.jpg> <hand_landmarker.task> <app root>
"""
import json, math, sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

chart_path, model_path, root = sys.argv[1], sys.argv[2], Path(sys.argv[3])
LABELS = [str(n) for n in range(1, 10)] + [chr(c) for c in range(ord("A"), ord("Z") + 1)]
IDS = [f"n{l}" if l.isdigit() else f"l{l.lower()}" for l in LABELS]
COLS, ROWS, CELL = 5, 7, 96

img_dir = root / "frontend" / "img" / "signs"
img_dir.mkdir(parents=True, exist_ok=True)
chart = Image.open(chart_path).convert("RGB")
lm = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model_path), num_hands=2,
    running_mode=vision.RunningMode.IMAGE,
    min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3))


def hand_vec(h):
    w = h[0]
    s = max(math.hypot(p[0] - w[0], p[1] - w[1]) for p in h) or 1.0
    return [c for p in h for c in ((p[0] - w[0]) / s, (p[1] - w[1]) / s, (p[2] - w[2]) / s)], s


def features(hands):
    # hands: list of 21x3 point lists in aspect-corrected units (square images, so x as is)
    hands = sorted(hands, key=lambda h: h[0][0])
    v0, s0 = hand_vec(hands[0])
    f = list(v0)
    if len(hands) > 1:
        v1, _ = hand_vec(hands[1])
        f += v1 + [(hands[1][0][0] - hands[0][0][0]) / s0, (hands[1][0][1] - hands[0][0][1]) / s0, 2.0]
    else:
        f += [0.0] * 66
    return [round(x, 3) for x in f]


def detect(pil):
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(pil)))
    return [[(p.x, p.y, p.z) for p in hand] for hand in res.hand_landmarks]


def variants(cell):
    for size in (288, 384, 480):
        for pad in (0.0, 0.25, 0.5):
            base = cell.resize((size, size), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 80, 2))
            if pad:
                p = int(size * pad / 2)
                base = ImageOps.expand(base, border=p, fill=(14, 20, 24)).resize((size, size), Image.LANCZOS)
            for rot in (0, -8, 8):
                im = base.rotate(rot, resample=Image.BICUBIC, fillcolor=(14, 20, 24)) if rot else base
                yield im, False, pad, rot
                yield ImageOps.mirror(im), True, pad, rot


def to_original(hands, mirrored, pad, rot):
    """Map points from a variant image back to the original picture's 0..1 coordinates."""
    out = []
    a = math.radians(rot)  # PIL rotates counter-clockwise on screen
    for h in hands:
        pts = []
        for x, y, z in h:
            if mirrored:
                x = 1 - x
            if rot:
                dx, dy = x - 0.5, y - 0.5
                x, y = 0.5 + dx * math.cos(a) - dy * math.sin(a), 0.5 + dx * math.sin(a) + dy * math.cos(a)
            x = x * (1 + pad) - pad / 2
            y = y * (1 + pad) - pad / 2
            pts.append((x, y, z))
        out.append(pts)
    return out


def big_enough(hands, pad):
    # Drop tiny false detections (e.g. a single fingertip read as a hand).
    for h in hands:
        w = h[0]
        span = max(math.hypot(p[0] - w[0], p[1] - w[1]) for p in h) * (1 + pad)
        if span < 0.18:
            return False
    return True


out = {}
report = []
for i, (label, sid) in enumerate(zip(LABELS, IDS)):
    r, c = divmod(i, COLS)
    cell = chart.crop((c * CELL + 2, r * CELL + 2, (c + 1) * CELL - 2, (r + 1) * CELL - 2))
    pic = cell.resize((288, 288), Image.LANCZOS).filter(ImageFilter.UnsharpMask(2, 90, 2))
    pic.save(img_dir / f"{sid}.jpg", quality=86)

    found = []
    for im, mirrored, pad, rot in variants(cell):
        hands = detect(im)
        if hands and big_enough(hands, pad):
            found.append((hands, (mirrored, pad, rot)))
    if not found:
        report.append(f"{label}: no hands found")
        continue
    counts = Counter(len(h) for h, _ in found)
    groups = [n for n, k in counts.items() if k >= 5] or [counts.most_common(1)[0][0]]
    keep = [(h, m) for h, m in found if len(h) in groups][:60]
    count = max(groups)
    vectors = [features(h) for h, _ in keep]
    # one unmirrored skeleton for the animation (with the most hands), in the picture's coordinates
    full = [(h, m) for h, m in keep if len(h) == count]
    best = min(full, key=lambda hm: (hm[1][0], hm[1][2] != 0, hm[1][1]))  # prefer unmirrored, unrotated, unpadded
    skel = to_original(best[0], *best[1])
    out[sid] = {
        "label": label, "hands": count,
        "skeleton": [[[round(p[0], 4), round(p[1], 4)] for p in h] for h in sorted(skel, key=lambda h: h[0][0])],
        "vectors": vectors,
    }
    report.append(f"{label}: {dict(counts)} -> keep {groups}, {len(vectors)} samples")

js = ("// Generated by tools/build_builtin_signs.py from the MIT-licensed ISL chart by\n"
      "// Karthikeyu Busa and Shravani Katte. Do not edit by hand.\n"
      "export const BUILTIN = " + json.dumps(out, separators=(",", ":")) + ";\n")
(root / "frontend" / "js" / "builtin-signs.js").write_text(js)
print("\n".join(report))
print(f"{len(out)} of {len(LABELS)} signs built, {sum(len(v['vectors']) for v in out.values())} samples total")
