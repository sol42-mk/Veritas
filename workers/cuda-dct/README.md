# Veritas CUDA DCT Worker

Optional local worker for GPU DCT watermark embedding.

The main app does not require this worker. CPU DCT remains the default.

## Local Setup

Install a CUDA-capable Python environment in WSL:

```bash
python3 -m venv .venv-cuda
source .venv-cuda/bin/activate
pip install "cupy-cuda12x"
```

Install or expose an ffmpeg build that supports your desired encoder. For NVIDIA encoding:

```bash
ffmpeg -hide_banner -encoders | grep nvenc
```

Then put this in `.env.local`:

```bash
VERITAS_DCT_BACKEND=cuda
VERITAS_DCT_FALLBACK=cpu
VERITAS_CUDA_PYTHON=/home/shenol/projects/veritas/.venv-cuda/bin/python
VERITAS_CUDA_DCT_WORKER=/home/shenol/projects/veritas/workers/cuda-dct/veritas_cuda_dct.py
VERITAS_FFMPEG_PATH=/usr/bin/ffmpeg
VERITAS_FFPROBE_PATH=/usr/bin/ffprobe
VERITAS_VIDEO_ENCODER=nvenc
VERITAS_NVENC_PRESET=p4
VERITAS_NVENC_CQ=23
```

If `VERITAS_DCT_FALLBACK=cpu`, the app falls back to the TypeScript CPU DCT worker if CUDA fails.

## What Runs On GPU

This worker moves the DCT, coefficient modification, inverse DCT, and per-block luminance adjustment to CuPy/CUDA.

ffmpeg still handles decode/encode. If `VERITAS_VIDEO_ENCODER=nvenc` and your ffmpeg supports `h264_nvenc`, encode also uses NVIDIA hardware.
