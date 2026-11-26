#!/usr/bin/env python3
"""
Quarky Drive — Windows Host Bridge
----------------------------------
Maintains an outbound authenticated WSS connection to the Quarky Drive relay,
validates every command locally, enforces a 600ms fail-safe watchdog, and
delivers manual driving keystrokes to PictoBlox Stage on Windows via Win32
SendInput hardware scan codes (preserving PictoBlox's existing Bluetooth link).

No undocumented PictoBlox API is used.
"""

from __future__ import annotations

import argparse
import asyncio
import ctypes
from ctypes import wintypes
import json
import os
import signal
import sys
import threading
import time
from typing import Dict, Optional, Set
from urllib.parse import urlparse

try:
    import requests
except ImportError:  # pragma: no cover
    requests = None  # type: ignore[assignment]

try:
    import websockets
except ImportError:  # pragma: no cover
    websockets = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Win32 Hardware Scan Code Keyboard Output (Windows Only)
# ---------------------------------------------------------------------------

KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_SCANCODE = 0x0008
INPUT_KEYBOARD = 1

# Hardware Set-1 Scan Codes for standard US QWERTY
SCANCODES: Dict[str, int] = {
    "W": 0x11,      # Drive Forward
    "S": 0x1F,      # Drive Reverse
    "A": 0x1E,      # Steer Left
    "D": 0x20,      # Steer Right
    "SPACE": 0x39,  # Emergency Stop trigger in PictoBlox
    "H": 0x23,      # Horn
    "L": 0x26,      # Headlights toggle
    "1": 0x02,      # Speed Preset 25%
    "2": 0x03,      # Speed Preset 50%
    "3": 0x04,      # Speed Preset 75%
    "4": 0x05,      # Speed Preset 100%
}


if sys.platform == "win32":
    ULONG_PTR = ctypes.POINTER(wintypes.ULONG)

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [
            ("wVk", wintypes.WORD),
            ("wScan", wintypes.WORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_size_t),
        ]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [
            ("dx", wintypes.LONG),
            ("dy", wintypes.LONG),
            ("mouseData", wintypes.DWORD),
            ("dwFlags", wintypes.DWORD),
            ("time", wintypes.DWORD),
            ("dwExtraInfo", ctypes.c_size_t),
        ]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [
            ("uMsg", wintypes.DWORD),
            ("wParamL", wintypes.WORD),
            ("wParamH", wintypes.WORD),
        ]

    class _INPUT_UNION(ctypes.Union):
        _fields_ = [
            ("ki", KEYBDINPUT),
            ("mi", MOUSEINPUT),
            ("hi", HARDWAREINPUT),
        ]

    class INPUT(ctypes.Structure):
        _fields_ = [
            ("type", wintypes.DWORD),
            ("union", _INPUT_UNION),
        ]

    _user32 = ctypes.WinDLL("user32", use_last_error=True)
else:
    _user32 = None


def get_foreground_window_title() -> str:
    if sys.platform != "win32" or _user32 is None:
        return ""
    hwnd = _user32.GetForegroundWindow()
    if not hwnd:
        return ""
    length = _user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    _user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


