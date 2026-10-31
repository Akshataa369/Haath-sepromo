"""
Writes step-by-step "how to sign it" instructions for every built-in sign,
worked out from the same hand points the app animates and checks:
hand shape (which fingers are straight), where the hand is, and how it moves.

The steps describe exactly what the picture or animation shows. They are not
an official ISL description, so the app always links to ISLRTC as well.

Usage: python build_instructions.py <app root>
Reads  frontend/js/builtin-signs.js and frontend/js/builtin-expressions.js
Writes frontend/js/sign-guide.js
"""
import json, math, re, sys
from pathlib import Path

root = Path(sys.argv[1])
load = lambda f, name: json.loads(re.search(name + r" = (.*);\n", (root / "frontend/js" / f).read_text()).group(1))
SIGNS = load("builtin-signs.js", "BUILTIN")
EXPR = load("builtin-expressions.js", "EXPRESSIONS")

TIPS, PIPS, MCPS = [4, 8, 12, 16, 20], [3, 6, 10, 14, 18], [2, 5, 9, 13, 17]
NAMES = ["thumb", "index finger", "middle finger", "ring finger", "little finger"]
d = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])


def size(h):
    return max(d(h[0], p) for p in h) or 1e-6


def straight(h):
    """Which fingers are straight: tip clearly farther from the wrist than the middle joint."""
    out = []
    for i, (t, p, m) in enumerate(zip(TIPS, PIPS, MCPS)):
        if i == 0:
            # thumb: tip well away from the index knuckle and the palm
            out.append(d(h[4], h[5]) > 0.55 * d(h[0], h[5]) and d(h[4], h[9]) > d(h[3], h[9]))
        else:
            # a straight finger's tip is about twice as far from the wrist as its knuckle
            out.append(d(h[0], h[t]) > 1.5 * d(h[0], h[m]) and d(h[0], h[t]) > 1.08 * d(h[0], h[p]))
    return out


def direction(v, mirror_word=True):
    """Direction of a 2D vector (y down) in the learner's words."""
    ang = math.degrees(math.atan2(-v[1], v[0]))
    if -35 <= ang <= 35:
        return "sideways"
    if 35 < ang < 145:
        return "up"
    if ang <= -35 and ang >= -145:
        return "down"
    return "sideways"


def shape(h):
    s = straight(h)
    hs = size(h)
    pinch = d(h[4], h[8]) < 0.22 * hs
    bunched = all(d(h[4], h[t]) < 0.3 * hs for t in TIPS[1:])
    thumb, idx, mid, ring, pinky = s
    fingers = s[1:]
    up = direction((h[12][0] - h[0][0], h[12][1] - h[0][1]))
    if bunched:
        return "all fingertips bunched together, touching the thumb"
    if all(fingers) and thumb:
        spread = d(h[8], h[20]) > 0.9 * hs
        return "an open hand, fingers spread" if spread else "a flat hand, fingers together"
    if all(fingers) and not thumb:
        return "a flat hand with the thumb folded in"
    if not any(fingers):
        if thumb:
            tip_up = h[4][1] < h[3][1] < h[2][1]
            return "a fist with the thumb sticking up" if tip_up else "a fist with the thumb out to the side"
        return "a closed fist"
    if pinch and not idx:
        rest = [NAMES[i + 1] for i, f in enumerate(fingers) if f]
        return "the thumb and index fingertips touching in a ring" + (f", other fingers up" if rest else "")
    names = [NAMES[i] for i, f in enumerate(s) if f]
    combos = {
        (False, True, False, False, False): "only the index finger straight, others folded",
        (False, True, True, False, False): "the index and middle fingers straight, like a V",
        (True, True, True, False, False): "the thumb, index and middle fingers out",
        (False, True, True, True, False): "three fingers straight (index, middle, ring)",
        (True, True, False, False, False): "the thumb and index finger out, like an L",
        (True, False, False, False, True): "the thumb and little finger out, others folded",
        (False, False, False, False, True): "only the little finger straight",
        (False, True, False, False, True): "the index and little fingers up, middle two folded",
        (True, True, False, False, True): "the thumb, index and little fingers out",
    }
    key = tuple(s)
    if key in combos:
        return combos[key]
    if len(names) == 1:
        return f"only the {names[0]} straight"
    return "the " + ", ".join(names[:-1]) + " and " + names[-1] + " straight, others folded"


