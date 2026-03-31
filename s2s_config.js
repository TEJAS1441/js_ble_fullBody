// ============================================================
// S2S (Speech-to-Speech) Configuration
// Edit this file to change the AI service connection settings.
// ============================================================

// --- 1. HOSTING & CONNECTION ---------------------------------
const AI_HOST = import.meta.env.VITE_AI_HOST || '192.168.1.5';
const AI_PORT = import.meta.env.VITE_AI_PORT || '8000';

const ENVIRONMENTS = {
    MAC_LOCAL: `ws://${AI_HOST}:${AI_PORT}/ws`,                // Unified S2S Pipeline
    STT_STREAM: `ws://${AI_HOST}:${AI_PORT}/api/stt`,          // Continuous STT
    TTS_REST: `http://${AI_HOST}:${AI_PORT}/api/tts`,          // Standalone TTS
    LLM_REST: `http://${AI_HOST}:${AI_PORT}/api/llm`,          // Streaming LLM
    VOICES: `http://${AI_HOST}:${AI_PORT}/api/voices`,         // Voice Discovery

    // Fallbacks
    LOCALHOST: 'ws://localhost:8000/ws',
};

// ** ACTIVE ENDPOINTS **
export const S2S_WS_URL = ENVIRONMENTS.MAC_LOCAL;
export const STT_WS_URL = ENVIRONMENTS.STT_STREAM;
export const TTS_URL = ENVIRONMENTS.TTS_REST;
export const LLM_URL = ENVIRONMENTS.LLM_REST;
export const VOICES_URL = ENVIRONMENTS.VOICES;

// Delay (ms) before attempting to reconnect after unexpected disconnect
export const S2S_RECONNECT_DELAY_MS = 3000;


// --- 2. AUDIO STREAMING CAPTURE (MIC TO SERVER) --------------
// Microphone capture sample rate (Hz) — must match server expectation.
export const S2S_CAPTURE_SAMPLE_RATE = 16000;

// ScriptProcessorNode buffer size (samples).
export const S2S_BUFFER_SIZE = 4096;

export const S2S_MIC_SETTINGS = {
    channelCount: 1,           // Mono audio
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
};


// --- 3. AUDIO PLAYBACK (SERVER TO BROWSER) -------------------
// TTS playback sample rate (Hz). Kokoro outputs at 24000 Hz.
export const S2S_PLAYBACK_SAMPLE_RATE = 24000;


// --- 4. UI & FEEDBACK SETTINGS -------------------------------
export const S2S_UI_MESSAGES = {
    CONNECTING: 'Connecting to AI...',
    CONNECTED: 'AI Listening',
    DISCONNECTED: 'AI disconnected',
    RECONNECTING: 'AI reconnecting...',
    MIC_DENIED: 'Mic denied',
    MIC_MUTED: 'Mic muted'
};

export const S2S_UI_COLORS = {
    CONNECTING: 'orange',
    CONNECTED: '#5E5CE6',      // Siri Purple
    DISCONNECTED: 'red',
    MIC_MUTED: 'grey'
};
