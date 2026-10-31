"""
Haath Se backend.

The signs are fixed (ISL numbers 1-9 and letters A-Z, as taught by ISLRTC).
Learners only read data. Organisers record hand-pose samples on the PIN-protected
/setup page so the camera can check each sign.

Only small JSON is stored: landmark number arrays, small reference photos and
Sign Rush scores. Video never reaches this server; hand tracking and recognition
happen in the browser.

Storage:
  - If MONGO_URL is set, data goes to MongoDB (DB_NAME, default "haath_se").
  - Otherwise it is saved to backend/data.json, so the app runs with zero setup.

Setup PIN:
  - Set SETUP_PIN to choose one. If it's not set, a PIN is generated and printed
    when the server starts.

Run (from the backend folder):  uvicorn server:app --reload --port 8000
"""
import asyncio
import json
import os
import secrets
import time
import uuid
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

# ---------------------------------------------------------------- settings
HERE = Path(__file__).resolve().parent
FRONTEND = HERE.parent / "frontend"
DATA_FILE = Path(os.environ.get("HAATH_DATA_FILE", HERE / "data.json"))
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME", "haath_se")
SETUP_PIN = os.environ.get("SETUP_PIN") or "".join(secrets.choice("23456789") for _ in range(6))

MEDIA_DIR = Path(os.environ.get("HAATH_MEDIA_DIR", HERE / "media"))
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
MAX_CLIP_BYTES = 4_000_000     # a few seconds of webcam video
CLIP_TYPES = {"video/webm": "webm", "video/mp4": "mp4"}

FEAT_LEN = 129                 # numbers per recorded hand pose
MAX_VECTORS = 60               # per upload request
MAX_SAMPLES_PER_SIGN = 400
MAX_REF_CHARS = 60_000         # ~45 KB JPEG as a data URL
MAX_BODY_BYTES = 1_000_000
RATE_LIMIT = 120               # write requests per minute per IP

# The fixed curriculum. Must match frontend/js/lessons.js
EXPRESSION_WORDS = [
    "Hello", "Welcome", "Good morning", "Good night", "Thank you", "Please",
    "Sorry", "Yes", "No", "Good", "Bad", "Help",
    "Stop", "Wait", "Come", "Go", "Again", "Understand",
    "Name", "Eat", "Drink", "Hungry", "Thirsty", "Home",
    "School", "Friend", "Mother", "Father", "Happy", "Bye",
]
SIGN_IDS = ([f"n{n}" for n in range(1, 10)]
            + [f"l{c}" for c in "abcdefghijklmnopqrstuvwxyz"]
            + ["e-" + "-".join(w.lower().split()) for w in EXPRESSION_WORDS])
SIGN_SET = set(SIGN_IDS)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------- request models
class RefIn(BaseModel):
    ref_image: Optional[str] = None


class SamplesIn(BaseModel):
    sign_id: str
    recorded_by: str = Field(default="", max_length=20)
    vectors: List[List[float]] = Field(min_length=1, max_length=MAX_VECTORS)

    @field_validator("vectors")
    @classmethod
    def check_vectors(cls, v):
        out = []
        for vec in v:
            if len(vec) != FEAT_LEN:
                raise ValueError(f"Each vector must have exactly {FEAT_LEN} numbers.")
            out.append([round(float(x), 3) for x in vec])
        return out


class ScoreIn(BaseModel):
    nickname: str = Field(min_length=1, max_length=20)
    score: int = Field(ge=0, le=100_000)

    @field_validator("nickname")
    @classmethod
    def strip_nick(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("Nickname can't be empty.")
        return v


# ---------------------------------------------------------------- storage: JSON file
class FileRepo:
    kind = "file"

    def __init__(self, path: Path):
        self.path = path
        self.lock = asyncio.Lock()
        self.db = {"refs": {}, "samples": [], "scores": []}
        if path.exists():
            try:
                self.db.update(json.loads(path.read_text()))
            except (json.JSONDecodeError, OSError):
                backup = path.with_suffix(".broken.json")
                path.rename(backup)
                print(f"Data file was unreadable; moved it to {backup}")

    async def init(self):
        pass

    def _save(self):
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.db))
        tmp.replace(self.path)

    async def sign_stats(self):
        counts, by = defaultdict(int), defaultdict(set)
        for s in self.db["samples"]:
            counts[s["sign_id"]] += 1
            if s.get("recorded_by"):
                by[s["sign_id"]].add(s["recorded_by"])
        return {sid: {"sample_count": counts[sid], "recorded_by": sorted(by[sid]),
                      "ref_image": self.db["refs"].get(sid)} for sid in SIGN_IDS}

    async def count_samples(self, sign_id):
        return sum(1 for s in self.db["samples"] if s["sign_id"] == sign_id)

    async def list_samples(self):
        return [{"sign_id": s["sign_id"], "vector": s["vector"]} for s in self.db["samples"]]

    async def add_samples(self, sign_id, recorded_by, vectors):
        async with self.lock:
            t = now_iso()
            self.db["samples"].extend({"id": uuid.uuid4().hex, "sign_id": sign_id, "vector": v,
                                       "recorded_by": recorded_by, "created_at": t} for v in vectors)
            self._save()

    async def clear_sign(self, sign_id):
        async with self.lock:
            self.db["samples"] = [s for s in self.db["samples"] if s["sign_id"] != sign_id]
            self.db["refs"].pop(sign_id, None)
            self._save()

    async def set_ref(self, sign_id, ref):
        async with self.lock:
            if ref is None:
                self.db["refs"].pop(sign_id, None)
            else:
                self.db["refs"][sign_id] = ref
            self._save()

    async def leaderboard(self):
        rows = sorted(self.db["scores"], key=lambda s: (-s["score"], s["created_at"]))[:10]
        return [{"nickname": r["nickname"], "score": r["score"], "created_at": r["created_at"]} for r in rows]

    async def add_score(self, nickname, score):
        async with self.lock:
            self.db["scores"].append({"nickname": nickname, "score": score, "created_at": now_iso()})
            self._save()


