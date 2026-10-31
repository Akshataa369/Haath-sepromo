"""
Builds Haath Se's 30 built-in everyday expressions as animated skeletons plus
hand-shape data for the camera check.

Source: 3D avatar ISL demonstration clips in
github.com/Rohitkumar-3103/Indian_Sign_Language_Projects (Images/isl_videos).
That repository has no licence file and does not say who made the clips, so
Haath Se ships NO video from it. This script only measures where the avatar's
hands are in each frame (MediaPipe Hand Landmarker) and stores those points.
The clips are a community avatar project, not checked by ISLRTC.

For each word it writes, into frontend/js/builtin-expressions.js:
  anim     - hand points for every frame, used to animate a stick figure
  skeleton - the key hand shape, used for the guide outline on the camera
  vectors  - 129-number feature vectors from the signing frames (and mirrored),
             used by the browser recogniser

Usage: python build_expressions.py <isl_videos dir> <hand_landmarker.task> <app root>
"""
import json, math, subprocess, sys, tempfile
from pathlib import Path

import numpy as np
from PIL import Image
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision

video_dir, model_path, root = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])

WORDS = [
    ("Hello", "hello"), ("Welcome", "welcome"), ("Good morning", "good_morning"), ("Good night", "good_night"),
    ("Thank you", "thank_you"), ("Please", "please"), ("Sorry", "sorry"), ("Yes", "yes"), ("No", "no"),
    ("Good", "good"), ("Bad", "bad"), ("Help", "help"), ("Stop", "stop"), ("Wait", "wait"), ("Come", "come"),
    ("Go", "go"), ("Again", "again"), ("Understand", "understand"), ("Name", "name"), ("Eat", "eat"),
    ("Drink", "drink"), ("Hungry", "hungry"), ("Thirsty", "thirsty"), ("Home", "home"), ("School", "school"),
    ("Friend", "friend"), ("Mother", "mother"), ("Father", "father"), ("Happy", "happy"), ("Bye", "bye"),
]
sid = lambda label: "e-" + "-".join(label.lower().split())

# Crop around the avatar (it stands still in the middle of a 1920x1080 frame).
CX0, CX1 = 0.28, 0.72
ASPECT = (CX1 - CX0) * 1920 / 1080          # crop width / height
# Fixed body points of the avatar in crop coordinates (x in 0..1 of crop width, y in 0..1 of height).
BODY = {"head": (0.51, 0.28), "neck": (0.51, 0.44), "sl": (0.31, 0.47), "sr": (0.70, 0.49),
        "hl": (0.40, 0.84), "hr": (0.62, 0.84)}
REST_Y = 0.78                                # a wrist below this is a resting hand, not signing
MID_X = 0.52                                 # avatar's centre line

lm = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=model_path), num_hands=2,
    running_mode=vision.RunningMode.IMAGE,
    min_hand_detection_confidence=0.3, min_hand_presence_confidence=0.3))


def frames(path):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(path),
                        "-vf", f"crop=iw*{CX1 - CX0}:ih:iw*{CX0}:0", f"{tmp}/f%03d.png"], check=True)
        for p in sorted(Path(tmp).glob("f*.png")):
            yield Image.open(p).convert("RGB")


def detect(img):
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(img)))
    hands = [[(p.x, p.y, p.z) for p in h] for h in res.hand_landmarks]
    if len(hands) < 2:
        # Hands are small in the frame; a second pass on an enlarged upper part finds raised hands more reliably.
        w, h = img.size
        top = img.crop((0, 0, w, int(h * 0.8))).resize((w * 2, int(h * 0.8) * 2), Image.LANCZOS)
        res2 = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.asarray(top)))
        for hh in res2.hand_landmarks:
            pts = [(p.x, p.y * 0.8, p.z) for p in hh]
            if all(math.hypot(pts[0][0] - o[0][0], pts[0][1] - o[0][1]) > 0.05 for o in hands):
                hands.append(pts)
    return hands[:2]


