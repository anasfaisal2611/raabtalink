"""
Live WebSocket transcription test.

Records from your microphone, streams PCM audio to the /sos/ws/listen
endpoint, and prints transcripts + server responses in real time.

Usage:
    venv\\Scripts\\python.exe test_ws_transcribe.py
"""

import asyncio
import json
import queue
import sys

import numpy as np
import sounddevice as sd
import websockets

# ---- config ----
WS_URL = "ws://localhost:8000/sos/ws/listen?sender_id=test-device&latitude=67.99&longitude=78.99&people_count=14"
SAMPLE_RATE = 16000       # 16 kHz (whisper requirement)
WINDOW_SECONDS = 8        # send last 8s of audio each time
SEND_EVERY_SECONDS = 4    # send every 4 seconds
MAX_BUFFER = SAMPLE_RATE * 20  # cap buffer at 20s
RECORD_SECONDS = 30        # how long to record

audio_queue: queue.Queue = queue.Queue()
stop_flag = asyncio.Event()


def audio_callback(indata, frames, time_info, status):
    """sounddevice callback — runs on a separate audio thread."""
    if status:
        print(f"  [audio] {status}", file=sys.stderr)
    pcm16 = (indata[:, 0] * 32767).astype(np.int16)
    audio_queue.put(pcm16)


async def send_audio(ws: websockets.WebSocketClientProtocol):
    """Sliding window: accumulate audio and send the last 8s every 4s."""
    buffer = np.array([], dtype=np.int16)
    window_samples = SAMPLE_RATE * WINDOW_SECONDS
    send_samples = SAMPLE_RATE * SEND_EVERY_SECONDS
    max_samples = SAMPLE_RATE * 20
    samples_since_send = 0
    sent = 0

    while not stop_flag.is_set():
        try:
            chunk = audio_queue.get(timeout=0.5)
        except queue.Empty:
            continue

        buffer = np.concatenate([buffer, chunk])
        samples_since_send += len(chunk)

        # Trim buffer
        if len(buffer) > max_samples:
            buffer = buffer[-max_samples:]

        # Send sliding window
        if samples_since_send >= send_samples and len(buffer) >= SAMPLE_RATE * 2:
            samples_since_send = 0
            window = buffer[-window_samples:] if len(buffer) > window_samples else buffer
            data = window.tobytes()
            await ws.send(data)
            sent += 1
            print(f"  >>> chunk {sent} ({len(data):,} bytes, window={len(window)/SAMPLE_RATE:.1f}s)")

    # Send final window
    if len(buffer) >= SAMPLE_RATE:
        window = buffer[-window_samples:] if len(buffer) > window_samples else buffer
        await ws.send(window.tobytes())
        sent += 1
        print(f"  >>> chunk {sent} ({len(window.tobytes()):,} bytes) [final]")


async def listen(ws: websockets.WebSocketClientProtocol):
    """Print every message the server sends back."""
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                print(f"  <<< (raw) {raw}")
                continue

            if "transcript" in msg:
                print(f"\r  <<< {msg['transcript']:<80}", end="", flush=True)
            if msg.get("status") == "report_saved":
                print(
                    f"  <<< [saved] id={msg['sos_id'][:12]}…  "
                    f"severity={msg['severity']}  dispatch={msg['dispatch_status']}"
                )
    except websockets.ConnectionClosed:
        print("  <<< server closed the connection")


async def main():
    print(f"Connecting to:\n  {WS_URL}\n")

    async with websockets.connect(WS_URL) as ws:
        print("Connected! Recording for {s}s — speak now.\n".format(s=RECORD_SECONDS))

        stream = sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=int(SAMPLE_RATE * CHUNK_SECONDS),
            callback=audio_callback,
        )

        with stream:
            send_task = asyncio.create_task(send_audio(ws))
            listen_task = asyncio.create_task(listen(ws))
            await asyncio.sleep(RECORD_SECONDS)

        # Stop recording, let remaining audio drain
        stop_flag.set()
        await send_task

        # Give the server a few seconds to finish processing the last chunk
        print("\n  ... waiting for final transcripts ...")
        try:
            await asyncio.wait_for(listen_task, timeout=10)
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass

    print("\nDone! You can check your DB for the saved SOS reports.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  interrupted — bye!")
