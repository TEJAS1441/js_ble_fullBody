import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let cameraUser, cameraTrainer, sceneUser, sceneTrainer, renderer;
let controlsUser, controlsTrainer;
let clock;
let avatar;
let mixer; // Animation mixer for rest pose and breathing
let skeletonHelper;
let gridHelper, axesHelper;

// --- Auth & Tab Logic ---
const API_URL = 'http://localhost:3001/api';

// S2S configuration is in s2s_config.js — edit that file to change IP/port/audio settings
import {
    S2S_WS_URL,
    S2S_CAPTURE_SAMPLE_RATE,
    S2S_PLAYBACK_SAMPLE_RATE,
    S2S_BUFFER_SIZE,
    S2S_RECONNECT_DELAY_MS,
    S2S_MIC_SETTINGS,
    S2S_UI_MESSAGES,
    S2S_UI_COLORS
} from './s2s_config.js';

import {
    startVoiceCommands,
    stopVoiceCommands,
    notifyPoseReset,
    setS2SSuppression
} from './stt_tts_client.js';

// Expose toggleMic for voice commands
window.toggleMic = () => {
    const micBtn = document.getElementById('btn-mic');
    if (micBtn) micBtn.click();
};

const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const sessionContainer = document.getElementById('session-container');
const loginFormContainer = document.getElementById('login-form-container');
const signupFormContainer = document.getElementById('signup-form-container');

// Tabs
const navBtns = document.querySelectorAll('.nav-btn[data-tab]');
const tabPanes = document.querySelectorAll('.tab-pane');

navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        navBtns.forEach(b => b.classList.remove('active'));
        tabPanes.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(btn.dataset.tab).classList.add('active');
    });
});

const showSignupBtn = document.getElementById('show-signup');
const showLoginBtn = document.getElementById('show-login');
const logoutBtn = document.getElementById('btn-logout');

showSignupBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginFormContainer.style.display = 'none';
    signupFormContainer.style.display = 'block';
});

showLoginBtn.addEventListener('click', (e) => {
    e.preventDefault();
    signupFormContainer.style.display = 'none';
    loginFormContainer.style.display = 'block';
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error');

    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
            localStorage.setItem('token', data.token);
            initApp();
        } else {
            errorMsg.textContent = data.error || 'Login failed';
        }
    } catch (err) {
        errorMsg.textContent = 'Server error. Please try again later.';
    }
});

document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const firstName = document.getElementById('signup-firstname').value;
    const lastName = document.getElementById('signup-lastname').value;
    const dob = document.getElementById('signup-dob').value;
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const errorMsg = document.getElementById('signup-error');

    try {
        const res = await fetch(`${API_URL}/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ firstName, lastName, dob, email, password })
        });
        const data = await res.json();
        if (res.ok) {
            const loginRes = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const loginData = await loginRes.json();
            if (loginRes.ok) {
                localStorage.setItem('token', loginData.token);
                initApp();
            }
        } else {
            errorMsg.textContent = data.error || 'Signup failed';
        }
    } catch (err) {
        errorMsg.textContent = 'Server error. Please try again later.';
    }
});

logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    appContainer.style.display = 'none';
    authContainer.style.display = 'flex';
    if (renderer) {
        renderer.domElement.remove();
        appInitialized = false;
        isSessionActive = false;
    }
});

// Profile Update
document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const firstName = document.getElementById('prof-firstname').value;
    const lastName = document.getElementById('prof-lastname').value;
    const dob = document.getElementById('prof-dob').value;
    const msg = document.getElementById('profile-msg');

    try {
        const res = await fetch(`${API_URL}/me`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ firstName, lastName, dob })
        });
        if (res.ok) {
            msg.style.display = 'block';
            setTimeout(() => msg.style.display = 'none', 3000);
            updateDashboardGreeting(firstName);
        }
    } catch (err) {
        console.error(err);
    }
});

// Session Start/End
let sessionStartTime = null;

document.getElementById('btn-start-session').addEventListener('click', () => {
    appContainer.style.display = 'none';
    sessionContainer.style.display = 'block';
    isSessionActive = true;
    sessionStartTime = Date.now();

    // Ensure renderer assumes correct size for split layout
    if (renderer) {
        renderer.setSize(window.innerWidth, window.innerHeight);
    }

    // Start local voice command listener (Whisper STT + Kokoro TTS)
    startVoiceCommands(() => solver);
});

document.getElementById('btn-exit-session').addEventListener('click', async () => {
    sessionContainer.style.display = 'none';
    appContainer.style.display = 'block';
    isSessionActive = false;

    // Stop S2S session on exit
    stopS2SSession();

    // Stop local voice command listener
    stopVoiceCommands();

    if (sessionStartTime) {
        const durationSecs = Math.floor((Date.now() - sessionStartTime) / 1000);
        sessionStartTime = null;

        // Record session to backend
        try {
            const token = localStorage.getItem('token');
            await fetch(`${API_URL}/sessions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ duration: durationSecs, articleId: 'SURYA_NAMASKAR' })
            });
            // Refresh dashboard data
            fetchUserData();
        } catch (e) { console.error('Error saving session:', e); }
    }
});

