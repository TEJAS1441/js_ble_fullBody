import asyncio
import logging
import json
import struct
import os
import sys
from typing import Dict
from bleak import BleakClient
import websockets

# ======================
# 1. HARDWARE CONFIGURATION
# ======================
# ⚠️ REPLACE THESE WITH YOUR REAL MAC ADDRESSES
LOWER_BODY_MAC = "00:18:80:72:47:91" 
UPPER_BODY_MAC = "00:18:80:AF:58:63" 

DEVICE_ROLES = {
    LOWER_BODY_MAC: "LOWER",
    UPPER_BODY_MAC: "UPPER"
}

NU7_MACS = [LOWER_BODY_MAC, UPPER_BODY_MAC]
QUAT_CHAR_UUID = "12345678-1234-1234-1234-1234567890AC"
WS_URL = "ws://localhost:8001/ble"

# ======================
# STATE
# ======================
connected_devices: Dict[str, BleakClient] = {}
quaternion_data: Dict[str, Dict[int, bytes]] = {}
is_streaming = False
ws_connection = None 

# Configure Logging (Only critical errors to avoid messing up the UI)
logging.basicConfig(level=logging.ERROR, format="%(asctime)s - %(message)s")
logger = logging.getLogger()

QUAT_STRUCT = struct.Struct("<hhhh")

# ======================
# WEBSOCKET MANAGER
# ======================
async def websocket_manager():
    global ws_connection
    while True:
        try:
            async with websockets.connect(WS_URL) as ws:
                ws_connection = ws
                await ws.wait_closed()
        except Exception:
            pass
        ws_connection = None
        await asyncio.sleep(2)

async def send_status_routine():
    while True:
        if ws_connection:
            msg = {
                "type": "status",
                "connected_count": len(connected_devices),
                "streaming": is_streaming
            }
            try: await ws_connection.send(json.dumps(msg))
            except: pass
        await asyncio.sleep(1.0)

async def send_data_routine():
    while True:
        if is_streaming and ws_connection and quaternion_data:
            payload = {"type": "data", "sensors": {}}
            for mac, imu_map in quaternion_data.items():
                role = DEVICE_ROLES.get(mac, "UNKNOWN")
                for imu_id, data in imu_map.items():
                    qx, qy, qz, qw = QUAT_STRUCT.unpack(data)
                    unique_key = f"{role}_IMU{imu_id}"
                    payload["sensors"][unique_key] = {
                        "x": qx / 16384.0, "y": qy / 16384.0,
                        "z": qz / 16384.0, "w": qw / 16384.0
                    }
            try: await ws_connection.send(json.dumps(payload))
            except: pass 
        await asyncio.sleep(0.03)

# ======================
# BLE HANDLERS
# ======================
def on_disconnect(client: BleakClient):
    mac = client.address
    if mac in connected_devices:
        del connected_devices[mac]

def notification_handler(mac: str):
    mv_slice = memoryview 
    def handler(sender, data: bytes):
        try:
            mv = mv_slice(data)
            offset = 0
            local = {}
            ln = len(mv)
            while offset + 9 <= ln:
                imu_id = mv[offset]
                local[imu_id] = mv[offset + 1 : offset + 9].tobytes()
                offset += 9
            if local:
                quaternion_data[mac] = local
        except Exception:
            pass
    return handler

async def connect_device(mac):
    try:
        print(f"Connecting to {mac}...")
        client = BleakClient(mac, disconnected_callback=on_disconnect)
        await client.connect()
        connected_devices[mac] = client
        print(f"Connected!")
        return True
    except Exception:
        return False

async def cleanup():
    print("Disconnecting...")
    for mac, client in connected_devices.items():
        try: await client.disconnect()
        except: pass

# ======================
# TERMINAL UI (FIXED TABLE)
# ======================
async def terminal_monitor():
    """Updates the terminal screen with a static table of all sensors."""
    while True:
        if is_streaming:
            # 1. Clear Screen
            os.system("cls" if os.name == "nt" else "clear")
            
            # 2. Print Header
            print("==========================================================")
            print(f" LIVE SENSOR DATA | Devices: {len(connected_devices)} | WS: {'✅' if ws_connection else '❌'}")
            print("==========================================================")
            print(f"{'BODY PART':<10} | {'ID':<4} | {'QX':<7} | {'QY':<7} | {'QZ':<7} | {'QW':<7}")
            print("-" * 58)
            
            # 3. Collect and Sort Data Rows
            rows = []
            for mac, imu_map in quaternion_data.items():
                role = DEVICE_ROLES.get(mac, "Unknown")
                for imu_id in sorted(imu_map.keys()):
                    try:
                        # Unpack Raw Bytes
                        qx, qy, qz, qw = QUAT_STRUCT.unpack(imu_map[imu_id])
                        rows.append((role, imu_id, qx, qy, qz, qw))
                    except: pass
            
            # Sort by Role (LOWER first usually) then ID
            rows.sort(key=lambda x: (x[0], x[1]))

            # 4. Print Rows
            if not rows:
                print(" Waiting for data packets...")
            else:
                for r in rows:
                    # r = (role, id, x, y, z, w)
                    print(f"{r[0]:<10} | IMU{r[1]:<1} | {r[2]:<7} | {r[3]:<7} | {r[4]:<7} | {r[5]:<7}")

            print("-" * 58)
            print(" Press ENTER to Stop Streaming")
            
        await asyncio.sleep(0.1) # Refresh at 10Hz (fast enough for eyes)

# ======================
# MAIN LOOP
# ======================
async def main_menu():
    global is_streaming
    
    asyncio.create_task(websocket_manager())
    asyncio.create_task(send_status_routine())
    asyncio.create_task(send_data_routine())
    asyncio.create_task(terminal_monitor())

    while True:
        if not is_streaming:
            # Main Menu UI
            os.system("cls" if os.name == "nt" else "clear")
            print(f"\n--- YOGA AVATAR SYSTEM ---")
            print(f"Lower Body ({LOWER_BODY_MAC[-5:]}): {'✅' if LOWER_BODY_MAC in connected_devices else '❌'}")
            print(f"Upper Body ({UPPER_BODY_MAC[-5:]}): {'✅' if UPPER_BODY_MAC in connected_devices else '❌'}")
            print("-" * 30)
            print("1. Connect All Devices")
            print("2. Start Streaming (Show Data)")
            print("3. Exit")
            
            choice = await asyncio.to_thread(input, "\nChoice: ")

            if choice == "1":
                for mac in NU7_MACS:
                    if mac not in connected_devices:
                        await connect_device(mac)
                print("Done. Press Enter.")
                await asyncio.to_thread(input)
            
            elif choice == "2":
                if not connected_devices:
                    print("❌ Connect devices first!")
                    await asyncio.sleep(1)
                    continue
                
                # Start Notify
                for mac, client in connected_devices.items():
                    await client.start_notify(QUAT_CHAR_UUID, notification_handler(mac))
                
                is_streaming = True
                await asyncio.to_thread(input) # Wait for Enter
                
                # Stop Notify
                is_streaming = False
                for mac, client in connected_devices.items():
                    try: await client.stop_notify(QUAT_CHAR_UUID)
                    except: pass

            elif choice == "3":
                await cleanup()
                sys.exit(0)
        else:
             await asyncio.sleep(0.5)

if __name__ == "__main__":
    try:
        asyncio.run(main_menu())
    except KeyboardInterrupt:
        asyncio.run(cleanup())