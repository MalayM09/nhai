"""
Mock NHAI sync backend.

This is a deliberately minimal FastAPI server that implements the three
endpoints from `shared_contracts/README.md` so the mobile app can exercise
its sync queue + purge logic during development and the demo.

It is NOT meant to replace AWS in production. It runs locally on a laptop,
stores everything in memory (with optional JSON persistence), and prints
every request to the console so you can see what the app is sending.

Endpoints (matching `shared_contracts/README.md § Backend Sync Contract`):

  POST   /attendance               — receive an attendance event from the app
  POST   /enrollment               — receive a new enrolled user (extends contract)
  GET    /embeddings/region/{id}   — return all enrolled users for a region
  GET    /attendance               — debug: list everything we received
  GET    /enrollments              — debug: list everything enrolled
  GET    /health                   — liveness probe

How to run:

    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload

The `--host 0.0.0.0` matters: it makes the server reachable from the phone
on the same WiFi. With `localhost` it only binds to the laptop loopback.

How to hit it from the app (Sahil — this is for you):

    1. Find your laptop's LAN IP:   `ifconfig | grep "inet "` (macOS / Linux)
                                    `ipconfig` (Windows)
       Example output: 192.168.1.42
    2. In the mobile app, point your sync POSTs at:
       http://192.168.1.42:8000/attendance
    3. Make sure phone + laptop are on the same WiFi.
    4. android.permission.INTERNET is already in the manifest.
    5. Android cleartext HTTP is allowed by default for non-release builds.

Swagger UI for manual testing:  http://localhost:8000/docs
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Path as PathParam
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ──────────────────────────── config ────────────────────────────

PERSIST_FILE = Path(__file__).parent / "state.json"
SAMPLE_FILE = Path(__file__).parent / "sample_data.json"
EMBEDDING_DIM = 512

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger("mock-backend")

# ──────────────────────────── schemas ────────────────────────────


class AttendanceIn(BaseModel):
    """Body the mobile app POSTs to /attendance.

    Mirrors the `attendance` table schema from `shared_contracts/README.md`.
    `id` is the local row id from the device's SQLite — we send it back in
    the response so the app can DELETE that exact row on 200 OK.
    """

    id: str = Field(..., description="device-local SQLite row id")
    user_id: str
    timestamp_wall: int = Field(..., description="ms since epoch")
    timestamp_monotonic: int = Field(
        ..., description="device uptime in ms — anti time-tamper"
    )
    device_id: str = Field(..., description="hardware identifier for the phone")


class AttendanceOut(BaseModel):
    status: str = "ok"
    id: str
    received_at: str  # ISO 8601 UTC, set server-side


class EnrollmentIn(BaseModel):
    """Body the mobile app POSTs to /enrollment.

    Mirrors the `users` table schema with one extra `region` field for sharding.
    The embedding must be exactly 512 floats (validated below).
    """

    id: str
    name: str
    embedding: List[float]
    enrollment_shots: int = Field(..., ge=1, le=20)
    enrollment_quality: Optional[float] = None
    region: str = Field(default="default", description="for /embeddings/region/{id}")


class EnrollmentOut(BaseModel):
    id: str
    name: str
    embedding: List[float]
    enrollment_shots: int
    enrollment_quality: Optional[float]


# ──────────────────────────── state ────────────────────────────


class State:
    """In-memory store. Persisted to JSON on every write so a restart
    doesn't wipe the demo's enrolled users."""

    def __init__(self) -> None:
        # attendance rows we've received: list of dicts as posted, plus a received_at field
        self.attendance: List[dict] = []
        # enrollments keyed by user id
        self.enrollments: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        if PERSIST_FILE.exists():
            data = json.loads(PERSIST_FILE.read_text())
            self.attendance = data.get("attendance", [])
            self.enrollments = data.get("enrollments", {})
            log.info(
                "Loaded persisted state: %d enrollments, %d attendance rows",
                len(self.enrollments),
                len(self.attendance),
            )
        elif SAMPLE_FILE.exists():
            sample = json.loads(SAMPLE_FILE.read_text())
            self.enrollments = {u["id"]: u for u in sample.get("enrollments", [])}
            log.info("Loaded sample data: %d enrollments", len(self.enrollments))

    def save(self) -> None:
        PERSIST_FILE.write_text(
            json.dumps(
                {"attendance": self.attendance, "enrollments": self.enrollments},
                indent=2,
            )
        )


state = State()

# ──────────────────────────── app ────────────────────────────

app = FastAPI(
    title="NHAI Mock Sync Backend",
    description="Local stand-in for the AWS sync endpoint while we build the demo.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "enrollments": len(state.enrollments),
        "attendance_rows": len(state.attendance),
        "server_time_utc": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/attendance", response_model=AttendanceOut)
def post_attendance(payload: AttendanceIn) -> AttendanceOut:
    """Receive one attendance event.

    On 200, the mobile app deletes the local SQLite row by `payload.id`.
    We append to the in-memory log, persist, and echo the id back.
    """
    received_at = datetime.now(timezone.utc).isoformat()
    row = payload.model_dump()
    row["received_at"] = received_at
    state.attendance.append(row)
    state.save()
    log.info(
        "POST /attendance  user=%s  id=%s  wall=%d  monotonic=%d  device=%s",
        payload.user_id,
        payload.id,
        payload.timestamp_wall,
        payload.timestamp_monotonic,
        payload.device_id,
    )
    return AttendanceOut(id=payload.id, received_at=received_at)


@app.post("/enrollment", response_model=EnrollmentOut)
def post_enrollment(payload: EnrollmentIn) -> EnrollmentOut:
    """Receive a new enrolled user from an admin device."""
    if len(payload.embedding) != EMBEDDING_DIM:
        raise HTTPException(
            status_code=400,
            detail=f"embedding must be {EMBEDDING_DIM} floats, got {len(payload.embedding)}",
        )
    state.enrollments[payload.id] = payload.model_dump()
    state.save()
    log.info(
        "POST /enrollment  id=%s  name=%s  region=%s  shots=%d",
        payload.id,
        payload.name,
        payload.region,
        payload.enrollment_shots,
    )
    return EnrollmentOut(**{k: v for k, v in payload.model_dump().items() if k != "region"})


@app.get("/embeddings/region/{region_id}", response_model=List[EnrollmentOut])
def get_embeddings_for_region(region_id: str = PathParam(...)) -> List[EnrollmentOut]:
    """Return every enrolled user for a region.

    The mobile app polls this on reconnect to refresh its local templates
    in case a user was enrolled on another device.
    """
    matches = [
        EnrollmentOut(**{k: v for k, v in u.items() if k != "region"})
        for u in state.enrollments.values()
        if u.get("region", "default") == region_id
    ]
    log.info("GET  /embeddings/region/%s  -> %d users", region_id, len(matches))
    return matches


# ─────────── debug endpoints (not in the contract — for the demo) ───────────


@app.get("/attendance")
def list_attendance() -> dict:
    """Return everything we've received. Handy to project on a second screen
    during the demo so judges can see the sync actually happening."""
    return {"count": len(state.attendance), "rows": state.attendance}


@app.get("/enrollments")
def list_enrollments() -> dict:
    """Return all enrolled users (without their full embeddings to keep response small)."""
    summary = [
        {
            "id": u["id"],
            "name": u["name"],
            "region": u.get("region", "default"),
            "shots": u["enrollment_shots"],
            "embedding_dim": len(u["embedding"]),
        }
        for u in state.enrollments.values()
    ]
    return {"count": len(summary), "users": summary}


@app.delete("/_admin/wipe")
def wipe_state() -> dict:
    """Clear all in-memory + persisted state. Useful between demo runs."""
    state.attendance.clear()
    state.enrollments.clear()
    state.save()
    log.warning("ADMIN: wiped all state")
    return {"status": "wiped"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.environ.get("PORT", "8000")),
        reload=False,
    )
