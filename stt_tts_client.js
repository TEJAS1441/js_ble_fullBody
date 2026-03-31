/**
 * stt_tts_client.js
 * ─────────────────────────────────────────────────────────────
 * Frontend voice command module for Nu7 Yoga Avatar.
 * Connects to the Python STT/TTS server at ws://localhost:8765.
 *
 * Exports:
 *   startVoiceCommands(getSolverFn)  – begin listening
 *   stopVoiceCommands()              – clean up
 *   notifyPoseReset()                – call when reset pose completes
 *
 * Voice commands handled:
 *   "reset pose"       → clicks #btn-calibrate
 *   "end session"      → clicks #btn-exit-session
 *   "start session"    → checks if pose was reset; if not, TTS warns; if yes, clicks #btn-calibrate-new
 */

import {
    STT_WS_URL,
    TTS_URL,
    S2S_CAPTURE_SAMPLE_RATE as SAMPLE_RATE,
    S2S_BUFFER_SIZE as BUFFER_SIZE,
    S2S_RECONNECT_DELAY_MS as RECONNECT_DELAY
} from './s2s_config.js';

// Tracks whether the user has completed a Reset Pose since entering the session
let _poseResetDone = false;
// Function to get current solver (passed in at start)
let _getSolver = null;

let _ws = null;
let _audioCtx = null;
let _micStream = null;
let _scriptNode = null;
let _sourceNode = null;
let _active = false;
let _muted = false;

// --- Intent Classification Settings ---
const INTENT_PATTERNS = {
    reset_pose: [
        /\breset\b.*\bpose\b/i,
        /\breset\b.*\bmy\b/i,
        /\bcalibrate\b/i,
        /\bgo\s+to\s+t.?pose\b/i,
        /\bt.?pose\b/i,
        /\breset\s+ose\b/i,
        /\bpress\s+it\s+pose\b/i
    ],
    end_session: [
        /\bend\s+session\b/i,
        /\bstop\s+session\b/i,
        /\bfinish\s+session\b/i,
        /\bquit\s+session\b/i,
        /\bexit\s+session\b/i,
        /\bend\s+the\s+session\b/i,
        /\bstop\s+the\s+session\b/i
    ],
    start_session: [
        /\bstart\s+(the\s+)?session\b/i,
        /\bbegin\s+(the\s+)?session\b/i,
        /\bcalibrate\s+and\s+start\b/i,
        /\blet'?s\s+start\b/i,
        /\blet'?s\s+begin\b/i,
        /\bstart\s+yoga\b/i
    ],
    mute_mic: [
        /\bmute\b.*\bmic\b/i,
        /\bmute\b.*\bmicrophone\b/i,
        /\bturn\s+off\s+mic\b/i,
        /\bstop\s+listening\b/i,
        /\bdisconnect\s+mic\b/i,
        /\bunmute\b.*\bmic\b/i,
        /\bturn\s+on\s+mic\b/i
    ]
};

const CANONICAL_COMMANDS = {
    reset_pose: ["reset pose", "calibrate", "t pose"],
    end_session: ["end session", "stop session", "exit session"],
    start_session: ["calibrate and start the session", "begin session"],
    mute_mic: ["mute mic", "unmute mic", "mute microphone"]
};

const FUZZY_THRESHOLD = 0.70; // Slightly lower for better non-exact matching

// TTS response texts
const RESPONSES = {
    reset_pose: "Resetting your pose. Please stand in the T-pose position.",
    end_session: "Ending your session. Great work today!",
    start_session_ok: "Starting your session. Let's begin!",
    start_session_blocked: "Please first reset your pose by coming to the form shown by the trainer avatar on the right. Once you match the position, you can start the session.",
    mute_mic: "Toggling microphone."
};

let _suppressNextS2S = false;

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Hook for main.js to manually control suppression
 */
export function setS2SSuppression(val) {
    _suppressNextS2S = val;
}

/**
 * Hook for main.js to handle intents from the S2S stream
 */