class PictoBloxKeyDriver:
    """Manages press-and-release keyboard output with focus safety."""

    MOVEMENT_KEYS = ("W", "S", "A", "D")

    def __init__(self, dry_run: bool = False, allow_any_window: bool = False) -> None:
        self.dry_run = dry_run
        self.allow_any_window = allow_any_window
        self.held_keys: Set[str] = set()
        self.lock = threading.Lock()
        self.last_speed_tier: Optional[str] = None
        self.last_headlights: Optional[bool] = None
        self.last_horn: bool = False

    def _send_scancode(self, key_name: str, key_up: bool) -> None:
        if self.dry_run or sys.platform != "win32" or _user32 is None:
            return
        scan = SCANCODES.get(key_name)
        if scan is None:
            return
        flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if key_up else 0)
        inp = INPUT(
            type=INPUT_KEYBOARD,
            union=_INPUT_UNION(
                ki=KEYBDINPUT(wVk=0, wScan=scan, dwFlags=flags, time=0, dwExtraInfo=0)
            ),
        )
        _user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    def _is_target_focused(self) -> bool:
        if self.dry_run or self.allow_any_window or sys.platform != "win32":
            return True
        title = get_foreground_window_title().lower()
        return "pictoblox" in title

    def _set_key_state(self, key_name: str, pressed: bool) -> None:
        currently = key_name in self.held_keys
        if pressed and not currently:
            self._send_scancode(key_name, key_up=False)
            self.held_keys.add(key_name)
            if self.dry_run:
                print(f"[DRY-RUN KEY DOWN] {key_name}")
        elif not pressed and currently:
            self._send_scancode(key_name, key_up=True)
            self.held_keys.discard(key_name)
            if self.dry_run:
                print(f"[DRY-RUN KEY UP]   {key_name}")

    def release_all_movement(self, reason: str = "") -> None:
        with self.lock:
            released = []
            for key in list(self.held_keys):
                self._send_scancode(key, key_up=True)
                self.held_keys.discard(key)
                released.append(key)
            if released and reason:
                print(f"[FAIL-SAFE] Released keys {released}: {reason}")

    def pulse_key(self, key_name: str, duration_s: float = 0.05) -> None:
        if not self._is_target_focused():
            return
        self._send_scancode(key_name, key_up=False)
        time.sleep(duration_s)
        self._send_scancode(key_name, key_up=True)
        if self.dry_run:
            print(f"[DRY-RUN PULSE]    {key_name}")

    def apply_command(self, cmd: dict) -> None:
        with self.lock:
            motion = cmd.get("motionState", "STOPPED")
            emergency = bool(cmd.get("emergencyStop", False))
            brake = bool(cmd.get("brake", False))
            gear = cmd.get("gear", "N")
            steer = cmd.get("steer", "center")
            speed = clamp_int(cmd.get("commandedSpeed", 0), 0, 100)
            speed_limit = clamp_int(cmd.get("speedLimit", 60), 0, 100)
            horn = bool(cmd.get("horn", False))
            headlights = bool(cmd.get("headlights", False))

            # STOP has strict priority over everything else
            if emergency or brake or motion in ("STOPPED", "NEUTRAL", "FAILSAFE_STOP") or gear == "N" or speed == 0:
                for key in ("W", "S", "A", "D"):
                    self._set_key_state(key, False)
                if emergency:
                    # Pulse SPACE once if PictoBlox is focused to trigger PictoBlox stop block
                    if self._is_target_focused():
                        self._send_scancode("SPACE", key_up=False)
                        self._send_scancode("SPACE", key_up=True)
                self._set_key_state("H", horn and self._is_target_focused())
                return

            if not self._is_target_focused():
                # Never type driving keys into a non-PictoBlox foreground app
                for key in ("W", "S", "A", "D", "H"):
                    self._set_key_state(key, False)
                fg = get_foreground_window_title() or "(no active window)"
                print(f"[FOCUS GUARD] Refused driving keys because foreground window is '{fg}', not PictoBlox.")
                return

            # Map clamped speedLimit/commandedSpeed (0..100) to PictoBlox preset key 1/2/3/4
            tier = speed_to_preset_key(speed)
            if tier != self.last_speed_tier and tier is not None:
                self._send_scancode(tier, key_up=False)
                self._send_scancode(tier, key_up=True)
                self.last_speed_tier = tier
                if self.dry_run:
                    print(f"[DRY-RUN SPEED TIER] Key {tier} (commanded={speed}%, limit={speed_limit}%)")

            # Drive Forward / Reverse
            self._set_key_state("W", gear == "D" and speed > 0)
            self._set_key_state("S", gear == "R" and speed > 0)

            # Steering Left / Right
            self._set_key_state("A", steer == "left")
            self._set_key_state("D", steer == "right")

            # Horn (press-and-release)
            self._set_key_state("H", horn)

            # Headlight toggle edge trigger
            if self.last_headlights is not None and headlights != self.last_headlights:
                self._send_scancode("L", key_up=False)
                self._send_scancode("L", key_up=True)
                if self.dry_run:
                    print(f"[DRY-RUN HEADLIGHTS] {'ON' if headlights else 'OFF'}")
            self.last_headlights = headlights


# ---------------------------------------------------------------------------
# Protocol Validation & Clamping (Mirror of src/shared/protocol.ts)
# ---------------------------------------------------------------------------