# ---------------------------------------------------------------- storage: MongoDB
class MongoRepo:
    kind = "mongodb"

    def __init__(self, url, name):
        from motor.motor_asyncio import AsyncIOMotorClient
        self.db = AsyncIOMotorClient(url)[name]

    async def init(self):
        await self.db.samples.create_index("sign_id")
        await self.db.refs.create_index("sign_id", unique=True)
        await self.db.scores.create_index([("score", -1), ("created_at", 1)])

    async def sign_stats(self):
        stats = {sid: {"sample_count": 0, "recorded_by": [], "ref_image": None} for sid in SIGN_IDS}
        async for row in self.db.samples.aggregate([
            {"$group": {"_id": "$sign_id", "n": {"$sum": 1}, "by": {"$addToSet": "$recorded_by"}}}
        ]):
            if row["_id"] in stats:
                stats[row["_id"]]["sample_count"] = row["n"]
                stats[row["_id"]]["recorded_by"] = sorted(b for b in row["by"] if b)
        async for r in self.db.refs.find({}, {"_id": 0}):
            if r["sign_id"] in stats:
                stats[r["sign_id"]]["ref_image"] = r["ref_image"]
        return stats

    async def count_samples(self, sign_id):
        return await self.db.samples.count_documents({"sign_id": sign_id})

    async def list_samples(self):
        cur = self.db.samples.find({}, {"_id": 0, "sign_id": 1, "vector": 1})
        return await cur.to_list(length=len(SIGN_IDS) * MAX_SAMPLES_PER_SIGN)

    async def add_samples(self, sign_id, recorded_by, vectors):
        t = now_iso()
        await self.db.samples.insert_many([{"sign_id": sign_id, "vector": v, "recorded_by": recorded_by,
                                            "created_at": t} for v in vectors])

    async def clear_sign(self, sign_id):
        await self.db.samples.delete_many({"sign_id": sign_id})
        await self.db.refs.delete_one({"sign_id": sign_id})

    async def set_ref(self, sign_id, ref):
        if ref is None:
            await self.db.refs.delete_one({"sign_id": sign_id})
        else:
            await self.db.refs.update_one({"sign_id": sign_id}, {"$set": {"ref_image": ref}}, upsert=True)

    async def leaderboard(self):
        cur = self.db.scores.find({}, {"_id": 0}).sort([("score", -1), ("created_at", 1)]).limit(10)
        return await cur.to_list(length=10)

    async def add_score(self, nickname, score):
        await self.db.scores.insert_one({"nickname": nickname, "score": score, "created_at": now_iso()})


# ---------------------------------------------------------------- app
repo = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global repo
    repo = MongoRepo(MONGO_URL, DB_NAME) if MONGO_URL else FileRepo(DATA_FILE)
    await repo.init()
    print(f"Haath Se storage: {repo.kind}")
    print(f"Haath Se setup PIN: {SETUP_PIN}  (set SETUP_PIN to choose your own)")
    yield


