# AI Services Integration Guide (Mac Mini MLX)

This document provides technical details for integrating with the Speech-to-Speech (S2S) AIaaS server. The server is optimized for 10-core GPU Mac Mini performance using MLX models.

## 🚀 Hosting the Server
To avoid `ModuleNotFoundError` and ensure high performance, always run the server from the project root using `uvicorn`:

```bash
# Recommended command for production-like hosting
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```
> [!IMPORTANT]
> Do not run `python3 app/main.py` directly, as Python will not resolve the `app` package correctly unless the `PYTHONPATH` is explicitly set. Using `uvicorn` as shown above handles this automatically.

---

## 🛠 Available APIs

### 1. Unified S2S Pipeline (WebSocket)
**Endpoint**: `ws://[HOST]:8000/ws`  
**Purpose**: Continuous end-to-end speech-to-speech conversation.

#### Usage:
- **Send Settings** (JSON): Configure voice/speed at the start of the session.
  ```json
  {"type": "settings", "voice": "af_heart", "speed": 1.0, "language": "en-us"}
  ```
- **Send Audio** (Binary): Stream PCM16 audio chunks (4000 samples / 250ms per chunk recommended).
- **Receive Transcription** (JSON): Live transcription of your speech.
  ```json
  {"type": "transcription", "text": "Hello world"}
  ```
- **Receive Audio Output** (Binary): WAV bytes of the AI's synthesized response.

---

### 2. Standalone Real-time TTS (REST)
**Endpoint**: `POST http://[HOST]:8000/api/tts`  
**Purpose**: High-speed, high-quality text-to-speech.

**Request Body**:
```json
{
  "text": "Welcome to your yoga session.",
  "voice": "af_heart",
  "speed": 1.1
}
```
**Response**: Binary `audio/wav` status (WAV header included).

---

### 3. Continuous STT (WebSocket)
**Endpoint**: `ws://[HOST]:8000/api/stt`  
**Purpose**: Independent streaming audio-to-text.

**Protocol**:
1. Connect via WebSocket.
2. Stream binary PCM16 audio continuously.
3. Server returns JSON transcriptions periodically.
   ```json
   {"type": "transcription", "text": "I am speaking now."}
   ```

---

### 4. Streaming LLM (SSE)
**Endpoint**: `POST http://[HOST]:8000/api/llm`  
**Purpose**: Low-latency, "typewriter" effect text generation.

**Request Body**:
```json
{"prompt": "Tell me a short story about meditation."}
```
**Response**: `text/event-stream` (SSE).
```text
data: {"text": "Once "}
data: {"text": "upon "}
data: {"text": "a "}
data: {"text": "time..."}
```

---

### 5. Voice Discovery (Discovery)
**Endpoint**: `GET http://[HOST]:8000/api/voices`  
**Purpose**: List available voices for your UI selection menu.

**Response**:
```json
{
  "voices": ["af_heart", "af_bella", "am_michael", "bf_alice", ...]
}
```

---

## 💡 Best Practices for Accurate Integration

1. **Audio Formatting**: 
   - Ensure the client sends **16kHz, mono, PCM16** audio. 
   - Normalizing volume (Gain) on the client side significantly improves Whisper's transcription accuracy.
2. **VAD Alignment**: 
   - Send audio in consistent chunks (e.g., 4000 samples). This aligns with the server's VAD window for reliable speech-end detection.
3. **Buffering**: 
   - While the server sends audio chunks, the client should use a non-blocking playback queue to avoid clicks or gaps between sentences.
4. **Latency Strategy**: 
   - Use the **Unified S2S Pipeline** for low-latency conversations. It parallelizes LLM generation and TTS synthesis to minimize silence.

---

## Technical Specs Summary
| Service | Model | Acceleration | Est. Latency |
| :--- | :--- | :--- | :--- |
| **STT** | Whisper-Turbo (MLX) | MLX / Metal | < 250ms |
| **LLM** | Llama 3.2 1B | Ollama / MLX | < 50ms (first token) |
| **TTS** | Kokoro 82M | MLX / Metal | < 150ms |
| **VAD** | Silero VAD | ONNX / CPU | < 10ms |
