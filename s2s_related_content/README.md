# Speech-to-Speech (S2S) Realtime AI Pipeline

A low-latency, streaming, WebSocket-based Speech-to-Speech conversational AI pipeline. You speak into the browser, the system transcribes your speech, generates a response with an LLM, and streams synthesised audio back — in real time.

---

## Architecture Overview

```
Browser Microphone (16 kHz PCM)
        │
        ▼
  WebSocket (/ws/stream)
        │
        ▼
┌──────────────────────────────────────┐
│           server.py                  │
│                                      │
│  ┌─────────┐    ┌─────────────────┐  │
│  │   VAD   │───►│  Audio Buffer   │  │
│  │(Silero) │    └────────┬────────┘  │
│  └─────────┘             │           │
│                          ▼           │
│                   ┌─────────────┐    │
│                   │     STT     │    │
│                   │  (Whisper)  │    │
│                   └──────┬──────┘    │
│                          │           │
│                          ▼           │
│                   ┌─────────────┐    │
│                   │     LLM     │    │
│                   │  (Mistral)  │    │
│                   └──────┬──────┘    │
│                          │ streaming │
│                          ▼           │
│                   ┌─────────────┐    │
│                   │     TTS     │    │
│                   │  (Kokoro)   │    │
│                   └──────┬──────┘    │
└──────────────────────────┼──────────┘
                           │ 24 kHz int16 PCM
                           ▼
                  WebSocket → Browser Speaker
```

### Components

| Component | Mac Backend | Cloud Backend | Role |
|---|---|---|---|
| **VAD** | Silero VAD (ONNX) | Silero VAD (ONNX) | Detects speech start/end in real time |
| **STT** | `mlx_whisper` (Whisper large-v3-turbo) | `faster-whisper` (CUDA) | Transcribes speech to text |
| **LLM** | `mlx_lm` (Mistral-7B-Instruct 4-bit) | `transformers` (Mistral-7B full) | Generates conversational responses |
| **TTS** | Kokoro-82M | Kokoro-82M | Synthesises natural-sounding speech |

---

## Project Structure

```
version 0/
├── config.py           ← ✅ SINGLE source of truth for ALL configuration
├── server.py           ← FastAPI WebSocket server + pipeline orchestration
├── .env                ← API keys (HF_TOKEN, etc.)
├── requirements.txt    ← Python dependencies
│
├── VAD/
│   └── vad.py          ← Silero VAD wrapper
│
├── STT/
│   └── stt.py          ← MLXWhisperSTT (mac) + FasterWhisperSTT (cloud)
│
├── LLM/
│   └── llm.py          ← MLXLMEngine (mac) + TransformersLMEngine (cloud)
│
├── TTS/
│   └── tts.py          ← KokoroTTSStreamer
│
└── client/
    └── index.html      ← Browser WebSocket client (served at /client/index.html)
```

---

## Configuration (`config.py`)

> **This is the only file you need to edit.** No changes are required in any model file.

### Switch Backend (Mac ↔ Cloud)

```python
# config.py
BACKEND = "mac"     # Apple Silicon (M-series, uses MLX)
BACKEND = "cloud"   # NVIDIA GPU (A100 etc., uses CUDA / HuggingFace)
```

### Key Settings

| Section | Key | Default | Description |
|---|---|---|---|
| `BACKEND` | — | `"mac"` | Deployment target |
| `SERVER_HOST` | — | `"0.0.0.0"` | Bind address |
| `SERVER_PORT` | — | `8000` | Port |
| `VAD_CONFIG` | `window_size` | `512` | VAD chunk size in samples |
| `STT_CONFIG["mac"]` | `model_path` | `mlx-community/whisper-large-v3-turbo` | Whisper model |
| `STT_CONFIG["cloud"]` | `model_path` | `large-v3-turbo` | faster-whisper model size |
| `LLM_CONFIG["mac"]` | `model_path` | `mlx-community/Mistral-7B-Instruct-v0.3-4bit` | MLX LLM model |
| `LLM_CONFIG["cloud"]` | `model_path` | `mistralai/Mistral-7B-Instruct-v0.3` | HF LLM model |
| `LLM_CONFIG[*]` | `max_tokens` | `150` | Max tokens for LLM response |
| `LLM_CONFIG[*]` | `system_prompt` | _(see config)_ | System instructions for LLM |
| `TTS_CONFIG` | `voice` | `af_heart` | Kokoro voice preset |
| `TTS_CONFIG` | `speed` | `1.0` | TTS playback speed |
| `TTS_CONFIG` | `sample_rate` | `24000` | Output audio sample rate (Hz) |

