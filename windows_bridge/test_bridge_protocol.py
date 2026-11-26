#!/usr/bin/env python3
"""
Automated unit & safety tests for Quarky Drive Windows Host Bridge.
Tests 0-100 clamping, STOP priority, stale sequence rejection, and dry-run
press-and-release fail-safe behavior. Runnable on Linux, macOS, and Windows.
"""

import unittest
from quarky_bridge import (
    PictoBloxKeyDriver,
    clamp_int,
    speed_to_preset_key,
    validate_host_command,
)


class TestBridgeProtocolAndSafety(unittest.TestCase):
    def test_speed_clamping_0_to_100(self) -> None:
        self.assertEqual(clamp_int(-25, 0, 100), 0)
        self.assertEqual(clamp_int(0, 0, 100), 0)
        self.assertEqual(clamp_int(42.6, 0, 100), 43)
        self.assertEqual(clamp_int(999, 0, 100), 100)
        self.assertEqual(clamp_int("invalid", 0, 100), 0)

    def test_validate_rejects_stale_normal_commands_but_allows_failsafe(self) -> None:
        ok, cmd, _ = validate_host_command(
            {"seq": 10, "gear": "D", "steer": "center", "commandedSpeed": 150, "speedLimit": 80},
            last_seq=5,
        )
        self.assertTrue(ok)
        assert cmd is not None
        self.assertEqual(cmd["commandedSpeed"], 100)

        ok_stale, _, err = validate_host_command(
            {"seq": 4, "gear": "D", "steer": "center", "commandedSpeed": 50, "speedLimit": 80},
            last_seq=10,
        )
        self.assertFalse(ok_stale)
        self.assertIn("Stale sequence", err)

        ok_fs, cmd_fs, _ = validate_host_command(
            {"seq": 0, "gear": "D", "steer": "left", "commandedSpeed": 90, "emergencyStop": True, "motionState": "FAILSAFE_STOP"},
            last_seq=10,
        )
        self.assertTrue(ok_fs)
        assert cmd_fs is not None
        self.assertEqual(cmd_fs["commandedSpeed"], 0)
        self.assertTrue(cmd_fs["brake"])

    def test_stop_priority_releases_all_held_keys(self) -> None:
        driver = PictoBloxKeyDriver(dry_run=True, allow_any_window=True)
        driver.apply_command({
            "gear": "D", "steer": "left", "commandedSpeed": 75,
            "speedLimit": 75, "brake": False, "emergencyStop": False,
            "horn": False, "headlights": False, "motionState": "FORWARD",
        })
        self.assertEqual(driver.held_keys, {"W", "A"})

        # Emergency STOP must immediately clear all movement keys even if gear='D' and speed=75
        driver.apply_command({
            "gear": "D", "steer": "left", "commandedSpeed": 75,
            "speedLimit": 75, "brake": False, "emergencyStop": True,
            "horn": False, "headlights": False, "motionState": "FORWARD",
        })
        self.assertEqual(driver.held_keys, set())

    def test_failsafe_release_all(self) -> None:
        driver = PictoBloxKeyDriver(dry_run=True, allow_any_window=True)
        driver.apply_command({
            "gear": "R", "steer": "right", "commandedSpeed": 40,
            "speedLimit": 60, "brake": False, "emergencyStop": False,
            "horn": True, "headlights": False, "motionState": "REVERSE",
        })
        self.assertEqual(driver.held_keys, {"S", "D", "H"})
        driver.release_all_movement("test timeout")
        self.assertEqual(driver.held_keys, set())

    def test_speed_tiers(self) -> None:
        self.assertIsNone(speed_to_preset_key(0))
        self.assertEqual(speed_to_preset_key(25), "1")
        self.assertEqual(speed_to_preset_key(55), "2")
        self.assertEqual(speed_to_preset_key(80), "3")
        self.assertEqual(speed_to_preset_key(100), "4")


if __name__ == "__main__":
    unittest.main()
