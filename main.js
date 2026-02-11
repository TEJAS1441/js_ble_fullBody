import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
const SHOW_AXES = true; 
const SHOW_LABELS = true; 

// ⚠️ FIX: I changed 'flip' to TRUE for handR.
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
// 5. THREE.JS BOILERPLATE
// =========================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x333333); 

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 2.8, 5.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
dirLight.position.set(0, 20, 10);
scene.add(dirLight);
scene.add(new THREE.GridHelper(10, 10));

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// =========================================================
// 6. LOAD AVATAR
// =========================================================
let solver = null; 
let rawSensorData = {}; 

const loader = new GLTFLoader();
loader.load('public/avatar/custom_avatar_2.glb', (gltf) => {
    const model = gltf.scene;
    scene.add(model);
    
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
    document.getElementById('status').innerText = "System Ready.";
}, undefined, (error) => {
    console.error(error);
    document.getElementById('status').innerText = "Error loading avatar";
});

// =========================================================
// 7. WEBSOCKET
// =========================================================
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
                     dot.style.backgroundColor = '#4CAF50'; 
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
        } catch(err) {}
    };
    
    ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

document.getElementById('btn-calibrate').addEventListener('click', () => {
    if(solver) {
        solver.calibrate(rawSensorData);
        document.getElementById('status').innerText = "Calibrated.";
    }
});

const resetBtn = document.getElementById('btn-reset');
if(resetBtn) {
    resetBtn.addEventListener('click', () => {
        if(solver) solver.calibrate(rawSensorData); 
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (solver) {
        const smoothVal = parseFloat(document.getElementById('smooth-slider').value);
        solver.update(rawSensorData, smoothVal);
    }
    renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});