function updateDashboardGreeting(firstName) {
    const hour = new Date().getHours();
    let greeting = 'Good Evening';
    if (hour < 12) greeting = 'Good Morning';
    else if (hour < 18) greeting = 'Good Afternoon';

    document.getElementById('user-greeting').textContent = `${greeting}, ${firstName}`;
}

function renderSessionsTable(sessions) {
    const list = document.getElementById('sessions-list');
    const msg = document.getElementById('no-sessions-msg');
    const table = document.getElementById('sessions-table');

    list.innerHTML = '';
    if (!sessions || sessions.length === 0) {
        table.style.display = 'none';
        msg.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    msg.style.display = 'none';

    sessions.forEach(s => {
        const d = new Date(s.timestamp);
        const dateStr = d.toLocaleDateString();
        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const min = Math.floor((s.duration || 0) / 60);
        const sec = (s.duration || 0) % 60;
        const durStr = `${min}m ${sec}s`;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${dateStr}</td>
            <td>${timeStr}</td>
            <td>${durStr}</td>
            <td>
                <button class="btn-delete" data-id="${s.id}" title="Delete session">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                        <path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9zm0 5h2v9H9V8zm4 0h2v9h-2V8z"/>
                    </svg>
                </button>
            </td>`;

        // Per-row delete
        tr.querySelector('.btn-delete').addEventListener('click', async () => {
            const token = localStorage.getItem('token');
            try {
                const res = await fetch(`${API_URL}/sessions/${s.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    tr.style.transition = 'opacity 0.3s';
                    tr.style.opacity = '0';
                    setTimeout(() => { tr.remove(); fetchUserData(); }, 300);
                }
            } catch (e) { console.error('Delete error:', e); }
        });

        list.appendChild(tr);
    });
}

async function fetchUserData() {
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            updateDashboardGreeting(data.firstName);
            renderSessionsTable(data.recentSessions);

            // Populate profile
            document.getElementById('prof-firstname').value = data.firstName;
            document.getElementById('prof-lastname').value = data.lastName;
            document.getElementById('prof-email').value = data.email;
            if (data.dob) {
                const dobStr = new Date(data.dob).toISOString().split('T')[0];
                document.getElementById('prof-dob').value = dobStr;
            }
        } else {
            // Token might be invalid
            localStorage.removeItem('token');
            checkAuth();
        }
    } catch (err) {
        console.error("Failed to load user data");
    }
}

// Check if already logged in
function checkAuth() {
    const token = localStorage.getItem('token');
    if (token) {
        initApp();
    } else {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        sessionContainer.style.display = 'none';
    }
}

// Clear History button
document.getElementById('btn-clear-history').addEventListener('click', async () => {
    if (!confirm('Clear all session history? This cannot be undone.')) return;
    const token = localStorage.getItem('token');
    try {
        const res = await fetch(`${API_URL}/sessions`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) fetchUserData();
    } catch (e) { console.error('Clear error:', e); }
});


// =========================================================
// 1. CONFIGURATION
// =========================================================
const SENSOR_MAPPING = {
    // LOWER BODY
    LOWER_IMU1: "shinL",
    LOWER_IMU2: "footL",
    LOWER_IMU3: "shinR",
    LOWER_IMU4: "footR",
    LOWER_IMU5: "thighL",
    LOWER_IMU6: "thighR",

    // UPPER BODY
    UPPER_IMU1: "handL",
    UPPER_IMU2: "upper_armL",
    UPPER_IMU3: "handR",
    UPPER_IMU4: "upper_armR",
    UPPER_IMU5: "chest",
    UPPER_IMU6: "spine001"
};

// =========================================================
// 2. DEBUG & CORRECTIONS (FIX APPLIED)
// =========================================================

// Keep indicators ON to verify the fix
const SHOW_AXES = false;
const SHOW_LABELS = false;

// This forces a 180-degree rotation to correct the backward X-axis.
const BONE_TWEAKS = {
    "handR": { preRotateY: 0, flip: false },
    "handL": { preRotateY: 0, flip: false }
};

const DEFAULT_SMOOTHING = 0.15;

// =========================================================
// 3. HELPER: TEXT SPRITES
// =========================================================
function makeTextSprite(message, color) {
    const fontface = "Arial";
    const fontsize = 60;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128; canvas.height = 64;

    context.font = "Bold " + fontsize + "px " + fontface;
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.15, 0.075, 1);
    return sprite;
}

