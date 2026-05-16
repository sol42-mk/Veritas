# Veritas VideoHash Worker

This optional worker computes the 64-bit VideoHash perceptual fingerprint used by new Veritas records.

Install in a local Python environment:

```bash
python3 -m venv .venv-videohash
.venv-videohash/bin/python -m pip install -r workers/videohash/requirements.txt
```

Then point the app to that Python interpreter:

```bash
VERITAS_VIDEOHASH_PYTHON=/home/shenol/projects/veritas/.venv-videohash/bin/python
VERITAS_VIDEOHASH_WORKER=/home/shenol/projects/veritas/workers/videohash/veritas_videohash.py
```

If this worker is not available, Veritas falls back to storing the legacy SHA-256 hash. VideoHash-backed records are stored in the existing Solana `video_hash` field as:

```text
videohash:<16 hex chars>
```
