# Veritas CUDA DCT Worker

Optional local worker for GPU DCT watermark embedding and extraction.

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
VERITAS_CUDA_DETECTION_FRAMES=48
VERITAS_DCT_CONFIDENCE_THRESHOLD=0.35
```

If `VERITAS_DCT_FALLBACK=cpu`, the app falls back to the TypeScript CPU DCT worker if CUDA fails.

## What Runs On GPU

During registration, this worker moves the DCT, coefficient modification, inverse DCT, and per-block luminance adjustment to CuPy/CUDA.

During verification, this worker moves DCT vote extraction to CuPy/CUDA. The app uses this to sample more frames during DCT fallback verification while keeping the CPU implementation as the default path for collaborators. CUDA verification can also try nearby extraction widths and small block offsets to improve resilience to resize/re-encode artifacts.

ffmpeg still handles decode/encode. If `VERITAS_VIDEO_ENCODER=nvenc` and your ffmpeg supports `h264_nvenc`, encode also uses NVIDIA hardware.