def clamp_int(value: object, min_val: int, max_val: int) -> int:
    try:
        num = int(round(float(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return min_val
    return max(min_val, min(max_val, num))


def speed_to_preset_key(commanded_speed: int) -> Optional[str]:
    if commanded_speed <= 0:
        return None
    if commanded_speed <= 30:
        return "1"
    if commanded_speed <= 60:
        return "2"
    if commanded_speed <= 85:
        return "3"
    return "4"


def validate_host_command(raw: dict, last_seq: int) -> tuple[bool, Optional[dict], str]:
    """Validate incoming command packet from relay before touching OS inputs."""
    if not isinstance(raw, dict):
        return False, None, "Malformed packet"

    seq = raw.get("seq")
    if not isinstance(seq, int) or seq < 0:
        return False, None, "Invalid sequence number"

    motion = raw.get("motionState")
    is_failsafe = motion == "FAILSAFE_STOP" or bool(raw.get("emergencyStop", False))

    # Reject stale sequences unless it's an authoritative fail-safe stop
    if not is_failsafe and seq < last_seq:
        return False, None, f"Stale sequence ({seq} < {last_seq})"

    gear = raw.get("gear")
    if gear not in ("R", "N", "D"):
        return False, None, f"Invalid gear: {gear}"

    steer = raw.get("steer")
    if steer not in ("left", "right", "center"):
        return False, None, f"Invalid steer: {steer}"

    commanded_speed = clamp_int(raw.get("commandedSpeed", 0), 0, 100)
    speed_limit = clamp_int(raw.get("speedLimit", 60), 0, 100)

    validated = {
        "seq": seq,
        "gear": gear,
        "steer": steer,
        "commandedSpeed": 0 if is_failsafe else commanded_speed,
        "speedLimit": speed_limit,
        "brake": True if is_failsafe else bool(raw.get("brake", False)),
        "emergencyStop": bool(raw.get("emergencyStop", False)),
        "horn": False if is_failsafe else bool(raw.get("horn", False)),
        "headlights": bool(raw.get("headlights", False)),
        "motionState": "FAILSAFE_STOP" if is_failsafe else str(motion or "STOPPED"),
    }
    return True, validated, "ok"


# ---------------------------------------------------------------------------
# Relay Client & Local Fail-Safe Watchdog
# ---------------------------------------------------------------------------

def build_ws_url(http_base: str) -> str:
    parsed = urlparse(http_base.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return f"{scheme}://{parsed.netloc}/ws"


def register_session(relay_url: str, host_key: Optional[str], host_label: str) -> dict:
    endpoint = f"{relay_url.rstrip('/')}/api/sessions"
    headers = {"Content-Type": "application/json"}
    if host_key:
        headers["x-host-key"] = host_key
    body_obj = {"mode": "hardware", "hostLabel": host_label}
    if requests is not None:
        resp = requests.post(endpoint, json=body_obj, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()
    import urllib.request
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(body_obj).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode("utf-8"))


async def run_bridge(args: argparse.Namespace) -> None:
    if websockets is None:
        raise RuntimeError("Missing dependency 'websockets'. Run: pip install -r requirements.txt")
    driver = PictoBloxKeyDriver(dry_run=args.dry_run, allow_any_window=args.allow_any_window)
    session = register_session(args.relay, args.host_key, args.host_label)

    session_id = session["sessionId"]
    host_token = session["hostToken"]
    monitor_token = session["monitorToken"]
    pairing_code = session["pairingCode"]
    ws_url = build_ws_url(args.relay)

    print("\n============================================================")
    print("  QUARKY DRIVE — WINDOWS HOST BRIDGE")
    print("============================================================")
    print(f"  Relay Endpoint : {args.relay}")
    print(f"  Session ID     : {session_id}")
    print(f"  Pairing Code   : {pairing_code}  (expires in 5 min)")
    print(f"  Controller URL : {args.relay.rstrip('/')}/controller?code={pairing_code}")
    print(f"  Dashboard URL  : {args.relay.rstrip('/')}/dashboard?session={session_id}&monitor={monitor_token}")
    print(f"  Dry Run Mode   : {args.dry_run}")
    print(f"  Watchdog Limit : {args.watchdog_ms} ms")
    print("------------------------------------------------------------")
    print("  1. Open PictoBlox on Windows & connect Quarky via Bluetooth.")
    print("  2. Click the Green Flag and click inside the PictoBlox Stage.")
    print("  3. Open the Controller URL on your phone & enter Pairing Code.")
    print("  Press Ctrl+C to stop safely (all keys auto-released).")
    print("============================================================\n")

    last_rx_monotonic = time.monotonic()
    last_seq = -1
    stop_event = threading.Event()
    watchdog_tripped = False

    def watchdog_loop() -> None:
        nonlocal watchdog_tripped
        timeout_s = args.watchdog_ms / 1000.0
        while not stop_event.is_set():
            elapsed = time.monotonic() - last_rx_monotonic
            if elapsed > timeout_s and driver.held_keys:
                driver.release_all_movement(f"Local watchdog timeout ({int(elapsed * 1000)}ms > {args.watchdog_ms}ms)")
                watchdog_tripped = True
            time.sleep(0.05)

    wd_thread = threading.Thread(target=watchdog_loop, daemon=True)
    wd_thread.start()

    try:
        while not stop_event.is_set():
            try:
                async with websockets.connect(ws_url, ping_interval=15, ping_timeout=10) as ws:
                    await ws.send(json.dumps({
                        "type": "auth:host",
                        "sessionId": session_id,
                        "token": host_token,
                    }))
                    print("[RELAY] Connected and authenticated as Windows Host Bridge.")
                    last_rx_monotonic = time.monotonic()

                    async for raw_msg in ws:
                        if stop_event.is_set():
                            break
                        try:
                            msg = json.loads(raw_msg)
                        except json.JSONDecodeError:
                            driver.release_all_movement("Invalid JSON from relay")
                            continue

                        msg_type = msg.get("type")
                        if msg_type == "command":
                            last_rx_monotonic = time.monotonic()
                            watchdog_tripped = False
                            ok, validated, err = validate_host_command(msg.get("state", {}), last_seq)
                            if not ok or validated is None:
                                print(f"[REJECTED] {err}")
                                continue
                            last_seq = max(last_seq, validated["seq"])
                            driver.apply_command(validated)
                        elif msg_type == "heartbeat:ack":
                            last_rx_monotonic = time.monotonic()
                            if watchdog_tripped:
                                watchdog_tripped = False
                        elif msg_type == "controller:disconnected":
                            driver.release_all_movement("Controller disconnected")
                        elif msg_type == "session:state":
                            snap = msg.get("snapshot", {})
                            code = snap.get("pairingCode")
                            if code:
                                print(f"[SESSION] Active Pairing Code: {code} | Controller: {snap.get('controllerConnected')}")
                        elif msg_type == "error":
                            print(f"[RELAY ERROR] {msg.get('message')}")
            except (OSError, websockets.WebSocketException) as exc:
                driver.release_all_movement(f"WebSocket connection lost: {exc}")
                if not stop_event.is_set():
                    print("[RELAY] Reconnecting in 2 seconds...")
                    await asyncio.sleep(2.0)
    finally:
        stop_event.set()
        driver.release_all_movement("Bridge shutting down")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quarky Drive Windows Host Bridge")
    parser.add_argument(
        "--relay",
        default=os.environ.get("QUARKY_RELAY_URL", "http://localhost:3000"),
        help="Public HTTPS/HTTP URL of the Quarky Drive relay server",
    )
    parser.add_argument(
        "--host-key",
        default=os.environ.get("HOST_API_KEY", ""),
        help="Optional HOST_API_KEY if configured on the relay server",
    )
    parser.add_argument(
        "--host-label",
        default=os.environ.get("COMPUTERNAME", "Windows-PictoBlox-Host"),
        help="Display name for this Windows host on the dashboard",
    )
    parser.add_argument(
        "--watchdog-ms",
        type=int,
        default=600,
        help="Local fail-safe watchdog timeout in ms (default: 600)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Log keystrokes instead of calling Win32 SendInput (safe for Linux/testing)",
    )
    parser.add_argument(
        "--allow-any-window",
        action="store_true",
        help="Bypass PictoBlox foreground window title check (for local key-tester harness only)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    def handle_exit(_sig: int, _frame: object) -> None:
        print("\n[SHUTDOWN] Signal received — stopping robot and exiting.")
        sys.exit(0)

    signal.signal(signal.SIGINT, handle_exit)
    if hasattr(signal, "SIGTERM"):
        signal.signal(signal.SIGTERM, handle_exit)

    asyncio.run(run_bridge(args))


if __name__ == "__main__":
    main()
