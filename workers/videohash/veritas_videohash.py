#!/usr/bin/env python3
import argparse
import json
import sys


def normalize_hash_hex(value):
    normalized = str(value).strip().lower()
    if normalized.startswith("0x"):
        normalized = normalized[2:]
    if len(normalized) > 16:
        normalized = normalized[-16:]
    normalized = normalized.zfill(16)
    if len(normalized) != 16 or any(char not in "0123456789abcdef" for char in normalized):
        raise ValueError(f"Invalid VideoHash hex value: {value}")
    return normalized


def main():
    parser = argparse.ArgumentParser(description="Compute a VideoHash perceptual fingerprint.")
    parser.add_argument("--input", required=True, help="Path to the input video.")
    args = parser.parse_args()

    try:
        from videohash import VideoHash
    except Exception as exc:
        raise RuntimeError(
            "Python package 'videohash' is not installed. Install it with: python -m pip install videohash"
        ) from exc

    video_hash = VideoHash(path=args.input)

    try:
        hash_hex = normalize_hash_hex(video_hash.hash_hex)
        print(json.dumps({"hashHex": hash_hex}))
    finally:
        delete_storage_path = getattr(video_hash, "delete_storage_path", None)
        if callable(delete_storage_path):
            delete_storage_path()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
