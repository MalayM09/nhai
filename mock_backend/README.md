# Mock Sync Backend

Stand-in for the AWS sync endpoint during development and the demo. Single-file FastAPI server, no DB, no infra. Persists to a JSON file so a restart doesn't wipe demo enrollments.

## Endpoints

Mirrors `shared_contracts/README.md § Backend Sync Contract`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/attendance` | Receive one attendance event. App deletes its local row on 200 OK. |
| `POST` | `/enrollment` | Receive a newly enrolled user. |
| `GET` | `/embeddings/region/{region_id}` | Return every enrolled user in a region. |
| `GET` | `/attendance` | Debug: list everything we received. Handy on a second screen during demo. |
| `GET` | `/enrollments` | Debug: list summaries of all enrolled users. |
| `GET` | `/health` | Liveness probe. |
| `DELETE` | `/_admin/wipe` | Wipe all state between demo runs. |

Swagger UI auto-generated at **`http://localhost:8000/docs`** — handy for manual testing.

## How to run

```bash
cd mock_backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

`--host 0.0.0.0` is critical — it makes the server reachable from the phone on the same WiFi. With `localhost` only the laptop loopback can hit it.

## How to point the mobile app at it (Sahil — this is for you)

1. Find your laptop's LAN IP:
   - macOS / Linux: `ifconfig | grep "inet "` (look for a `192.168.x.x` or `10.x.x.x`, NOT `127.0.0.1`)
   - Windows: `ipconfig`
   - Example: `192.168.1.42`

2. In the mobile app, point sync POSTs at `http://192.168.1.42:8000/attendance` and refresh GETs at `http://192.168.1.42:8000/embeddings/region/default`.

3. Make sure the phone and laptop are on the same WiFi network.

4. `android.permission.INTERNET` is already in `AndroidManifest.xml` ✅

5. Android allows cleartext HTTP by default for **debug** builds. For release builds, see https://reactnative.dev/docs/network#using-other-networking-libraries if you want HTTPS.

## Request / response shapes

### `POST /attendance`

Request body:
```json
{
  "id": "worker_1717365000000_1717365001234",
  "user_id": "worker_1717365000000",
  "timestamp_wall": 1717365001234,
  "timestamp_monotonic": 87654321,
  "device_id": "device_pixel6a_001"
}
```

Response (200):
```json
{
  "status": "ok",
  "id": "worker_1717365000000_1717365001234",
  "received_at": "2026-06-03T14:30:00+00:00"
}
```

On 200, the mobile app's sync queue should issue `DELETE FROM attendance WHERE id = ?` with `payload.id`.

### `POST /enrollment`

Request body:
```json
{
  "id": "worker_1717365000000",
  "name": "Aarti",
  "embedding": [0.123, -0.456, ...],
  "enrollment_shots": 3,
  "enrollment_quality": 75.0,
  "region": "default"
}
```

Embedding MUST be exactly **512 floats** — the server validates and returns 400 otherwise.

### `GET /embeddings/region/{region_id}`

Response (200):
```json
[
  {
    "id": "worker_1717365000000",
    "name": "Aarti",
    "embedding": [0.123, -0.456, ...],
    "enrollment_shots": 3,
    "enrollment_quality": 75.0
  }
]
```

## Files

```
mock_backend/
├── main.py              # the FastAPI app — single file, ~250 lines
├── requirements.txt     # fastapi, uvicorn, pydantic
├── sample_data.json     # pre-seeded "Demo User A" (zero-vector embedding for testing)
├── state.json           # auto-created on first write — persisted state
└── README.md            # this file
```

`state.json` is gitignored — it's just runtime persistence so a restart doesn't wipe demo enrollments. Delete it (or `DELETE /_admin/wipe`) to reset.

## Curl tests (no app needed)

```bash
# Health
curl http://localhost:8000/health

# Enroll a synthetic user with a 512-dim zero embedding
python -c "import json; print(json.dumps({'id':'test1','name':'Test','embedding':[0.0]*512,'enrollment_shots':3,'enrollment_quality':70.0,'region':'default'}))" | curl -X POST -H "Content-Type: application/json" -d @- http://localhost:8000/enrollment

# List enrolled users (summaries)
curl http://localhost:8000/enrollments

# Get all users in region 'default'
curl http://localhost:8000/embeddings/region/default

# Send an attendance event
curl -X POST -H "Content-Type: application/json" -d '{"id":"att_001","user_id":"test1","timestamp_wall":1717365001234,"timestamp_monotonic":12345,"device_id":"demo_phone"}' http://localhost:8000/attendance

# See what arrived
curl http://localhost:8000/attendance

# Wipe between demo runs
curl -X DELETE http://localhost:8000/_admin/wipe
```

## Production swap

To swap this for real AWS in production: keep the same endpoint contracts, replace this directory with an actual FastAPI + database deployment (or AWS API Gateway + Lambda). The mobile app's sync queue code shouldn't need to change — only the base URL.
