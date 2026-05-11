#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
import sys

try:
    import cupy as cp
    import numpy as np
except Exception as exc:
    print(f"CUDA worker requires cupy and numpy: {exc}", file=sys.stderr)
    sys.exit(2)


COEFF_A = (3, 4)
COEFF_B = (4, 3)


def emit(message, progress, current_frame=None, total_frames=None):
    payload = {"message": message, "progress": progress}
    if current_frame is not None:
        payload["currentFrame"] = current_frame
    if total_frames is not None:
        payload["totalFrames"] = total_frames
    print(json.dumps(payload), flush=True)


def hex_to_bits(hex_value):
    bits = []
    for char in hex_value:
        nibble = int(char, 16)
        bits.extend([(nibble >> 3) & 1, (nibble >> 2) & 1, (nibble >> 1) & 1, nibble & 1])
    return np.asarray(bits, dtype=np.float32)


def shuffle_points(points, seed):
    state = seed & 0xFFFFFFFF

    def random():
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        return state / 0x100000000

    for i in range(len(points) - 1, 0, -1):
        j = int(math.floor(random() * (i + 1)))
        points[i], points[j] = points[j], points[i]


def create_embedding_plan(width, height, bit_repetitions):
    cols = width // 8
    rows = height // 8
    points = []

    for y in range(3, rows - 3):
        for x in range(3, cols - 3):
            points.append((x * 8, y * 8))

    shuffle_points(points, 0x51F15EED)
    required = 128 * bit_repetitions
    if len(points) < required:
        raise RuntimeError("Video is too small for robust watermark embedding.")

    selected = points[:required]
    xs = np.asarray([point[0] for point in selected], dtype=np.int32)
    ys = np.asarray([point[1] for point in selected], dtype=np.int32)
    bit_indices = np.asarray([idx % 128 for idx in range(required)], dtype=np.int32)
    return xs, ys, bit_indices


def make_dct_matrix():
    matrix = np.zeros((8, 8), dtype=np.float32)
    for u in range(8):
        scale = math.sqrt(1 / 8) if u == 0 else math.sqrt(2 / 8)
        for x in range(8):
            matrix[u, x] = scale * math.cos(((2 * x + 1) * u * math.pi) / 16)
    return cp.asarray(matrix)


def gather_luma_blocks(frame_gpu, xs_gpu, ys_gpu):
    offsets = cp.arange(8, dtype=cp.int32)
    y_idx = ys_gpu[:, None, None] + offsets[None, :, None]
    x_idx = xs_gpu[:, None, None] + offsets[None, None, :]
    blocks = frame_gpu[y_idx, x_idx, :]
    return (
        0.299 * blocks[..., 0]
        + 0.587 * blocks[..., 1]
        + 0.114 * blocks[..., 2]
        - 128
    ).astype(cp.float32)


def apply_luma_delta(frame_gpu, xs_gpu, ys_gpu, delta_gpu):
    offsets = cp.arange(8, dtype=cp.int32)
    y_idx = ys_gpu[:, None, None] + offsets[None, :, None]
    x_idx = xs_gpu[:, None, None] + offsets[None, None, :]

    for channel in range(3):
        values = frame_gpu[y_idx, x_idx, channel].astype(cp.float32) + delta_gpu
        frame_gpu[y_idx, x_idx, channel] = cp.clip(cp.rint(values), 0, 255).astype(cp.uint8)


def embed_frame(frame_bytes, width, height, bits_gpu, xs_gpu, ys_gpu, bit_indices_gpu, dct_matrix, args):
    frame_cpu = np.frombuffer(frame_bytes, dtype=np.uint8).reshape((height, width, 3)).copy()
    frame_gpu = cp.asarray(frame_cpu)
    original_y = gather_luma_blocks(frame_gpu, xs_gpu, ys_gpu)
    coeffs = dct_matrix[None, :, :] @ original_y @ dct_matrix.T[None, :, :]

    a_index = (COEFF_A[1], COEFF_A[0])
    b_index = (COEFF_B[1], COEFF_B[0])
    coeff_a = coeffs[:, a_index[0], a_index[1]]
    coeff_b = coeffs[:, b_index[0], b_index[1]]
    bit_values = bits_gpu[bit_indices_gpu]
    desired_diff = cp.where(bit_values == 1, args.dct_strength, -args.dct_strength)
    current_diff = coeff_a - coeff_b
    needs_adjustment = cp.where(bit_values == 1, current_diff < args.dct_strength, current_diff > -args.dct_strength)
    adjustment = cp.where(needs_adjustment, (desired_diff - current_diff) / 2, 0)

    coeffs[:, a_index[0], a_index[1]] += adjustment
    coeffs[:, b_index[0], b_index[1]] -= adjustment

    updated_y = dct_matrix.T[None, :, :] @ coeffs @ dct_matrix[None, :, :]
    delta = updated_y - original_y
    delta = delta - cp.mean(delta, axis=(1, 2), keepdims=True)
    delta = cp.clip(delta, -args.max_luma_delta, args.max_luma_delta)
    apply_luma_delta(frame_gpu, xs_gpu, ys_gpu, delta)

    return cp.asnumpy(frame_gpu).tobytes()