def pointing(h):
    s = straight(h)
    if not any(s[1:]):
        return None
    tips = [TIPS[i] for i in range(1, 5) if s[i]]
    v = (sum(h[t][0] for t in tips) / len(tips) - h[0][0], sum(h[t][1] for t in tips) / len(tips) - h[0][1])
    return {"up": "pointing up", "down": "pointing down", "sideways": "pointing sideways"}[direction(v)]


def touching(a, b):
    hs = (size(a) + size(b)) / 2
    return min(d(p, q) for p in a for q in b) < 0.18 * hs


def place(h, body):
    """Where a hand is on the avatar's body (expressions only). Units: 1 = clip height."""
    c = (sum(p[0] for p in h) / 21, sum(p[1] for p in h) / 21)
    head, cx = body["head"], body["head"][0]
    side = abs(c[0] - cx) > 0.2
    if c[1] < head[1] - 0.06:
        return "above your head" if c[1] < head[1] - 0.14 else ("beside your forehead" if side else "at your forehead")
    if c[1] < head[1] + 0.07:
        return "beside your face" if side else "in front of your eyes and nose"
    if c[1] < body["neck"][1] + 0.02:
        return "out to the side at shoulder height" if side else "at your mouth and chin"
    if c[1] < 0.62:
        return "out to the side at chest height" if abs(c[0] - cx) > 0.28 else "in front of your chest"
    return "in front of your stomach"


def movement(track, hs, slot):
    """Describe a wrist track (list of (x, y)) relative to hand size."""
    if len(track) < 4:
        return "Hold the hand still."
    xs, ys = [p[0] for p in track], [p[1] for p in track]
    rx, ry = (max(xs) - min(xs)) / hs, (max(ys) - min(ys)) / hs
    if max(rx, ry) < 0.35:
        return "Hold the hand still."

    def reversals(v, amp):
        n, trend, ref = 0, 0, v[0]
        for x in v[1:]:
            if trend >= 0 and x < ref - amp:
                n += trend > 0; trend, ref = -1, x
            elif trend <= 0 and x > ref + amp:
                n += trend < 0; trend, ref = 1, x
            elif (trend > 0 and x > ref) or (trend < 0 and x < ref):
                ref = x
        return n

    dx, dy = track[-1][0] - track[0][0], track[-1][1] - track[0][1]
    if rx >= ry and rx > 0.6 and reversals(xs, 0.3 * hs) >= 2:
        return "Wave the hand side to side a couple of times."
    if ry > rx and ry > 0.6 and reversals(ys, 0.3 * hs) >= 2:
        return "Move the hand up and down a couple of times, like tapping."
    # one main direction; slot 0 is your right hand, so +x (avatar's left) is across your body
    parts = []
    if abs(dy) / hs > 0.35:
        parts.append("up" if dy < 0 else "down")
    if abs(dx) / hs > 0.35:
        inward = (dx > 0) == (slot == 0)
        parts.append("across your body" if inward else "outward, away from your body")
    if not parts:
        return "Make a small movement, then hold the final shape."
    return "Move the hand " + " and ".join(parts) + ", then hold the final shape."


guide = {}

# ---- numbers and letters: still pictures ------------------------------------------------
for sid, s in SIGNS.items():
    hands = s["skeleton"]                       # picture as you see it: left of picture = signer's right hand
    steps, chips = [], []
    if len(hands) == 1:
        h = hands[0]
        chips += ["One hand", "Still"]
        steps.append(f"Use one hand. Make {shape(h)}.")
        p = pointing(h)
        if p:
            steps.append(f"Keep the fingers {p}.")
    else:
        a, b = sorted(hands, key=lambda h: h[0][0])  # a = signer's right hand (left of picture)
        chips += ["Two hands", "Still"]
        steps.append(f"Right hand: make {shape(a)}.")
        steps.append(f"Left hand: make {shape(b)}.")
        steps.append("Bring the hands together so they touch, as in the picture." if touching(a, b)
                     else "Hold both hands up in front of your chest, close together but not touching.")
    steps.append("Hold the shape steady in front of the camera until the ring fills.")
    guide[sid] = {"chips": chips, "steps": steps}