// =========================================================
// 4. MIDDLEWARE CLASS
// =========================================================
class AvatarSolver {
    constructor(bones) {
        this.bones = bones;
        this.sensorOffsets = {};
        this.restQuats = {};
        this.isCalibrated = false;

        Object.keys(bones).forEach(name => {
            this.restQuats[name] = bones[name].quaternion.clone();

            // Debug Axes
            if (SHOW_AXES && Object.values(SENSOR_MAPPING).includes(name)) {
                const size = 0.20;
                const axis = new THREE.AxesHelper(size);
                axis.material.depthTest = false;
                axis.renderOrder = 1;
                bones[name].add(axis);

                if (SHOW_LABELS) {
                    const labelX = makeTextSprite("X", "rgba(255, 0, 0, 1)");
                    labelX.position.set(size + 0.02, 0, 0); axis.add(labelX);

                    const labelY = makeTextSprite("Y", "rgba(0, 255, 0, 1)");
                    labelY.position.set(0, size + 0.02, 0); axis.add(labelY);

                    const labelZ = makeTextSprite("Z", "rgba(0, 100, 255, 1)");
                    labelZ.position.set(0, 0, size + 0.02); axis.add(labelZ);
                }
            }
        });
    }

    calibrate(sensorData) {
        Object.keys(SENSOR_MAPPING).forEach(imuKey => {
            const boneName = SENSOR_MAPPING[imuKey];
            const sensorQuat = sensorData[imuKey];
            const bone = this.bones[boneName];

            if (bone && sensorQuat) {
                const restQuat = this.restQuats[boneName];
                const inv = sensorQuat.clone().invert();
                this.sensorOffsets[imuKey] = inv.multiply(restQuat);

                // Snap to rest
                bone.quaternion.copy(restQuat);
            }
        });
        this.isCalibrated = true;
    }

    update(sensorData, smoothFactor = DEFAULT_SMOOTHING) {
        if (!this.isCalibrated) return;

        Object.keys(SENSOR_MAPPING).forEach(imuKey => {
            const boneName = SENSOR_MAPPING[imuKey];
            const bone = this.bones[boneName];
            const rawQ = sensorData[imuKey];
            const offset = this.sensorOffsets[imuKey];
            const tweak = BONE_TWEAKS[boneName]; // Check for tweaks

            if (bone && rawQ && offset) {
                let target = rawQ.clone().multiply(offset);

                // --- APPLY FLIP FIX ---
                if (tweak && tweak.flip) {
                    // Create a 180-degree rotation around the Y-axis (Arm Axis)
                    const flipQuat = new THREE.Quaternion().setFromAxisAngle(
                        new THREE.Vector3(0, 1, 0), // Rotate around Y
                        Math.PI // 180 degrees
                    );
                    target.multiply(flipQuat);
                }

                bone.quaternion.slerp(target, smoothFactor);
            }
        });
    }
}

// =========================================================
// 5. APPLICATION INITIALIZATION
// =========================================================

let solver = null;
let rawSensorData = {};
let appInitialized = false;
let isSessionActive = false;

// Module-level stub — replaced when initApp() sets up the S2S pipeline
let stopS2SSession = () => { };