def encoder_args():
    if os.environ.get("VERITAS_VIDEO_ENCODER") == "nvenc":
        return [
            "-c:v", "h264_nvenc",
            "-preset", os.environ.get("VERITAS_NVENC_PRESET", "p4"),
            "-cq", os.environ.get("VERITAS_NVENC_CQ", "23"),
            "-pix_fmt", "yuv420p",
        ]

    return [
        "-c:v", "libx264",
        "-preset", os.environ.get("VERITAS_X264_PRESET", "ultrafast"),
        "-crf", os.environ.get("VERITAS_X264_CRF", "23"),
        "-pix_fmt", "yuv420p",
    ]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--watermark-id", required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--fps", type=float, required=True)
    parser.add_argument("--total-frames", type=int, required=True)
    parser.add_argument("--bit-repetitions", type=int, required=True)
    parser.add_argument("--dct-strength", type=float, required=True)
    parser.add_argument("--max-luma-delta", type=float, required=True)
    parser.add_argument("--ffmpeg", required=True)
    args = parser.parse_args()

    frame_size = args.width * args.height * 3
    xs, ys, bit_indices = create_embedding_plan(args.width, args.height, args.bit_repetitions)
    xs_gpu = cp.asarray(xs)
    ys_gpu = cp.asarray(ys)
    bit_indices_gpu = cp.asarray(bit_indices)
    bits_gpu = cp.asarray(hex_to_bits(args.watermark_id))
    dct_matrix = make_dct_matrix()

    decode_args = [
        args.ffmpeg,
        "-i", args.input,
        "-vf", f"scale={args.width}:{args.height},fps={args.fps}",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "pipe:1",
    ]
    encode_args = [
        args.ffmpeg,
        "-y",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", f"{args.width}x{args.height}",
        "-r", str(args.fps),
        "-i", "pipe:0",
        "-i", args.input,
        "-map", "0:v:0",
        "-map", "1:a?",
        *encoder_args(),
        "-c:a", "aac",
        "-b:a", "128k",
        "-shortest",
        "-movflags", "use_metadata_tags",
        "-metadata", f"veritas_id={args.watermark_id}",
        "-metadata", "veritas_watermark=metadata+dct-spread-spectrum-cuda",
        args.output,
    ]

    decoder = subprocess.Popen(decode_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    encoder = subprocess.Popen(encode_args, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    pending = bytearray()
    frame_index = 0

    emit("CUDA DCT worker embedding frames...", 0.1, 0, args.total_frames)

    try:
        while True:
            chunk = decoder.stdout.read(frame_size)
            if not chunk:
                break
            pending.extend(chunk)

            while len(pending) >= frame_size:
                frame = bytes(pending[:frame_size])
                del pending[:frame_size]
                encoded = embed_frame(
                    frame,
                    args.width,
                    args.height,
                    bits_gpu,
                    xs_gpu,
                    ys_gpu,
                    bit_indices_gpu,
                    dct_matrix,
                    args,
                )
                encoder.stdin.write(encoded)
                frame_index += 1

                if frame_index == 1 or frame_index >= args.total_frames or frame_index % 3 == 0:
                    emit(
                        f"CUDA DCT watermarking frame {min(frame_index, args.total_frames)} of {args.total_frames}...",
                        0.1 + min(frame_index / args.total_frames, 1) * 0.75,
                        frame_index,
                        args.total_frames,
                    )

        decoder_stderr = decoder.stderr.read().decode("utf8", errors="replace")
        decoder_code = decoder.wait()
        encoder.stdin.close()
        encoder_stderr = encoder.stderr.read().decode("utf8", errors="replace")
        encoder_code = encoder.wait()

        if decoder_code != 0:
            raise RuntimeError(f"ffmpeg decoder failed with code {decoder_code}\n{decoder_stderr[-2000:]}")
        if encoder_code != 0:
            raise RuntimeError(f"ffmpeg encoder failed with code {encoder_code}\n{encoder_stderr[-2000:]}")
        if frame_index == 0:
            raise RuntimeError("No frames were decoded for CUDA DCT watermarking.")

        emit("CUDA DCT watermark finished.", 0.94, frame_index, args.total_frames)
    except Exception as exc:
        try:
            decoder.kill()
        except Exception:
            pass
        try:
            encoder.kill()
        except Exception:
            pass
        print(str(exc), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
