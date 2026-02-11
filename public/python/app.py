import asyncio
import logging
from websockets.asyncio.server import serve

logging.basicConfig(level=logging.INFO)
browser_clients = set()

async def ws_handler(websocket):
    path = websocket.request.path
    
    if path == "/ws":
        browser_clients.add(websocket)
        print("Browser connected")
        try:
            async for _ in websocket: pass
        finally:
            browser_clients.discard(websocket)

    elif path == "/ble":
        # Just forward whatever JSON comes from Python directly to Browsers
        try:
            async for msg in websocket:
                if browser_clients:
                    # msg is already JSON string from ble_client.py
                    tasks = [asyncio.create_task(client.send(msg)) for client in browser_clients]
        finally:
            pass

async def main():
    print("WebSocket Server running on port 8001")
    async with serve(ws_handler, "0.0.0.0", 8001):
        await asyncio.Future()

asyncio.run(main())