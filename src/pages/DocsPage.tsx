import { useState } from 'react';
import { Download } from 'lucide-react';

type DocTab =
  | 'pictoblox'
  | 'bridge'
  | 'protocol'
  | 'deployment'
  | 'testing'
  | 'troubleshooting';

export function DocsPage() {
  const [tab, setTab] = useState<DocTab>('pictoblox');

  const tabs: Array<{ id: DocTab; label: string }> = [
    { id: 'pictoblox', label: 'PictoBlox Blocks' },
    { id: 'bridge', label: 'Windows Bridge' },
    { id: 'protocol', label: 'Protocol & Security' },
    { id: 'deployment', label: 'Local & Public Deploy' },
    { id: 'testing', label: 'Hardware Test Plan' },
    { id: 'troubleshooting', label: 'Troubleshooting' },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
      <div className="border-b border-white/10 pb-5">
        <p className="text-xs font-semibold tracking-widest text-amber-400">
          ENGINEERING & DEPLOYMENT MANUAL
        </p>
        <h1 className="font-display text-3xl font-bold text-white mt-1">
          Quarky Drive Setup, PictoBlox & Test Guide
        </h1>
        <p className="mt-1 text-sm text-slate-400 max-w-3xl">
          Complete block-by-block PictoBlox manual driving instructions, Windows host bridge downloads, relay protocol reference, public HTTPS/WSS deployment, and physical hardware verification plan.
        </p>
      </div>

      {/* Interactive section tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl bg-[#13171d] p-1.5 border border-white/10">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
              tab === item.id
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'pictoblox' && (
        <section className="ets-panel rounded-2xl p-6 space-y-6">
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-semibold text-white">
              PictoBlox Block-by-Block Manual Driving Program
            </h2>
            <p className="text-sm text-slate-300">
              Keep your existing PictoBlox Bluetooth connection to Quarky. Create a brand-new Stage-mode project with ONLY the <strong>Quarky</strong> extension (do NOT add Face Recognition, Traffic Sign Detection, or Camera AI extensions).
            </p>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="ets-recessed rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-amber-400">
                Step 1 — Initialize Speed Variable & Bluetooth
              </h3>
              <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-300 leading-relaxed">
                <li>Open <strong>PictoBlox</strong> on Windows and switch to <strong>Stage Mode</strong> (NOT Upload Mode, so Bluetooth stays live).</li>
                <li>Click <strong>Connect Board</strong> → select <strong>Quarky</strong> → pair over Bluetooth via PictoBlox Link.</li>
                <li>Go to <strong>Variables</strong> → create a variable named <code className="font-mono text-amber-300">drive_speed</code> and a variable <code className="font-mono text-amber-300">lights_on</code>.</li>
                <li>Build the startup & main drive loop using exact blocks below:</li>
              </ol>
              <pre className="rounded-lg bg-[#0a0d11] p-3.5 text-[11px] font-mono text-emerald-300 overflow-x-auto leading-relaxed">
{`when [green flag] clicked
  set [drive_speed v] to (60)
  set [lights_on v] to (0)
  stop robot

forever
  if <key [w v] pressed?> then
    go [forward v] at (drive_speed)% speed
  else
    if <key [s v] pressed?> then
      go [backward v] at (drive_speed)% speed
    else
      if <key [a v] pressed?> then
        go [left v] at (drive_speed)% speed
      else
        if <key [d v] pressed?> then
          go [right v] at (drive_speed)% speed
        else
          stop robot
        end
      end
    end
  end
end`}
              </pre>
            </div>

            <div className="ets-recessed rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-amber-400">
                Step 2 — Speed Presets, E-Stop, Horn & Headlights
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Add these parallel event hat blocks on the same sprite so speed limiter presets (`1`–`4`), Emergency Stop (`space`), Horn (`h`), and Headlights (`l`) respond immediately:
              </p>
              <pre className="rounded-lg bg-[#0a0d11] p-3.5 text-[11px] font-mono text-amber-200 overflow-x-auto leading-relaxed">
{`when [space v] key pressed
  stop robot

when [1 v] key pressed
  set [drive_speed v] to (25)

when [2 v] key pressed
  set [drive_speed v] to (50)

when [3 v] key pressed
  set [drive_speed v] to (75)

when [4 v] key pressed
  set [drive_speed v] to (100)

when [h v] key pressed
  play buzzer tone [C4 v] for (0.15) seconds

when [l v] key pressed
  if <(lights_on) = (0)> then
    set [lights_on v] to (1)
    set RGB LED brightness (100)% / display white LEDs
  else
    set [lights_on v] to (0)
    clear LED matrix
  end`}
              </pre>
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                <strong>Crucial:</strong> After clicking the Green Flag in PictoBlox, click once inside the white Stage area so Windows gives keyboard focus to PictoBlox Stage.
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'bridge' && (
        <section className="ets-panel rounded-2xl p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-2xl font-semibold text-white">
                Windows Host Bridge (<code className="font-mono text-amber-400">quarky_bridge.py</code>)
              </h2>
              <p className="mt-1 text-sm text-slate-300">
                Maintains an outbound WSS connection to the relay, validates commands, enforces a 600 ms local watchdog, checks PictoBlox window focus, and emits Win32 hardware scan codes via <code className="font-mono">SendInput</code>.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {['quarky_bridge.py', 'test_pictoblox_keys.py', 'test_bridge_protocol.py', 'requirements.txt', 'README_WINDOWS.md'].map((file) => (
                <a
                  key={file}
                  href={`/api/bridge-files/${file}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#171C23] px-3 py-2 text-xs font-mono text-slate-200 hover:border-amber-400/50 hover:text-amber-300"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{file}</span>
                </a>
              ))}
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="ets-recessed rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">Windows PowerShell Setup</h3>
              <pre className="rounded-lg bg-[#0a0d11] p-3 text-xs font-mono text-emerald-300 overflow-x-auto">
{`cd windows_bridge
python -m venv .venv
.\\.venv\\Scripts\\activate
pip install -r requirements.txt

# 1. Verify protocol & fail-safe logic
python test_bridge_protocol.py

# 2. Verify Win32 SendInput keystrokes in Windows GUI
python test_pictoblox_keys.py

# 3. Start bridge against your public HTTPS domain
python quarky_bridge.py --relay https://your-public-domain`}
              </pre>
            </div>

            <div className="ets-recessed rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-white">Honest Technical Limitations</h3>
              <ul className="list-disc pl-5 space-y-2 text-xs text-slate-300 leading-relaxed">
                <li>
                  <strong>No undocumented PictoBlox API:</strong> PictoBlox does not document a local IPC/WebSocket motor API while Stage Mode owns Bluetooth. Keyboard simulation via Win32 <code className="font-mono">SendInput</code> is used to preserve Bluetooth intact.
                </li>
                <li>
                  <strong>Foreground Focus Required:</strong> Windows delivers keystrokes only to the active window. <code className="font-mono">quarky_bridge.py</code> inspects <code className="font-mono">GetForegroundWindow()</code> and automatically stops the robot if you switch away from PictoBlox.
                </li>
                <li>
                  <strong>Discrete Speed Presets:</strong> Keyboard triggers map continuous 0–100% limits into four PictoBlox speed tiers (<code className="font-mono">1</code>=25%, <code className="font-mono">2</code>=50%, <code className="font-mono">3</code>=75%, <code className="font-mono">4</code>=100%).
                </li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {tab === 'protocol' && (
        <section className="ets-panel rounded-2xl p-6 space-y-5">
          <h2 className="font-display text-2xl font-semibold text-white">
            Control Protocol, Pairing & Security Model
          </h2>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="ets-recessed rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-400">WebSocket Control Message Format</h3>
              <pre className="rounded-lg bg-[#0a0d11] p-3 text-xs font-mono text-slate-200 overflow-x-auto">
{`{
  "type": "control",        // "control" | "heartbeat" | "disconnect"
  "seq": 42,                // strictly monotonic integer (rejects stale/replay)
  "ts": 1764140000123,      // epoch ms (checked against +/- 15s skew)
  "payload": {
    "gear": "D",            // "D" (forward) | "R" (reverse) | "N" (neutral)
    "throttle": 85,         // clamped 0..100
    "brake": false,         // overrides throttle -> speed 0
    "steer": "left",        // "left" | "right" | "center"
    "steerAngle": -100,     // clamped -100..100
    "speedLimit": 60,       // clamped 0..100
    "horn": false,
    "headlights": true,
    "emergencyStop": false  // highest priority -> forces STOP & center steer
  }
}`}
              </pre>
            </div>

            <div className="ets-recessed rounded-xl p-4 space-y-2.5 text-xs text-slate-300 leading-relaxed">
              <h3 className="text-sm font-semibold text-amber-400">Authentication & Safety Guarantees</h3>
              <ul className="list-disc pl-5 space-y-1.5">
                <li><strong>Short-Lived Single-Use Pairing:</strong> Host creates a 6-character code valid for 5 minutes. <code className="font-mono">POST /api/pair</code> consumes it immediately and issues a 256-bit controller token kept only in React memory.</li>
                <li><strong>Timing-Safe Token Checks:</strong> Server stores SHA-256 hashes and verifies WebSocket auth frames via <code className="font-mono">crypto.timingSafeEqual</code> within 5 seconds of connect.</li>
                <li><strong>Rate Limiting:</strong> HTTP pairing/session routes limit per-IP bursts; WebSocket limits to 50 commands/sec while NEVER dropping <code className="font-mono">STOP</code> or <code className="font-mono">emergencyStop</code> frames.</li>
                <li><strong>Triple Fail-Safe:</strong> Browser pointer-cancel/blur/visibility-hide sends STOP; relay server watchdog triggers STOP after 850 ms silence; Windows bridge triggers independent local key-release STOP after 600 ms silence.</li>
              </ul>
            </div>
          </div>
        </section>
      )}

      {tab === 'deployment' && (
        <section className="ets-panel rounded-2xl p-6 space-y-5">
          <h2 className="font-display text-2xl font-semibold text-white">
            Local Development & Public HTTPS Deployment
          </h2>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="ets-recessed rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-400">5. Local Development Setup</h3>
              <pre className="rounded-lg bg-[#0a0d11] p-3 text-xs font-mono text-emerald-300 overflow-x-auto">
{`npm install
npm run dev
# Express + WebSocket Relay + Vite serve on http://localhost:3000
# Controller: http://localhost:3000/controller
# Dashboard : http://localhost:3000/dashboard`}
              </pre>
            </div>
            <div className="ets-recessed rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-amber-400">6. Public HTTPS + WSS Deployment</h3>
              <pre className="rounded-lg bg-[#0a0d11] p-3 text-xs font-mono text-slate-200 overflow-x-auto">
{`npm run build
NODE_ENV=production PORT=3000 npm start

# Optional: restrict Windows host registration
export HOST_API_KEY="your-long-random-secret"`}
              </pre>
              <p className="text-xs text-slate-400 leading-relaxed">
                Deploy behind any TLS-terminating host that supports WebSockets (Cloud Run, Railway, Render, Fly.io, or Nginx reverse proxy with <code className="font-mono">Upgrade</code> headers). Never expose port 3000 without TLS on the open internet.
              </p>
            </div>
          </div>
          <div className="ets-recessed rounded-xl p-4 space-y-2 text-xs text-slate-300 leading-relaxed">
            <h3 className="text-sm font-semibold text-amber-400">7. Mobile Connection Guide (iOS Safari & Android Chrome)</h3>
            <p>
              Open the public <code className="font-mono">https://...</code> URL in Mobile Safari (iOS 15+) or Android Chrome. Scan the QR code on <code className="font-mono">/dashboard</code> or type the 6-character code on <code className="font-mono">/controller</code>. Rotate your phone to Landscape for the full 3-bezel ETS2 cockpit, or use Portrait for one-handed thumb operation. Multi-touch lets you hold Steering + Accelerator simultaneously.
            </p>
          </div>
        </section>
      )}

      {tab === 'testing' && (
        <section className="ets-panel rounded-2xl p-6 space-y-5">
          <h2 className="font-display text-2xl font-semibold text-white">
            Hardware Test Plan & Verification States
          </h2>
          <div className="grid gap-4 md:grid-cols-3 text-xs">
            <div className="ets-recessed rounded-xl p-4 space-y-1.5">
              <div className="font-semibold text-amber-400">State 1: Functioning UI</div>
              <p className="text-slate-300">Verified in browser via UI Preview Mode. Confirms wheel drag, multi-touch pedals, gear interlock, and E-STOP latch.</p>
            </div>
            <div className="ets-recessed rounded-xl p-4 space-y-1.5">
              <div className="font-semibold text-emerald-400">State 2: Simulated Commands</div>
              <p className="text-slate-300">Verified via Dashboard Simulated Host + Phone Controller. Confirms real HTTPS pairing, WSS auth, 0–100 clamping, and watchdog STOP.</p>
            </div>
            <div className="ets-recessed rounded-xl p-4 space-y-1.5">
              <div className="font-semibold text-rose-400">State 3: Physical Hardware (Pending)</div>
              <p className="text-slate-300">Must be executed on Windows with PictoBlox + Bluetooth Quarky elevated off the table before floor driving.</p>
            </div>
          </div>

          <ol className="list-decimal pl-5 space-y-2 text-xs text-slate-300 leading-relaxed">
            <li><strong>Elevate Quarky wheels off the desk</strong> (place chassis on a small box) so unexpected motor spin cannot roll off the table.</li>
            <li>Run <code className="font-mono text-slate-100">python test_bridge_protocol.py</code> and <code className="font-mono text-slate-100">python test_pictoblox_keys.py</code> on Windows and verify both print <strong>PASS</strong>.</li>
            <li>Connect Quarky in PictoBlox via Bluetooth, start the Green Flag script, and click inside the PictoBlox Stage.</li>
            <li>Start <code className="font-mono text-slate-100">quarky_bridge.py --relay https://...</code> and pair your phone on <code className="font-mono">/controller</code>.</li>
            <li>Set Speed Limiter to <strong>25%</strong>, shift to <strong>D</strong>, tap Accelerator briefly, and verify wheels spin forward and stop immediately upon release.</li>
            <li>Test <strong>Steering Left/Right</strong>, <strong>Reverse (R)</strong>, <strong>Horn</strong>, <strong>Headlights</strong>, and <strong>EMERGENCY STOP</strong>.</li>
            <li><strong>Fail-safe test:</strong> While holding Accelerator on your phone, lock the phone screen or switch apps — verify Quarky stops within 600–850 ms!</li>
          </ol>
        </section>
      )}

      {tab === 'troubleshooting' && (
        <section className="ets-panel rounded-2xl p-6 space-y-4 text-xs text-slate-300 leading-relaxed">
          <h2 className="font-display text-2xl font-semibold text-white">
            Troubleshooting Guide
          </h2>
          <div className="space-y-3">
            <div className="ets-recessed rounded-xl p-4">
              <h3 className="font-semibold text-amber-400">Dashboard shows commands arriving, but Quarky does not move</h3>
              <p className="mt-1">Check the Windows bridge console for <code className="font-mono">[FOCUS GUARD]</code> warnings. Click the Green Flag in PictoBlox and click once inside the white Stage area so PictoBlox holds Windows foreground focus.</p>
            </div>
            <div className="ets-recessed rounded-xl p-4">
              <h3 className="font-semibold text-amber-400">Pairing code rejected as expired or invalid</h3>
              <p className="mt-1">Pairing codes expire after 5 minutes and are single-use. Click <strong>New Code</strong> on <code className="font-mono">/dashboard</code> or restart <code className="font-mono">quarky_bridge.py</code>.</p>
            </div>
            <div className="ets-recessed rounded-xl p-4">
              <h3 className="font-semibold text-amber-400">Robot latches into FAILSAFE_STOP on poor Wi-Fi</h3>
              <p className="mt-1">Both the relay (850 ms) and Windows bridge (600 ms) stop the robot automatically if mobile packets drop. Move closer to Wi-Fi, release E-STOP latch on the controller, and shift back to D or R.</p>
            </div>
            <div className="ets-recessed rounded-xl p-4">
              <h3 className="font-semibold text-amber-400">Windows UAC / Admin elevation mismatch</h3>
              <p className="mt-1">If PictoBlox was launched as Administrator, Windows blocks non-elevated <code className="font-mono">SendInput</code> calls. Run both PictoBlox and <code className="font-mono">quarky_bridge.py</code> as a standard user.</p>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
