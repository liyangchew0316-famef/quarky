# Quarky Drive — Windows Host Bridge

## Scope & Honest Limitations
PictoBlox does not provide a documented local control API for external scripts while PictoBlox owns the Quarky Bluetooth link. Therefore, `quarky_bridge.py` preserves your existing PictoBlox Bluetooth connection by injecting **Win32 hardware scan codes** (`SendInput` with `KEYEVENTF_SCANCODE`) into the active PictoBlox Stage window.

### Known Limitations of Keyboard Simulation
1. **Window Focus Requirement**: PictoBlox Stage **must remain the active foreground window** on Windows. `quarky_bridge.py` checks `GetForegroundWindow()` and automatically refuses/releases driving keys if you Alt+Tab away from PictoBlox.
2. **Discrete Speed Tiers**: Standard PictoBlox key blocks react to discrete keys (`1`, `2`, `3`, `4` for 25% / 50% / 75% / 100% speed) rather than continuous analog floats.
3. **Hardware Verification**: Keyboard delivery can be verified on Windows with `test_pictoblox_keys.py`, and relay protocol safety can be verified with `test_bridge_protocol.py`, **but physical Bluetooth motion must still be verified on-site with your Quarky robot.**

## Setup on Windows
```powershell
cd windows_bridge
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
```

## Run Automated Tests
```powershell
python test_bridge_protocol.py
python test_pictoblox_keys.py
```

## Run the Host Bridge
```powershell
python quarky_bridge.py --relay https://YOUR-PUBLIC-DOMAIN
```
Then:
1. Open PictoBlox, connect Quarky over Bluetooth, load the manual driving blocks, and click the Green Flag + click inside the Stage.
2. Open `/controller` on your phone, enter the 6-character pairing code printed by `quarky_bridge.py`, and drive!