# ---- expressions: animated --------------------------------------------------------------
cap = lambda t: t[0].upper() + t[1:]
for sid, e in EXPR.items():
    an = e["anim"]
    body, frames = an["body"], an["frames"]
    n = len(frames)
    rest = lambda h: h is None or h[0][1] > 0.78
    slots = [i for i in (0, 1) if any(not rest(fr[i]) for fr in frames[int(n * 0.35):])] or [0]
    two = len(slots) == 2
    # The arm-raise isn't part of the sign: describe from where the hand settles.
    w0 = max(int(n * 0.45), next((k for k in range(n) if all(not rest(frames[k][i]) for i in slots)), int(n * 0.45)))
    key = frames[int(n * 0.85)]
    info = {}
    for i in slots:
        a, b = frames[w0][i] or key[i], key[i]
        if a is None or b is None:
            continue
        track = [fr[i][0] for fr in frames[w0:] if fr[i] is not None and not rest(fr[i])]
        info[i] = {"s1": shape(a), "s2": shape(b), "p1": place(a, body), "p2": place(b, body),
                   "mv": movement(track, size(b), i)}
    steps, chips = [], ["Two hands" if two else "One hand"]
    moved = any(not v["mv"].startswith(("Hold", "Make a small")) for v in info.values())
    if not two:
        v = next(iter(info.values()))
        steps.append("Use your right hand (left-handed? mirror it with your left).")
        steps.append(f"Make {v['s1']}, and bring it {v['p1']}.")
        if not v["mv"].startswith(("Hold", "Make a small")):
            steps.append(v["mv"])
        diff = [x for x in (v["s2"] if v["s2"] != v["s1"] else None, v["p2"] if v["p2"] != v["p1"] else None) if x]
        if diff:
            steps.append("Finish with " + ", ".join(diff) + ".")
    else:
        r, l = info.get(0), info.get(1)
        if r and l and r["s1"] == l["s1"]:
            steps.append(f"Both hands: make {r['s1']}.")
            steps.append(f"Bring them {r['p1']}." if r["p1"] == l["p1"] else f"Right hand {r['p1']}, left hand {l['p1']}.")
        else:
            for word, v in (("Right hand", r), ("Left hand", l)):
                if v:
                    steps.append(f"{word}: make {v['s1']}, {v['p1']}.")
        for word, v in (("Right hand", r), ("Left hand", l)):
            if v and not v["mv"].startswith(("Hold", "Make a small")):
                steps.append(f"{word}: {v['mv'][0].lower() + v['mv'][1:]}")
            if v and v["s2"] != v["s1"]:
                steps.append(f"{word} finishes with {v['s2']}.")
        if key[0] and key[1] and touching(key[0], key[1]):
            steps.append("The hands touch at the end, as in the animation.")
    chips.append("Moves" if moved else "Still")
    steps.append("Hold the final shape for a second so the camera can check it.")
    guide[sid] = {"chips": chips, "steps": steps}

js = ("// Generated by tools/build_instructions.py from the built-in hand data. Do not edit by hand.\n"
      "// The steps describe what the picture or animation shows; always check signs with ISLRTC.\n"
      "export const GUIDE = " + json.dumps(guide, ensure_ascii=False, indent=0) + ";\n")
(root / "frontend/js/sign-guide.js").write_text(js)
for k in ["n1", "n5", "la", "lb", "ll", "e-hello", "e-thank-you", "e-friend", "e-eat", "e-help", "e-yes", "e-home"]:
    g = guide.get(k)
    if g:
        print(f"\n{k}  [{', '.join(g['chips'])}]")
        for i, s in enumerate(g["steps"], 1):
            print(f"  {i}. {s}")
