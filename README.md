This project is a browser-based 3D avatar viewer that animates a yoga avatar in real time using BLE IMU sensors. It consists of:

- A Vite + Three.js frontend that loads a GLB avatar and applies bone rotations from incoming sensor quaternions.
- A Python WebSocket relay server that broadcasts BLE data to browser clients.
- A Python BLE client that connects to two IMU hubs (lower/upper body), parses quaternion packets, and streams them to the relay.

**Quick Start**
1. Install frontend deps:
   - `npm install`
2. Start the WebSocket relay:
   - `python public/python/app.py`
3. Start the BLE client (in a second terminal):
   - `python public/python/ble_client.py`
4. Start the frontend dev server (in a third terminal):
   - `npx vite`
5. Open the Vite URL in your browser and click `CALIBRATE` once you are standing straight.

If you want a global `vite` command, add a script to `package.json` or run `npx vite` as shown above.

---

**System Overview**

Frontend (`index.html`, `main.js`)
- Loads `public/avatar/custom_avatar_2.glb` via `GLTFLoader`.
- Maps incoming sensor keys (e.g. `LOWER_IMU1`) to avatar bone names via `SENSOR_MAPPING`.
- Applies sensor quaternions to bones with optional per-bone tweaks in `BONE_TWEAKS`.
- Uses a WebSocket connection to `ws://localhost:8001/ws` to receive live data.
- Smoothing is controlled by the `Smoothing` slider; higher values respond faster.

Backend relay (`public/python/app.py`)
- WebSocket server on port `8001`.
- `/ws` is for browser clients.
- `/ble` is for the BLE client.
- The BLE client sends JSON as-is; the relay fan-outs to all browsers.

BLE client (`public/python/ble_client.py`)
- Connects to two devices (lower/upper body) using the hardcoded MACs:
  - `LOWER_BODY_MAC`
  - `UPPER_BODY_MAC`
- Subscribes to characteristic `QUAT_CHAR_UUID`.
- Parses packets into quaternions and emits JSON to the relay at ~33 Hz.
- Prints a simple terminal UI showing raw quaternion values and connection status.

---

**Expected Terminal Output**

`public/python/app.py`
- Prints: `WebSocket Server running on port 8001`
- Prints: `Browser connected` when the frontend connects.

`public/python/ble_client.py`
- Shows a text menu:
  - `1. Connect All Devices`
  - `2. Start Streaming (Show Data)`
  - `3. Exit`
- When streaming, it clears the terminal and prints a live table of IMU quaternions.

---

**Setup Notes**

Python dependencies
- The BLE client requires `bleak` and `websockets`.
- Install them in your environment if they are missing:
  - `python -m pip install bleak websockets`

MAC addresses
- Update `LOWER_BODY_MAC` and `UPPER_BODY_MAC` in `public/python/ble_client.py` to match your devices.

Avatar bones
- Bone names in `SENSOR_MAPPING` must match the skeleton in `public/avatar/custom_avatar_2.glb`.
- If a bone is inverted, add a tweak in `BONE_TWEAKS` or adjust mapping.

---

**Package Versions**

From `package.json`:
- `three`: `^0.182.0`
- `vite` (dev): `^7.3.1`

From the local Python venv (if you use it):
- `python`: `3.12` (venv path shows `python3.12`)
- `bleak`: `2.1.1`
- `websockets`: `16.0`

---

**Common Issues**

No data in the browser
- Make sure the relay server is running and the BLE client is streaming.
- Check that the frontend is connected to `ws://localhost:8001/ws`.

Devices not connecting
- Confirm MAC addresses and that the BLE devices are advertising.
- On Linux, you may need permissions for Bluetooth (e.g. add your user to the `bluetooth` group).

Avatar not moving
- Click `CALIBRATE` while standing straight.
- Verify `SENSOR_MAPPING` names match the GLB skeleton bone names.

---

**File Map (Key Files)**

- `index.html`: UI and import maps for Three.js.
- `main.js`: Three.js scene + avatar solver + WebSocket client.
- `public/avatar/custom_avatar_2.glb`: 3D avatar.
- `public/python/app.py`: WebSocket relay server.
- `public/python/ble_client.py`: BLE client and terminal UI.