---

## Prerequisites

- **Mac backend**: macOS 14+, Apple Silicon (M1/M2/M3/M4), Python 3.10+
- **Cloud backend**: Linux, NVIDIA GPU (A100 recommended), CUDA 12+, Python 3.10+
- A [HuggingFace](https://huggingface.co) account and access token (for gated models)

---

## Setup

### 1. Clone & enter the project

```bash
cd "version 0"
```

### 2. Create and activate a virtual environment

```bash
python3 -m venv .venv
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Set your HuggingFace token

Edit `.env`:
```
HF_TOKEN=hf_your_token_here
```

### 5. (Optional) Change backend or models

Edit `config.py` and set `BACKEND = "mac"` or `"cloud"`, then adjust model paths as needed.

---

## Running the Server

```bash
python server.py
```

On first boot, model weights are downloaded and cached automatically. Subsequent starts are fast.

Expected output:
```
Initializing models... [BACKEND=mac]
[VAD] Loading Silero VAD...
[STT] Using mlx_whisper model: mlx-community/whisper-large-v3-turbo
[LLM] Loading model via mlx_lm: mlx-community/Mistral-7B-Instruct-v0.3-4bit...
[TTS] Initializing Kokoro TTS Pipeline...
All models loaded!
INFO: Uvicorn running on http://0.0.0.0:8000
```

---

## Using the Client

1. Open your browser and navigate to:
   **[http://localhost:8000/client/index.html](http://localhost:8000/client/index.html)**

2. Click **"Start Conversation"** and allow microphone access.

3. Start speaking — the pipeline will detect your speech, transcribe it, generate a response, and speak it back.

4. Click **"Stop"** to end the session.

> **Note:** Use `localhost` (not `127.0.0.1`) to ensure browser microphone permissions work correctly in secure contexts.

---

## Audio Format Reference

| Direction | Sample Rate | Format | Who produces it |
|---|---|---|---|
| Browser → Server | 16,000 Hz | int16 PCM | Browser `ScriptProcessorNode` |
| Server → Browser | 24,000 Hz | int16 PCM | Kokoro TTS |

---

## Stopping the Server

Press `Ctrl+C` in the terminal. All models and active inference are stopped immediately.

---

## Adding a New Model

1. Open `config.py` and add a new key block under the appropriate section (e.g. `STT_CONFIG["my_custom"]`).
2. Open the corresponding model file (`STT/stt.py`, etc.) and add a new class implementing the same interface (`transcribe()`, `generate_streaming()`, `generate_audio()`).
3. Update the `get_*()` factory function to handle your new backend key.
4. Set `BACKEND = "my_custom"` in `config.py`.

---

## Troubleshooting

| Error | Cause | Fix |
|---|---|---|
| `Insufficient Memory (kIOGPUCommandBufferCallbackErrorOutOfMemory)` | LLM model too large for GPU | Use 4-bit model in `LLM_CONFIG["mac"]["model_path"]` |
| `generate_step() got unexpected keyword argument 'temp'` | Old mlx-lm API | Remove `temp` arg; use `temperature` if needed |
| `'Tensor' object has no attribute 'astype'` | Kokoro returns PyTorch tensor | Already fixed — TTS converts to numpy before sending |
| `Conversation roles must alternate user/assistant` | Mistral chat template rejects `system` role | Already fixed — system prompt is prepended to user message |
| `404 Not Found` on `/` | No root route defined | Access the app at `/client/index.html` |