export function triggerIntent(intent) {
    if (!intent) return;
    console.log(`[STT] Manually triggering intent: ${intent}`);

    // Suppress AI response since we are taking a local action
    if (window.suppressAIVoice) {
        window.suppressAIVoice(3000);
    }

    // Execute actions
    if (intent === 'reset_pose') {
        _updatePanel('status', '✅ Resetting pose...');
        document.getElementById('btn-calibrate')?.click();
        _poseResetDone = true;
        _synthesizeAndPlay(RESPONSES.reset_pose);
        setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);
    } else if (intent === 'end_session') {
        _updatePanel('status', '👋 Ending session...');
        _synthesizeAndPlay(RESPONSES.end_session, () => {
            document.getElementById('btn-exit-session')?.click();
        });
    } else if (intent === 'start_session') {
        _updatePanel('status', '🚀 Starting session!');
        document.getElementById('btn-calibrate-new')?.click();
        _synthesizeAndPlay(RESPONSES.start_session_ok);
        setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);
    } else if (intent === 'mute_mic') {
        _updatePanel('status', '🔇 Toggling mic...');
        if (window.toggleMic) window.toggleMic();
        _synthesizeAndPlay(RESPONSES.mute_mic);
        setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);
    }
}

window.stopVoiceCommands = stopVoiceCommands;
window.handleVoiceIntent = _handleTranscript;
window.triggerIntent = triggerIntent;

/**
 * Call this when the session screen opens.
 * @param {Function} getSolverFn - () => solver object (or null). Used to check calibration state.
 */
export async function startVoiceCommands(getSolverFn) {
    if (_active) return;
    _getSolver = getSolverFn;
    _poseResetDone = false;
    _active = true;

    console.log('[STT] Starting voice command listener...');
    _updatePanel('status', '🎤 Initializing voice commands...');

    await _connectMic();
    _connectWS();
}

/**
 * Sends a settings message to the STT server to configure language.
 */
function _sendSTTSettings() {
    if (_ws && _ws.readyState === WebSocket.OPEN) {
        console.log('[STT] Sending settings: language=en-us');
        _ws.send(JSON.stringify({
            type: "settings",
            language: "en-us"
        }));
    }
}

/**
 * Call this when the session screen closes.
 */
export function stopVoiceCommands() {
    if (!_active) return;
    console.log('[STT] Stopping voice command listener.');
    _active = false;
    _cleanup();
    _updatePanel('status', '');
    _updatePanel('transcript', '');
}

/**
 * Call this when the user successfully completes a Reset Pose (btn-calibrate click).
 */
export function notifyPoseReset() {
    _poseResetDone = true;
    console.log('[STT] Pose reset acknowledged.');
}

// ── Mic Setup ──────────────────────────────────────────────────────────────

async function _connectMic() {
    try {
        _micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                sampleRate: SAMPLE_RATE,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
            video: false
        });
    } catch (err) {
        console.error('[STT] Mic access denied:', err);
        _updatePanel('status', '⚠️ Mic access denied');
        return;
    }

    _audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    _sourceNode = _audioCtx.createMediaStreamSource(_micStream);
    _scriptNode = _audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);

    _scriptNode.onaudioprocess = (e) => {
        if (!_ws || _ws.readyState !== WebSocket.OPEN || _muted) return;
        const float32 = e.inputBuffer.getChannelData(0);

        // --- VOLUME NORMALIZATION / GAIN ---
        // Boost volume by 2.0x to improve Whisper accuracy as per guide
        for (let i = 0; i < float32.length; i++) {
            float32[i] *= 2.0;
        }

        const int16 = _float32ToInt16(float32);
        _ws.send(int16.buffer);
    };

    _sourceNode.connect(_scriptNode);
    _scriptNode.connect(_audioCtx.destination); // required to prevent GC
    console.log('[STT] Microphone connected at 16kHz');
}

// ── WebSocket to Python Server ─────────────────────────────────────────────