app = FastAPI(title="Haath Se API", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

_hits = defaultdict(deque)


@app.middleware("http")
async def guard(request: Request, call_next):
    if request.url.path.startswith("/api"):
        length = request.headers.get("content-length")
        limit = MAX_CLIP_BYTES + 1024 if request.url.path.endswith("/clip") else MAX_BODY_BYTES
        if length and length.isdigit() and int(length) > limit:
            return JSONResponse({"detail": "That upload is too large."}, status_code=413)
        if request.method in ("POST", "PUT", "DELETE"):
            ip = request.client.host if request.client else "unknown"
            q, t = _hits[ip], time.monotonic()
            while q and t - q[0] > 60:
                q.popleft()
            if len(q) >= RATE_LIMIT:
                return JSONResponse({"detail": "Too many requests. Wait a minute and try again."}, status_code=429)
            q.append(t)
    response = await call_next(request)
    # Always serve the latest files: stops browsers showing an old version after an update.
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


def need_pin(pin: Optional[str]):
    if not pin or not secrets.compare_digest(pin, SETUP_PIN):
        raise HTTPException(401, "Wrong setup PIN.")


def need_sign(sign_id: str):
    if sign_id not in SIGN_SET:
        raise HTTPException(404, "Unknown sign.")


@app.get("/api/health")
async def health():
    return {"ok": True, "storage": repo.kind}


def clip_path(sign_id: str) -> Optional[Path]:
    for ext in CLIP_TYPES.values():
        p = MEDIA_DIR / f"{sign_id}.{ext}"
        if p.exists():
            return p
    return None


@app.get("/api/signs")
async def signs():
    """Recording status, reference photo and demo clip for every sign."""
    stats = await repo.sign_stats()
    for sid in SIGN_IDS:
        p = clip_path(sid)
        stats[sid]["clip_url"] = f"/media/{p.name}?v={int(p.stat().st_mtime)}" if p else None
    return stats


@app.put("/api/signs/{sign_id}/clip")
async def set_clip(sign_id: str, request: Request, x_setup_pin: Optional[str] = Header(default=None)):
    """Save a short demo video of the sign (raw WebM or MP4 body)."""
    need_pin(x_setup_pin)
    need_sign(sign_id)
    ctype = (request.headers.get("content-type") or "").split(";")[0].strip().lower()
    ext = CLIP_TYPES.get(ctype)
    if not ext:
        raise HTTPException(415, "The demo clip must be a WebM or MP4 video.")
    data = await request.body()
    if not data:
        raise HTTPException(422, "The demo clip was empty. Try recording again.")
    if len(data) > MAX_CLIP_BYTES:
        raise HTTPException(413, "The demo clip is too large. Keep it to a few seconds.")
    old = clip_path(sign_id)
    if old:
        old.unlink()
    (MEDIA_DIR / f"{sign_id}.{ext}").write_bytes(data)
    return {"ok": True}


@app.get("/api/samples")
async def samples():
    return await repo.list_samples()


@app.post("/api/setup/check")
async def setup_check(x_setup_pin: Optional[str] = Header(default=None)):
    need_pin(x_setup_pin)
    return {"ok": True}


@app.post("/api/samples", status_code=201)
async def add_samples(body: SamplesIn, x_setup_pin: Optional[str] = Header(default=None)):
    need_pin(x_setup_pin)
    need_sign(body.sign_id)
    if await repo.count_samples(body.sign_id) + len(body.vectors) > MAX_SAMPLES_PER_SIGN:
        raise HTTPException(413, f"This sign already has close to {MAX_SAMPLES_PER_SIGN} samples. Clear it to re-record.")
    await repo.add_samples(body.sign_id, body.recorded_by.strip(), body.vectors)
    return {"ok": True, "added": len(body.vectors)}


@app.delete("/api/signs/{sign_id}")
async def clear_sign(sign_id: str, x_setup_pin: Optional[str] = Header(default=None)):
    need_pin(x_setup_pin)
    need_sign(sign_id)
    await repo.clear_sign(sign_id)
    old = clip_path(sign_id)
    if old:
        old.unlink()
    return {"ok": True}


@app.put("/api/signs/{sign_id}/ref")
async def set_ref(sign_id: str, body: RefIn, x_setup_pin: Optional[str] = Header(default=None)):
    need_pin(x_setup_pin)
    need_sign(sign_id)
    ref = body.ref_image
    if ref is not None:
        if not (ref.startswith("data:image/jpeg;base64,") or ref.startswith("data:image/png;base64,")):
            raise HTTPException(422, "Reference photo must be a JPEG or PNG data URL.")
        if len(ref) > MAX_REF_CHARS:
            raise HTTPException(413, "Reference photo is too large.")
    await repo.set_ref(sign_id, ref)
    return {"ok": True}


@app.get("/api/leaderboard")
async def leaderboard():
    return await repo.leaderboard()


@app.post("/api/scores", status_code=201)
async def add_score(body: ScoreIn):
    await repo.add_score(body.nickname, body.score)
    return {"ok": True}


# ---------------------------------------------------------------- pages
@app.get("/")
async def landing():
    return FileResponse(FRONTEND / "index.html")


@app.get("/learn")
async def learn():
    return FileResponse(FRONTEND / "learn.html")


@app.get("/setup")
async def setup():
    return FileResponse(FRONTEND / "setup.html")


app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")