function initApp() {
    fetchUserData(); // Load profile/dashboard data on login

    if (appInitialized) {
        authContainer.style.display = 'none';
        appContainer.style.display = 'block';
        return;
    }

    authContainer.style.display = 'none';
    appContainer.style.display = 'block';
    appInitialized = true;

    // Check App Mode (1 = Legacy Dual Scene, 2 = New Combined Scene)
    const APP_MODE = import.meta.env.VITE_APP_MODE || '1';
    console.log("Current App Mode: ", APP_MODE);

    sceneUser = new THREE.Scene();
    sceneTrainer = new THREE.Scene();

    const texLoader = new THREE.TextureLoader();

    // Home Setup for User (Left Viewport) - Mode 1 Only
    if (APP_MODE === '1') {
        texLoader.load('/environments/home_bg.png', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            sceneUser.background = texture;
            sceneUser.environment = texture;
        });

        // Studio Setup for Trainer (Right Viewport) - Mode 1 Only
        texLoader.load('/environments/studio_bg.png', (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            texture.colorSpace = THREE.SRGBColorSpace;
            sceneTrainer.background = texture;
            sceneTrainer.environment = texture;
        });

        // Shared Floor Texture - Mode 1 Only
        const floorTexture = texLoader.load('/environments/wood_floor.png');
        floorTexture.wrapS = THREE.RepeatWrapping;
        floorTexture.wrapT = THREE.RepeatWrapping;
        floorTexture.repeat.set(15, 15);
        floorTexture.colorSpace = THREE.SRGBColorSpace;

        const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.8, color: 0xcccccc });
        const floorGeo = new THREE.PlaneGeometry(50, 50);

        const floorUser = new THREE.Mesh(floorGeo, floorMat);
        floorUser.rotation.x = -Math.PI / 2;
        sceneUser.add(floorUser);

        const floorTrainer = new THREE.Mesh(floorGeo, floorMat);
        floorTrainer.rotation.x = -Math.PI / 2;
        sceneTrainer.add(floorTrainer);
    } else {
        // Mode 2 specific environment lighting
        sceneUser.background = new THREE.Color(0xF0F0F5);
    }

    // Setup Split Screen Cameras and Controls
    cameraUser = new THREE.PerspectiveCamera(70, (window.innerWidth / 2) / window.innerHeight, 0.1, 100);
    cameraUser.position.set(0, 2.8, 5.5);

    cameraTrainer = new THREE.PerspectiveCamera(70, (window.innerWidth / 2) / window.innerHeight, 0.1, 100);
    cameraTrainer.position.set(0, 2.8, 5.5);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.autoClear = false; // Important for split screen
    sessionContainer.appendChild(renderer.domElement);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.top = '0';
    renderer.domElement.style.left = '0';
    renderer.domElement.style.zIndex = '1';

    const hemiUser = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
    const dirUser = new THREE.DirectionalLight(0xffffff, 1.5);
    dirUser.position.set(0, 20, 10);
    sceneUser.add(hemiUser);
    sceneUser.add(dirUser);

    if (APP_MODE === '1') {
        const hemiTrainer = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
        const dirTrainer = new THREE.DirectionalLight(0xffffff, 1.5);
        dirTrainer.position.set(0, 20, 10);
        sceneTrainer.add(hemiTrainer);
        sceneTrainer.add(dirTrainer);
    }

    // Setup OrbitControls for both views
    controlsUser = new OrbitControls(cameraUser, renderer.domElement);
    controlsUser.target.set(0, 1, 0);
    controlsUser.enableDamping = true; // Gives a smoother "Blender" feel

    controlsTrainer = new OrbitControls(cameraTrainer, renderer.domElement);
    controlsTrainer.target.set(0, 1, 0);
    controlsTrainer.enableDamping = true;

    // LOAD AVATARS
    const loader = new GLTFLoader();

    if (APP_MODE === '1') {
        // User Avatar (Right)
        loader.load('/avatar/custom_avatar_2.glb', (gltf) => {
            const model = gltf.scene;
            sceneUser.add(model);

            const boneMap = {};
            model.traverse((o) => {
                if (o.isBone) boneMap[o.name] = o;
            });

            model.traverse((o) => {
                if (o.isMesh) {
                    o.material.transparent = true;
                    o.material.opacity = 0.7;
                }
            });

            solver = new AvatarSolver(boneMap);
        }, undefined, (error) => console.error(error));

        // Trainer Avatar (Different model)
        loader.load('/avatar/female_standing.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(2, 2, 2);
            sceneTrainer.add(model);

            model.traverse((o) => {
                if (o.isMesh) {
                    o.material.transparent = true;
                    o.material.opacity = 0.9;
                }
            });
        }, undefined, (error) => console.error(error));
    } else {
        // Mode 2: Combined Scene
        loader.load('/avatar/yoga studio new - Compresses - WITHOUT MIRROR__5.glb', (gltf) => {
            const model = gltf.scene;
            // Rotate the entire environment 90 degrees around x-axis (clockwise)
            model.rotation.y = -Math.PI / 2;
            sceneUser.add(model); // Put everything in the main scene User

            // Find the bones for the Avatar Solver
            const boneMap = {};

            model.traverse((o) => {
                if (o.isBone) {
                    // Try to avoid conflicts if both armatures have identically named bones
                    // Wait, if no prefix is known, capturing by last occurrence might map the trainer instead
                    // We log standard structure for debugging. Let's assume we map the FIRST armature we hit.
                    if (!boneMap[o.name]) {
                        boneMap[o.name] = o;
                    }
                }
            });

            solver = new AvatarSolver(boneMap);
            console.log("Combined GLB Loaded. Bones initialized.");
        }, undefined, (error) => console.error("Failed loading combined GLB:", error));

        // Adjust camera to view the whole scene
        cameraUser.position.set(0, 2.5, 16);
        controlsUser.target.set(0, 1, 0);

        // Hide split-screen specific UI elements natively
        document.querySelector('.left-label').style.display = 'none';
        document.querySelector('.right-label').style.display = 'none';

        const style = document.createElement('style');
        style.innerHTML = '#split-overlay::after { display: none !important; }';
        document.head.appendChild(style);
    }

    // WEBSOCKET
    function connectWS() {
        const ws = new WebSocket("ws://localhost:8001/ws");
        const dot = document.getElementById('status-dot');
        const statusText = document.getElementById('status-text');

        ws.onopen = () => {
            dot.style.backgroundColor = 'grey';
            statusText.innerText = "WS Open";
        };

        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.type === 'status') {
                    if (data.streaming) {
                        dot.style.backgroundColor = '#ff3278';
                        statusText.innerText = "Live Data";
                    } else if (data.connected_count > 0) {
                        dot.style.backgroundColor = 'orange';
                        statusText.innerText = `Connected (${data.connected_count})`;
                    }
                }
                if (data.type === 'data' && data.sensors) {
                    Object.keys(data.sensors).forEach(k => {
                        const s = data.sensors[k];
                        rawSensorData[k] = new THREE.Quaternion(s.x, s.y, s.z, s.w);
                    });
                }
            } catch (err) { }
        };

        ws.onclose = () => setTimeout(connectWS, 1000);
    }
    connectWS();

    document.getElementById('btn-calibrate').addEventListener('click', () => {
        // Remap Button logic (currently just recalibrates)
        if (solver) {
            solver.calibrate(rawSensorData);
        }
        // Notify STT/TTS client that pose has been reset
        notifyPoseReset();
    });

    document.getElementById('btn-calibrate-new')?.addEventListener('click', () => {
        // New Calibrate Button logic
        if (solver) {
            solver.calibrate(rawSensorData);
        }
        // Auto-start S2S voice session
        startS2SSession();
    });

    // ── S2S SPEECH-TO-SPEECH ────────────────────────────────────────────────
    // Streams raw 16kHz int16 PCM from the microphone to the s2s WebSocket
    // and plays back the 24kHz int16 PCM audio responses in real time.

    const micBtn = document.getElementById('btn-mic');
    const micIcon = document.getElementById('mic-icon');
    const micOffIcon = document.getElementById('mic-off-icon');
    const statusText = document.getElementById('status-text');
    const statusDot = document.getElementById('status-dot');

    // S2S state
    let s2sWs = null;
    let s2sAudioCtx = null;
    let s2sMicStream = null;
    let s2sScriptNode = null;
    let s2sSourceNode = null;
    let s2sMicMuted = false;
    let s2sActive = false;
    let _s2sResponseSuppressed = false;

    // Suppression mechanism to bypass LLM responses
    function setS2SResponseSuppressed(val, timeout = 3000) {
        _s2sResponseSuppressed = val;
        if (val && timeout > 0) {
            setTimeout(() => { _s2sResponseSuppressed = false; }, timeout);
        }
    }
    // Export for stt_tts_client
    window.suppressAIVoice = (timeout) => setS2SResponseSuppressed(true, timeout);

    // Singleton playback context for AI responses
    let s2sPlaybackCtx = null;
    let s2sNextPlayTime = 0;      // scheduled time for next audio chunk

    // ── UI helpers ──────────────────────────────────────────────────────────
    function setMicUI(listening) {
        if (!micBtn) return;
        if (listening) {
            micBtn.classList.add('listening');
            micOffIcon.style.display = 'none';
            micIcon.style.display = 'inline';
            micIcon.style.color = '#FFFFFF';
            micBtn.title = 'Mic active — click to mute';
        } else {
            micBtn.classList.remove('listening');
            micBtn.classList.remove('s2s-responding');
            micIcon.style.display = 'none';
            micOffIcon.style.display = 'inline';
            micOffIcon.style.color = '#8E8E93';
            micBtn.title = 'Mic off';
        }
    }

    function setRespondingUI(responding) {
        if (!micBtn) return;
        if (responding) {
            micBtn.classList.add('s2s-responding');
        } else {
            micBtn.classList.remove('s2s-responding');
        }
    }

    function showS2SStatus(msg, color) {
        if (statusText) statusText.textContent = msg;
        if (statusDot) statusDot.style.backgroundColor = color || 'grey';
    }

    // ── Int16 PCM helpers ───────────────────────────────────────────────────
    function float32ToInt16(float32Arr) {
        const int16 = new Int16Array(float32Arr.length);
        for (let i = 0; i < float32Arr.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Arr[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        return int16;
    }

    function int16ToFloat32(int16Arr) {
        const float32 = new Float32Array(int16Arr.length);
        for (let i = 0; i < int16Arr.length; i++) {
            float32[i] = int16Arr[i] / 32768.0;
        }
        return float32;
    }

    // ── Start S2S session (called from btn-calibrate-new) ──────────────────
    async function startS2SSession() {
        if (s2sActive) return; // already running

        // Stop standalone voice command listener to avoid double-processing
        stopVoiceCommands();

        console.log('[S2S] Starting session...');
        showS2SStatus('Connecting to AI...', 'orange');

        // 1. Get microphone
        try {
            s2sMicStream = await navigator.mediaDevices.getUserMedia({
                audio: S2S_MIC_SETTINGS,
                video: false
            });
        } catch (err) {
            console.error('[S2S] Mic access denied:', err);
            showS2SStatus(S2S_UI_MESSAGES.MIC_DENIED, S2S_UI_COLORS.DISCONNECTED);
            return;
        }

        // 2. Set up AudioContext at 16kHz for capture
        s2sAudioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: S2S_CAPTURE_SAMPLE_RATE });

        // Initialize playback context
        if (!s2sPlaybackCtx || s2sPlaybackCtx.state === 'closed') {
            s2sPlaybackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: S2S_PLAYBACK_SAMPLE_RATE });
        }
        s2sNextPlayTime = 0;

        s2sSourceNode = s2sAudioCtx.createMediaStreamSource(s2sMicStream);

        // ScriptProcessorNode — captures PCM and sends over WebSocket
        // bufferSize 4096 ≈ 256ms at 16kHz — good balance for latency vs overhead
        s2sScriptNode = s2sAudioCtx.createScriptProcessor(S2S_BUFFER_SIZE, 1, 1);
        s2sScriptNode.onaudioprocess = (e) => {
            if (!s2sWs || s2sWs.readyState !== WebSocket.OPEN || s2sMicMuted) return;
            const float32 = e.inputBuffer.getChannelData(0);

            // Boost volume by 2.0x to improve STT accuracy (consistent with stt_tts_client.js)
            for (let i = 0; i < float32.length; i++) {
                float32[i] *= 2.0;
            }

            const int16 = float32ToInt16(float32);
            s2sWs.send(int16.buffer);
        };

        s2sSourceNode.connect(s2sScriptNode);
        s2sScriptNode.connect(s2sAudioCtx.destination); // must connect to prevent Chrome GC

        // 3. Open WebSocket to s2s server
        s2sWs = new WebSocket(S2S_WS_URL);
        s2sWs.binaryType = 'arraybuffer';

        s2sWs.onopen = () => {
            console.log('[S2S] WebSocket connected');
            s2sActive = true;
            s2sMicMuted = false;
            setMicUI(true);
            showS2SStatus(S2S_UI_MESSAGES.CONNECTED, S2S_UI_COLORS.CONNECTED);

            // Send initial settings to the Unified S2S Pipeline
            s2sWs.send(JSON.stringify({
                type: "settings",
                voice: "af_heart",
                speed: 1.0,
                language: "en-us"
            }));
        };

        s2sWs.onmessage = async (event) => {
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'transcription') {
                        console.log(`[S2S] Received Transcription: "${msg.text}"`);
                        // Forward to intent detector
                        if (window.handleVoiceIntent) {
                            window.handleVoiceIntent(msg.text);
                        }
                    }
                } catch (e) {
                    console.error('[S2S] Error parsing JSON message:', e);
                }
                return;
            }

            // Handle Binary Audio (WAV bytes)
            try {
                if (_s2sResponseSuppressed) {
                    console.log(`[S2S] AI audio suppressed. Suppression flag: ${_s2sResponseSuppressed}`);
                    return;
                }
                const arrayBuffer = event.data;

                // Ensure playback context is initialized and resumed
                if (!s2sPlaybackCtx || s2sPlaybackCtx.state === 'closed') {
                    s2sPlaybackCtx = new (window.AudioContext || window.webkitAudioContext)({
                        sampleRate: S2S_PLAYBACK_SAMPLE_RATE
                    });
                }
                if (s2sPlaybackCtx.state === 'suspended') {
                    await s2sPlaybackCtx.resume();
                }

                s2sPlaybackCtx.decodeAudioData(arrayBuffer, (audioBuffer) => {
                    const source = s2sPlaybackCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(s2sPlaybackCtx.destination);

                    const currentTime = s2sPlaybackCtx.currentTime;
                    if (s2sNextPlayTime < currentTime) {
                        s2sNextPlayTime = currentTime + 0.05; // 50ms safety buffer
                    }

                    setRespondingUI(true);
                    source.start(s2sNextPlayTime);
                    s2sNextPlayTime += audioBuffer.duration;

                    source.onended = () => {
                        if (s2sPlaybackCtx.currentTime >= s2sNextPlayTime - 0.1) {
                            setRespondingUI(false);
                        }
                    };
                }, (err) => {
                    console.error('[S2S] Audio decode error:', err);
                });
            } catch (e) {
                console.error('[S2S] Error processing binary audio:', e);
            }
        };

        s2sWs.onerror = (err) => {
            console.error('[S2S] WebSocket error:', err);
            showS2SStatus(S2S_UI_MESSAGES.DISCONNECTED, S2S_UI_COLORS.DISCONNECTED);
        };

        s2sWs.onclose = () => {
            console.log('[S2S] WebSocket closed');
            if (s2sActive) {
                // Unexpected close — try to reconnect
                s2sActive = false;
                setMicUI(false);
                showS2SStatus(S2S_UI_MESSAGES.RECONNECTING, S2S_UI_COLORS.CONNECTING);
                setTimeout(() => {
                    if (isSessionActive) startS2SSession();
                }, S2S_RECONNECT_DELAY_MS);
            }
        };
    }

    // ── Stop S2S session (called on session exit) ──────────────────────────
    // Reassigns the module-level stub so the top-level exit handler can call it
    stopS2SSession = function () {
        if (!s2sActive && !s2sWs) return;
        console.log('[S2S] Stopping session...');
        s2sActive = false;
        s2sMicMuted = false;

        if (s2sScriptNode) { s2sScriptNode.disconnect(); s2sScriptNode = null; }
        if (s2sSourceNode) { s2sSourceNode.disconnect(); s2sSourceNode = null; }
        if (s2sMicStream) {
            s2sMicStream.getTracks().forEach(t => t.stop());
            s2sMicStream = null;
        }
        if (s2sAudioCtx) { s2sAudioCtx.close(); s2sAudioCtx = null; }
        if (s2sPlaybackCtx) { s2sPlaybackCtx.close(); s2sPlaybackCtx = null; }
        if (s2sWs && s2sWs.readyState !== WebSocket.CLOSED) {
            s2sWs.close();
        }
        s2sWs = null;
        setMicUI(false);
    }

    // ── Mic button: mute / unmute mid-session ──────────────────────────────
    if (micBtn) {
        micBtn.addEventListener('click', () => {
            if (!s2sActive) {
                // Session not started yet — start it manually
                startS2SSession();
                return;
            }
            s2sMicMuted = !s2sMicMuted;
            if (s2sMicMuted) {
                micBtn.classList.remove('listening');
                micIcon.style.display = 'none';
                micOffIcon.style.display = 'inline';
                micOffIcon.style.color = '#8E8E93';
                micBtn.title = 'Mic muted — click to unmute';
                showS2SStatus(S2S_UI_MESSAGES.MIC_MUTED, S2S_UI_COLORS.MIC_MUTED);
            } else {
                micBtn.classList.add('listening');
                micOffIcon.style.display = 'none';
                micIcon.style.display = 'inline';
                micIcon.style.color = '#FFFFFF';
                micBtn.title = 'Mic active — click to mute';
                showS2SStatus(S2S_UI_MESSAGES.CONNECTED, S2S_UI_COLORS.CONNECTED);
            }
        });
    }

    // ── POSE COMPARISON ENGINE ───────────────────────────────────────────────
    // Strategy: compare each IMU-controlled bone's current LOCAL quaternion
    // against its stored rest quaternion (T-pose = what the trainer displays).
    // When user matches T-pose → 100%. As user deviates → accuracy drops.
    // Once a second solver is attached to the trainer, swap restQuats for trainerSolver.bones quats.

    let smoothedAccuracy = 70;
    const ACCURACY_SMOOTHING = 0.08; // EMA factor

    // Previous bone positions for velocity term (keyed by bone name)
    let prevBonePos = {};
    let prevFrameTime = 0;

    function computePoseAccuracy(deltaT) {
        if (!solver || !solver.isCalibrated) return null;

        const boneNames = Object.values(SENSOR_MAPPING); // e.g. shinL, footL, …
        if (boneNames.length === 0) return null;

        let sumRotErr = 0, sumPosErr = 0, sumVelErr = 0;
        let velCount = 0;
        const q1 = new THREE.Quaternion();
        const q2 = new THREE.Quaternion();

        boneNames.forEach(name => {
            const bone = solver.bones[name];
            const restQuat = solver.restQuats[name];
            if (!bone || !restQuat) return;

            // ── MPJRE: angle between current quat and rest (trainer) quat ──
            q1.copy(bone.quaternion);
            q2.copy(restQuat);
            const dot = Math.min(1, Math.abs(q1.dot(q2)));
            const angleDeg = 2 * Math.acos(dot) * (180 / Math.PI);
            sumRotErr += angleDeg;

            // ── MPJPE: world-position distance from rest ──
            // Approximate: compare current world pos to rest-pose world pos
            // We snapshot world pos in current frame and compare to stored rest pos
            bone.updateWorldMatrix(true, false);
            const curPos = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);

            if (prevBonePos[name]) {
                sumPosErr += curPos.distanceTo(prevBonePos[name + '_rest'] || curPos);
            }

            // ── MPJVE: velocity vs zero (trainer is static) ──
            if (deltaT > 0 && prevBonePos[name]) {
                const vel = curPos.distanceTo(prevBonePos[name]) / deltaT;
                sumVelErr += vel;
                velCount++;
            }
            prevBonePos[name] = curPos;
        });

        const n = boneNames.length;
        const mpjre = sumRotErr / n;                              // degrees
        const mpjve = velCount > 0 ? sumVelErr / velCount : 0;   // units/s

        // Clamp tolerances
        const MAX_ROT = 30;  // 30° per joint = 0%
        const MAX_VEL = 2.0; // 2 units/s = 0%

        const rotScore = Math.max(0, 1 - mpjre / MAX_ROT);
        const velScore = velCount > 0 ? Math.max(0, 1 - mpjve / MAX_VEL) : 1.0;

        // Weight rotation more heavily (it's the most meaningful for yoga pose)
        const accuracy = (rotScore * 0.75 + velScore * 0.25) * 100;
        return Math.round(accuracy);
    }


    function renderSplitScreen() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        renderer.setClearColor(0x1a1a1a);
        renderer.clear();

        if (APP_MODE === '1') {
            const halfWidth = Math.floor(width / 2);

            // Left Viewport (User)
            renderer.setViewport(0, 0, halfWidth, height);
            renderer.setScissor(0, 0, halfWidth, height);
            renderer.setScissorTest(true);
            cameraUser.aspect = halfWidth / height;
            cameraUser.updateProjectionMatrix();
            renderer.render(sceneUser, cameraUser);

            // Right Viewport (Trainer)
            renderer.setViewport(halfWidth, 0, halfWidth, height);
            renderer.setScissor(halfWidth, 0, halfWidth, height);
            renderer.setScissorTest(true);
            cameraTrainer.aspect = halfWidth / height;
            cameraTrainer.updateProjectionMatrix();
            renderer.render(sceneTrainer, cameraTrainer);
        } else {
            // Mode 2: Single Full Viewport
            renderer.setViewport(0, 0, width, height);
            renderer.setScissor(0, 0, width, height);
            renderer.setScissorTest(true);
            cameraUser.aspect = width / height;
            cameraUser.updateProjectionMatrix();
            renderer.render(sceneUser, cameraUser);
        }

        // ── POSE COMPARISON → ACCURACY BAR ───────────────────────────
        const nowSecs = Date.now() / 1000;
        const deltaT = prevFrameTime > 0 ? nowSecs - prevFrameTime : 0;
        prevFrameTime = nowSecs;

        const computed = computePoseAccuracy(deltaT);
        let clampedAccuracy;
        if (computed !== null) {
            smoothedAccuracy += ACCURACY_SMOOTHING * (computed - smoothedAccuracy);
            clampedAccuracy = Math.round(Math.max(0, Math.min(100, smoothedAccuracy)));
        } else {
            // Fallback demo animation while not yet calibrated
            const raw = Math.round(70 + Math.sin(nowSecs * 2) * 20 + (Math.random() * 10 - 5));
            clampedAccuracy = Math.max(0, Math.min(100, raw));
        }

        const accuracyFill = document.getElementById('accuracy-gauge-fill');
        const accuracyTooltip = document.getElementById('accuracy-value-text');
        const accuracyStatus = document.getElementById('accuracy-status-text');
        if (accuracyFill && accuracyTooltip && accuracyStatus) {
            accuracyFill.style.width = `${clampedAccuracy}%`;
            accuracyTooltip.innerText = `${clampedAccuracy}%`;

            let fillColor, statusLabel;
            if (clampedAccuracy > 90) {
                fillColor = 'linear-gradient(to right, #00c853, #69f0ae)';
                statusLabel = '✦ Pure Union';
            } else if (clampedAccuracy > 70) {
                fillColor = 'linear-gradient(to right, #4CAF50, #81C784)';
                statusLabel = '✦ Perfect Alignment';
            } else if (clampedAccuracy > 50) {
                fillColor = 'linear-gradient(to right, #f57a15, #ffb74d)';
                statusLabel = '✦ Asana In Progress';
            } else {
                fillColor = 'linear-gradient(to right, #ff3278, #ef5350)';
                statusLabel = '✦ You Can Do Better';
            }
            accuracyFill.style.background = fillColor;
            const solidColor = clampedAccuracy > 90 ? '#00c853'
                : clampedAccuracy > 70 ? '#4CAF50'
                    : clampedAccuracy > 50 ? '#f57a15'
                        : '#ff3278';
            accuracyTooltip.style.background = solidColor;
            accuracyStatus.innerText = statusLabel;
        }
    }

    function animate() {
        requestAnimationFrame(animate);
        if (isSessionActive) {
            if (solver) {
                // Hardcoding smoothval to standard since we removed slider from session view
                solver.update(rawSensorData, DEFAULT_SMOOTHING);
            }
            controlsUser.update();
            controlsTrainer.update();
            renderSplitScreen();
        }
    }
    animate();

    window.addEventListener('resize', () => {
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// Start sequence
checkAuth();