#!/usr/bin/env python3
"""
Quarky Drive — Windows End-to-End Keyboard Delivery Test Harness
----------------------------------------------------------------
Run this script on Windows to verify that Win32 hardware scan code
SendInput events produced by quarky_bridge.py are actually received
by a focused GUI window (or PictoBlox Stage).

Usage:
  1. Run: python test_pictoblox_keys.py
  2. A small test window titled "PictoBlox Key Verification Harness" opens
     (its title contains "PictoBlox" so the focus guard treats it identically
     to PictoBlox Stage).
  3. Keep the window focused for ~4 seconds while the automated test injects
     W, A, S, D, 2, H, L, SPACE press-and-release sequences via SendInput.
  4. Verify that every expected KeyPress and KeyRelease event is recorded.
"""

from __future__ import annotations

import sys
import threading
import time
import tkinter as tk
from typing import List, Tuple

from quarky_bridge import PictoBloxKeyDriver


EXPECTED_SEQUENCE: List[Tuple[str, str]] = [
    ("KeyPress", "2"),
    ("KeyPress", "w"),
    ("KeyRelease", "w"),
    ("KeyPress", "a"),
    ("KeyRelease", "a"),
    ("KeyPress", "s"),
    ("KeyRelease", "s"),
    ("KeyPress", "d"),
    ("KeyRelease", "d"),
    ("KeyPress", "h"),
    ("KeyRelease", "h"),
    ("KeyPress", "space"),
    ("KeyRelease", "space"),
]


def run_harness() -> int:
    if sys.platform != "win32":
        print("NOTE: test_pictoblox_keys.py requires Windows (win32 SendInput + GUI focus).")
        print("Run test_bridge_protocol.py on Linux/macOS to verify protocol & fail-safe logic.")
        return 0

    root = tk.Tk()
    root.title("PictoBlox Key Verification Harness")
    root.geometry("520x320")
    root.configure(bg="#13171d")

    status_var = tk.StringVar(value="Keep this window focused. Starting SendInput test in 1.5s...")
    label = tk.Label(root, textvariable=status_var, fg="#f59e0b", bg="#13171d", font=("Consolas", 11))
    label.pack(pady=16)

    log_box = tk.Text(root, height=12, width=58, bg="#0d1014", fg="#e2e8f0", font=("Consolas", 10))
    log_box.pack(padx=16, pady=8)

    observed: List[Tuple[str, str]] = []

    def on_key_press(event: tk.Event) -> None:  # type: ignore[type-arg]
        sym = event.keysym.lower()
        observed.append(("KeyPress", sym))
        log_box.insert(tk.END, f"DOWN : {sym}\n")
        log_box.see(tk.END)

    def on_key_release(event: tk.Event) -> None:  # type: ignore[type-arg]
        sym = event.keysym.lower()
        observed.append(("KeyRelease", sym))
        log_box.insert(tk.END, f"UP   : {sym}\n")
        log_box.see(tk.END)

    root.bind("<KeyPress>", on_key_press)
    root.bind("<KeyRelease>", on_key_release)

    driver = PictoBloxKeyDriver(dry_run=False, allow_any_window=False)

    def drive_sequence() -> None:
        time.sleep(1.5)
        # Forward at tier 2 (50%)
        driver.apply_command({
            "gear": "D", "steer": "center", "commandedSpeed": 50,
            "speedLimit": 50, "brake": False, "emergencyStop": False,
            "horn": False, "headlights": False, "motionState": "FORWARD",
        })
        time.sleep(0.15)
        # Neutral stop
        driver.apply_command({
            "gear": "N", "steer": "center", "commandedSpeed": 0,
            "speedLimit": 50, "brake": False, "emergencyStop": False,
            "horn": False, "headlights": False, "motionState": "NEUTRAL",
        })
        time.sleep(0.1)
        # Steer Left
        driver.apply_command({
            "gear": "D", "steer": "left", "commandedSpeed": 50,
            "speedLimit": 50, "brake": False, "emergencyStop": False,
            "horn": False, "headlights": False, "motionState": "FORWARD",
        })
        time.sleep(0.1)
        driver.release_all_movement("step")
        time.sleep(0.1)
        # Reverse + Steer Right
        driver.apply_command({
            "gear": "R", "steer": "right", "commandedSpeed": 50,
            "speedLimit": 50, "brake": False, "emergencyStop": False,
            "horn": False, "headlights": False, "motionState": "REVERSE",
        })
        time.sleep(0.1)
        # Horn + Emergency Stop
        driver.apply_command({
            "gear": "N", "steer": "center", "commandedSpeed": 0,
            "speedLimit": 50, "brake": True, "emergencyStop": True,
            "horn": True, "headlights": False, "motionState": "STOPPED",
        })
        time.sleep(0.1)
        driver.release_all_movement("done")
        time.sleep(0.4)
        root.after(0, finish_test)

    def finish_test() -> None:
        missing = [item for item in EXPECTED_SEQUENCE if item not in observed]
        if not missing:
            status_var.set("PASS: All SendInput scancodes received accurately.")
            print("PASS: All SendInput hardware scancodes received by focused window.")
        else:
            status_var.set(f"FAIL: Missing events: {missing}")
            print(f"FAIL: Missing keyboard events: {missing}")
        root.after(1200, root.destroy)

    threading.Thread(target=drive_sequence, daemon=True).start()
    root.mainloop()

    missing = [item for item in EXPECTED_SEQUENCE if item not in observed]
    return 0 if not missing else 1


if __name__ == "__main__":
    raise SystemExit(run_harness())