function _connectWS() {
    if (!_active) return;

    _ws = new WebSocket(STT_WS_URL);

    _ws.onopen = () => {
        console.log('[STT] Connected to Unified STT server');
        _updatePanel('status', '🎤 Listening for commands...');
        _setIndicator('listening');

        // Send initial settings for language support
        _sendSTTSettings();
    };

    _ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'transcription' && msg.text) {
                _handleTranscript(msg.text);
            }
        } catch (e) {
            console.error('[STT] Bad response from server:', e);
        }
    };

    _ws.onerror = (err) => {
        console.warn('[STT] WebSocket error (server may not be running):', err);
        _updatePanel('status', '⚠️ Voice server offline');
        _setIndicator('offline');
    };

    _ws.onclose = () => {
        console.log('[STT] WebSocket closed');
        _setIndicator('offline');
        if (_active) {
            _updatePanel('status', '🔄 Reconnecting voice...');
            setTimeout(() => _connectWS(), RECONNECT_DELAY);
        }
    };
}

// ── Intent Dispatch ────────────────────────────────────────────────────────

// ── Intent Classification (Client-Side) ───────────────────────────────────

function _handleTranscript(text) {
    console.log(`[STT] Heard: "${text}"`);

    // Show what was heard
    _updatePanel('transcript', `"${text}"`);
    setTimeout(() => _updatePanel('transcript', ''), 4000);

    const intent = _classifyIntent(text);
    console.log(`[STT] Classified intent: ${intent}`);

    // If no intent matched, let it flow to other listeners (like S2S/LLM)
    if (intent === 'none') {
        _suppressNextS2S = false;
        return;
    }

    console.log(`[STT] Intent matched: ${intent}`);

    // SUPPRESS S2S LLM Response for this turn
    if (window.suppressAIVoice) {
        window.suppressAIVoice(3000);
    }

    if (intent === 'reset_pose') {
        _updatePanel('status', '✅ Resetting pose...');
        document.getElementById('btn-calibrate')?.click();
        _poseResetDone = true;
        _synthesizeAndPlay(RESPONSES.reset_pose);
        setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);

    } else if (intent === 'end_session') {
        _updatePanel('status', '👋 Ending session...');
        _synthesizeAndPlay(RESPONSES.end_session, () => {
            document.getElementById('btn-exit-session')?.click();
        });

    } else if (intent === 'start_session') {
        const solver = _getSolver ? _getSolver() : null;
        const calibrated = _poseResetDone || (solver && solver.isCalibrated);

        if (!calibrated) {
            console.log('[STT] Start session blocked — pose not reset');
            _updatePanel('status', '⚠️ Reset your pose first!');
            _synthesizeAndPlay(RESPONSES.start_session_blocked);
            setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 4000);
        } else {
            _updatePanel('status', '🚀 Starting session!');
            document.getElementById('btn-calibrate-new')?.click();
            _synthesizeAndPlay(RESPONSES.start_session_ok);
            setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);
        }
    } else if (intent === 'mute_mic') {
        _updatePanel('status', '🔇 Toggling mic...');
        // Toggle the global mic button
        if (window.toggleMic) {
            window.toggleMic();
        }
        _synthesizeAndPlay(RESPONSES.mute_mic);
        setTimeout(() => _updatePanel('status', '🎤 Listening for commands...'), 2000);
    }
}

function _classifyIntent(text) {
    const cleanText = text.toLowerCase().trim();
    if (!cleanText) return 'none';

    // 1. Regex Match
    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
        for (const pat of patterns) {
            if (pat.test(cleanText)) {
                console.log(`[STT] Regex match found: ${intent} (pattern: ${pat})`);
                return intent;
            }
        }
    }

    // 2. Fuzzy Match (Levenshtein)
    let bestIntent = 'none';
    let maxSimilarity = 0;

    for (const [intent, canonicals] of Object.entries(CANONICAL_COMMANDS)) {
        for (const can of canonicals) {
            const sim = _getSimilarity(cleanText, can);
            if (sim > maxSimilarity) {
                maxSimilarity = sim;
                bestIntent = intent;
            }
        }
    }

    console.log(`[STT] Best fuzzy match: ${bestIntent} (similarity: ${maxSimilarity.toFixed(2)}, threshold: ${FUZZY_THRESHOLD})`);
    return maxSimilarity >= FUZZY_THRESHOLD ? bestIntent : 'none';
}