def hand_vec(h):
    w = h[0]
    s = max(math.hypot((p[0] - w[0]) * ASPECT, p[1] - w[1]) for p in h) or 1.0
    return [c for p in h for c in ((p[0] - w[0]) * ASPECT / s, (p[1] - w[1]) / s, (p[2] - w[2]) / s)], s


def features(hands):
    hands = sorted(hands, key=lambda h: h[0][0])
    v0, s0 = hand_vec(hands[0])
    f = list(v0)
    if len(hands) > 1:
        v1, _ = hand_vec(hands[1])
        f += v1 + [(hands[1][0][0] - hands[0][0][0]) * ASPECT / s0, (hands[1][0][1] - hands[0][0][1]) / s0, 2.0]
    else:
        f += [0.0] * 66
    return [round(x, 3) for x in f]


iso = lambda p: [round(p[0] * ASPECT, 4), round(p[1], 4)]   # isotropic units: 1 = crop height

out, report = {}, []
for label, name in WORDS:
    path = video_dir / f"{name}.mp4"
    if not path.exists():
        report.append(f"{label}: no clip")
        continue
    per_frame = [detect(im) for im in frames(path)]
    n = len(per_frame)

    # Animation: two slots (left/right of the avatar), each held at its last position when not detected.
    slots, last = [], [None, None]
    for hands in per_frame:
        cur = [None, None]
        for h in hands:
            cur[0 if h[0][0] < MID_X else 1] = h
        for i in (0, 1):
            if cur[i] is not None:
                last[i] = cur[i]
        slots.append([None if last[i] is None else [iso(p) for p in last[i]] for i in (0, 1)])
    # Back-fill the start so a hand that is first seen later doesn't pop in.
    for i in (0, 1):
        first = next((s[i] for s in slots if s[i] is not None), None)
        for s in slots:
            if s[i] is None:
                s[i] = first
            else:
                break

    # Signing frames: from 35% of the clip on, active (raised) hands only.
    active = []
    for k, hands in enumerate(per_frame):
        if k < n * 0.35:
            continue
        up = [h for h in hands if h[0][1] < REST_Y]
        if up:
            active.append((k, up))
    if not active:
        report.append(f"{label}: no signing hands found ({sum(1 for h in per_frame if h)}/{n} frames had hands)")
        continue
    counts = {}
    for _, up in active:
        counts[len(up)] = counts.get(len(up), 0) + 1
    main = max(counts, key=counts.get)
    use = [(k, up) for k, up in active if len(up) == main or counts.get(len(up), 0) >= 5]
    vectors = []
    for _, up in use:
        vectors.append(features(up))
        vectors.append(features([[(1 - x, y, z) for x, y, z in h] for h in up]))   # left-handed version
    key = [up for _, up in use if len(up) == main][int(len([1 for _, up in use if len(up) == main]) * 0.7)]
    out[sid(label)] = {
        "label": label, "hands": main,
        "skeleton": [[iso(p) for p in h] for h in sorted(key, key=lambda h: h[0][0])],
        "vectors": vectors[:60],
        "anim": {"aspect": round(ASPECT, 4), "fps": 30,
                 "body": {k: iso(v) for k, v in BODY.items()},
                 "frames": [[s[0], s[1]] for s in slots]},
    }
    report.append(f"{label}: {main} hand(s), {len(active)}/{n} signing frames, {len(vectors[:60])} samples")

js = ("// Generated by tools/build_expressions.py. Hand points measured from community ISL avatar clips\n"
      "// (github.com/Rohitkumar-3103/Indian_Sign_Language_Projects). No video is included. Do not edit by hand.\n"
      "export const EXPRESSIONS = " + json.dumps(out, separators=(",", ":")) + ";\n")
(root / "frontend" / "js" / "builtin-expressions.js").write_text(js)
print("\n".join(report))
print(f"{len(out)} of {len(WORDS)} expressions built")