/**
 * Basic Levenshtein distance for fuzzy matching. Returns similarity [0, 1].
 */
function _getSimilarity(s1, s2) {
    let longer = s1;
    let shorter = s2;
    if (s1.length < s2.length) {
        longer = s2;
        shorter = s1;
    }
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;

    const editDistance = (s1, s2) => {
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    }
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    };

    return (longerLength - editDistance(longer, shorter)) / longerLength;
}

// ── TTS Synthesis (REST API) ───────────────────────────────────────────────

/**
 * Call the POST /api/tts endpoint and play resulting binary audio.
 */
async function _synthesizeAndPlay(text, onDone) {
    try {
        console.log(`[TTS] Requesting synthesis for: "${text}"`);

        let response = await fetch(TTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'audio/wav'
            },
            body: JSON.stringify({
                text: text,
                voice: 'af_heart',
                speed: 1.0,
                language: 'en-us'
            })
        });

        // ── FALLBACK: If POST is 405 (Method Not Allowed), try GET ────────────────
        if (response.status === 405 || response.status === 404) {
            console.warn(`[TTS] POST failed (${response.status}), trying GET fallback...`);
            const params = new URLSearchParams({
                text: text,
                voice: 'af_heart',
                speed: '1.0',
                language: 'en-us'
            });
            response = await fetch(`${TTS_URL}?${params.toString()}`, {
                method: 'GET',
                headers: { 'Accept': 'audio/wav' }
            });
        }

        if (!response.ok) throw new Error(`TTS API error: ${response.status}`);

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        _playAudioBuffer(arrayBuffer, onDone);
    } catch (err) {
        console.error('[TTS] Synthesis failed:', err);
        // Fallback to browser Speech Synthesis
        if ('speechSynthesis' in window) {
            const utter = new SpeechSynthesisUtterance(text);
            utter.lang = 'en-US'; // American English
            utter.onend = () => onDone?.();
            speechSynthesis.speak(utter);
        } else {
            onDone?.();
        }
    }
}

/**
 * Decodes raw audio arrayBuffer and plays it.
 */
function _playAudioBuffer(arrayBuffer, onDone) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    ctx.decodeAudioData(arrayBuffer, (audioBuffer) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.start(0);
        source.onended = () => {
            ctx.close();
            onDone?.();
        };
    }, (err) => {
        console.error('[TTS] Audio decode error:', err);
        onDone?.();
    });
}

// ── Audio Conversion ───────────────────────────────────────────────────────

function _float32ToInt16(float32Arr) {
    const int16 = new Int16Array(float32Arr.length);
    for (let i = 0; i < float32Arr.length; i++) {
        const s = Math.max(-1, Math.min(1, float32Arr[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return int16;
}

// ── UI Panel Helpers ───────────────────────────────────────────────────────

function _updatePanel(field, text) {
    const el = document.getElementById(
        field === 'status' ? 'voice-cmd-status' : 'voice-cmd-transcript'
    );
    if (el) el.textContent = text;
}

function _setIndicator(state) {
    const panel = document.getElementById('voice-cmd-panel');
    if (!panel) return;
    panel.classList.remove('vc-listening', 'vc-offline');
    if (state === 'listening') panel.classList.add('vc-listening');
    if (state === 'offline') panel.classList.add('vc-offline');
}

// ── Cleanup ────────────────────────────────────────────────────────────────

function _cleanup() {
    if (_scriptNode) { _scriptNode.disconnect(); _scriptNode = null; }
    if (_sourceNode) { _sourceNode.disconnect(); _sourceNode = null; }
    if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null; }
    if (_audioCtx) { _audioCtx.close(); _audioCtx = null; }
    if (_ws && _ws.readyState !== WebSocket.CLOSED) { _ws.close(); }
    _ws = null;
}
