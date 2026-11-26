import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Link2Off,
  Monitor,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Terminal,
} from 'lucide-react';
import type { CommandLogEntry, SessionSnapshot } from '../shared/protocol';

interface DashboardPageProps {
  search: string;
  onNavigate: (to: string) => void;
}

export function DashboardPage({ search, onNavigate }: DashboardPageProps) {
  const initialParams = useMemo(() => {
    const params = new URLSearchParams(search);
    return {
      session: params.get('session') || '',
      monitor: params.get('monitor') || '',
    };
  }, [search]);

  const [sessionId, setSessionId] = useState(initialParams.session);
  const [monitorToken, setMonitorToken] = useState(initialParams.monitor);
  const [manualSessionInput, setManualSessionInput] = useState(initialParams.session);
  const [manualMonitorInput, setManualMonitorInput] = useState(initialParams.monitor);

  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [logs, setLogs] = useState<CommandLogEntry[]>([]);
  const [relayConnected, setRelayConnected] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const monitorWsRef = useRef<WebSocket | null>(null);
  const simHostWsRef = useRef<WebSocket | null>(null);

  // Live 1-second timer for pairing code TTL countdown
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const cleanupSockets = useCallback(() => {
    if (monitorWsRef.current) {
      try {
        monitorWsRef.current.close(1000, 'Dashboard closed');
      } catch {
        // ignore
      }
      monitorWsRef.current = null;
    }
    if (simHostWsRef.current) {
      try {
        simHostWsRef.current.close(1000, 'Simulated host closed');
      } catch {
        // ignore
      }
      simHostWsRef.current = null;
    }
    setRelayConnected(false);
  }, []);

  useEffect(() => cleanupSockets, [cleanupSockets]);

  const connectMonitorSocket = useCallback(
    (sid: string, monToken: string, simHostToken?: string) => {
      cleanupSockets();
      setErrorMsg(null);
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${proto}//${window.location.host}/ws`;

      const mws = new WebSocket(wsUrl);
      monitorWsRef.current = mws;

      mws.onopen = () => {
        mws.send(JSON.stringify({ type: 'auth:monitor', sessionId: sid, token: monToken }));
        setRelayConnected(true);
      };

      mws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'session:state' && msg.snapshot) {
            setSnapshot(msg.snapshot);
            if (Array.isArray(msg.logs)) {
              setLogs(msg.logs);
            }
          } else if (msg.type === 'error') {
            setErrorMsg(msg.message || 'Monitor socket error');
          }
        } catch {
          // ignore
        }
      };

      mws.onclose = () => {
        setRelayConnected(false);
      };

      if (simHostToken) {
        const hws = new WebSocket(wsUrl);
        simHostWsRef.current = hws;
        hws.onopen = () => {
          hws.send(JSON.stringify({ type: 'auth:host', sessionId: sid, token: simHostToken }));
        };
      }
    },
    [cleanupSockets]
  );

  // Auto-connect if URL has ?session=...&monitor=...
  useEffect(() => {
    if (initialParams.session && initialParams.monitor) {
      connectMonitorSocket(initialParams.session, initialParams.monitor);
    }
  }, [initialParams.session, initialParams.monitor, connectMonitorSocket]);

  async function startSimulatedHostSession() {
    setIsCreating(true);
    setErrorMsg(null);
    try {
      const resp = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'simulated',
          hostLabel: 'Browser-Simulated-Host',
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setErrorMsg(data.error || 'Could not start session');
        return;
      }
      setSessionId(data.sessionId);
      setMonitorToken(data.monitorToken);
      connectMonitorSocket(data.sessionId, data.monitorToken, data.hostToken);
    } catch {
      setErrorMsg('Failed to reach relay server.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRotateCode() {
    if (!sessionId || !monitorToken) return;
    try {
      const resp = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/rotate-code`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
      if (!resp.ok) {
        const d = await resp.json();
        setErrorMsg(d.error || 'Failed to rotate pairing code.');
      }
    } catch {
      setErrorMsg('Network error rotating pairing code.');
    }
  }

  async function handleDisconnectController() {
    if (!sessionId || !monitorToken) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/disconnect-controller`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${monitorToken}` },
      });
    } catch {
      setErrorMsg('Network error disconnecting controller.');
    }
  }

  function handleAttachExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!manualSessionInput.trim() || !manualMonitorInput.trim()) return;
    setSessionId(manualSessionInput.trim());
    setMonitorToken(manualMonitorInput.trim());
    connectMonitorSocket(manualSessionInput.trim(), manualMonitorInput.trim());
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    } catch {
      // clipboard blocked fallback
    }
  }

  const controllerUrl = snapshot?.pairingCode
    ? `${window.location.origin}/controller?code=${encodeURIComponent(snapshot.pairingCode)}`
    : `${window.location.origin}/controller`;

  const remainingSec = snapshot?.pairingExpiresAt
    ? Math.max(0, Math.floor((snapshot.pairingExpiresAt - nowTick) / 1000))
    : 0;

  const bridgeCmd = `python quarky_bridge.py --relay ${window.location.origin}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between border-b border-white/10 pb-5">
        <div>
          <p className="text-xs font-semibold tracking-widest text-amber-400">
            DESKTOP HOST CONSOLE
          </p>
          <h1 className="font-display text-3xl font-bold text-white mt-1">
            Relay Pairing & Telemetry Monitor
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Monitor your Windows PictoBlox Host Bridge or launch a browser-simulated host to test phone pairing right away.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={startSimulatedHostSession}
            disabled={isCreating}
            className="whitespace-nowrap shrink-0 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {isCreating ? 'Starting Host...' : 'Start Simulated Browser Host'}
          </button>
          <a
            href="/api/bridge-files/quarky_bridge.py"
            className="inline-flex items-center gap-2 whitespace-nowrap shrink-0 rounded-lg border border-white/15 bg-[#171C23] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-300"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download quarky_bridge.py</span>
          </a>
        </div>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/35 px-4 py-3 text-xs text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Unconnected setup view */}
      {!snapshot && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="ets-panel rounded-2xl p-6 lg:col-span-7 space-y-5">
            <div className="flex items-center gap-2.5">
              <Terminal className="h-5 w-5 text-amber-400" />
              <h2 className="font-display text-xl font-semibold text-white">
                Option A: Connect Your Windows PC (Real Hardware Path)
              </h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              Run <span className="font-mono text-amber-300">quarky_bridge.py</span> on the Windows computer maintaining your PictoBlox Bluetooth connection. It connects outbound over WSS, prints a 6-character phone pairing code, and prints a one-click Dashboard URL.
            </p>
            <div className="ets-recessed rounded-xl p-4 flex items-center justify-between gap-3">
              <code className="text-xs font-mono text-emerald-300 overflow-x-auto">{bridgeCmd}</code>
              <button
                type="button"
                onClick={() => copyText('cmd', bridgeCmd)}
                className="shrink-0 rounded-lg border border-white/10 bg-[#171C23] px-3 py-1.5 text-xs text-slate-200 hover:border-amber-400/50"
              >
                {copiedKey === 'cmd' ? 'Copied' : 'Copy'}
              </button>
            </div>

            <form onSubmit={handleAttachExisting} className="border-t border-white/10 pt-5 space-y-3">
              <h3 className="text-xs font-semibold text-slate-300">
                Attach to an Active Windows Bridge Session
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  placeholder="Session ID (qk_...)"
                  value={manualSessionInput}
                  onChange={(e) => setManualSessionInput(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#0D1014] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                />
                <input
                  type="password"
                  placeholder="Monitor Token"
                  value={manualMonitorInput}
                  onChange={(e) => setManualMonitorInput(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#0D1014] px-3 py-2 text-xs font-mono text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg border border-white/15 bg-[#171C23] px-4 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400/50"
              >
                Attach Monitor
              </button>
            </form>
          </div>

          <div className="ets-panel rounded-2xl p-6 lg:col-span-5 flex flex-col justify-between space-y-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <Monitor className="h-5 w-5 text-amber-400" />
                <h2 className="font-display text-xl font-semibold text-white">
                  Option B: Test Relay Without Hardware
                </h2>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                Launch a simulated host session directly in this browser tab to generate a QR code and pairing code. Open <span className="font-mono text-slate-200">/controller</span> on your phone to test real authenticated WebSocket command delivery and fail-safe stops immediately.
              </p>
            </div>
            <button
              type="button"
              onClick={startSimulatedHostSession}
              disabled={isCreating}
              className="w-full rounded-xl bg-amber-500 py-3 text-sm font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
            >
              {isCreating ? 'Creating Session...' : 'Start Simulated Browser Host'}
            </button>
          </div>
        </div>
      )}

      {/* Active Session Telemetry View */}
      {snapshot && (
        <div className="space-y-6">
          {/* Operational State Clarity Banner */}
          <div className="ets-recessed rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 text-xs">
              <ShieldAlert className={`h-4 w-4 ${snapshot.mode === 'hardware' ? 'text-amber-400' : 'text-emerald-400'}`} />
              <span className="font-semibold text-white">
                {snapshot.mode === 'hardware'
                  ? 'MODE: WINDOWS HOST BRIDGE (PHYSICAL QUARKY MOTION UNVERIFIED UNTIL TESTED ON-SITE)'
                  : 'MODE: SIMULATED RELAY HOST (NO PHYSICAL HARDWARE CONNECTED)'}
              </span>
            </div>
            <div className="text-xs font-mono-tabular text-slate-400">
              <span>Relay: {relayConnected ? 'Connected' : 'Reconnecting'}</span>
              <span className="mx-2 text-slate-600">·</span>
              <span>Session: {snapshot.sessionId}</span>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            {/* Pairing & QR Card */}
            <section className="ets-panel rounded-2xl p-6 lg:col-span-5 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold text-white">
                  Phone Pairing
                </h2>
                <button
                  type="button"
                  onClick={handleRotateCode}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#171C23] px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-amber-400/50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>New Code</span>
                </button>
              </div>

              {snapshot.pairingCode ? (
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="rounded-xl bg-white p-3 shrink-0">
                    <QRCodeSVG value={controllerUrl} size={132} level="M" />
                  </div>
                  <div className="space-y-2 text-center sm:text-left">
                    <div className="text-xs text-slate-400">Enter on /controller</div>
                    <div className="font-mono-tabular text-3xl font-bold tracking-[0.2em] text-amber-400">
                      {snapshot.pairingCode}
                    </div>
                    <div className="font-mono-tabular text-xs text-slate-400">
                      Expires in {Math.floor(remainingSec / 60)}:
                      {String(remainingSec % 60).padStart(2, '0')} · Single-use
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1 justify-center sm:justify-start">
                      <button
                        type="button"
                        onClick={() => copyText('url', controllerUrl)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#171C23] px-3 py-1.5 text-xs text-slate-200 hover:border-amber-400/50"
                      >
                        {copiedKey === 'url' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                        <span>{copiedKey === 'url' ? 'Copied Link' : 'Copy Phone Link'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onNavigate(`/controller?code=${encodeURIComponent(snapshot.pairingCode || '')}`)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/20"
                      >
                        <Smartphone className="h-3.5 w-3.5" />
                        <span>Open in Tab</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="ets-recessed rounded-xl p-4 text-xs text-slate-300 space-y-2">
                  <p>
                    {snapshot.controllerConnected
                      ? 'Pairing code consumed. An authorized controller is currently connected.'
                      : 'No active pairing code. Click "New Code" to generate a fresh 5-minute code.'}
                  </p>
                </div>
              )}

              {/* Connection KPIs */}
              <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-xs">
                <div className="ets-recessed rounded-xl p-3">
                  <div className="text-slate-400">Host Bridge</div>
                  <div className={`mt-1 font-semibold ${snapshot.hostConnected ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {snapshot.hostConnected ? `Online · ${snapshot.hostLabel}` : 'Offline'}
                  </div>
                </div>
                <div className="ets-recessed rounded-xl p-3">
                  <div className="text-slate-400">Controller</div>
                  <div className={`mt-1 font-semibold ${snapshot.controllerConnected ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {snapshot.controllerConnected ? 'Paired & Online' : 'Not Connected'}
                  </div>
                </div>
              </div>

              {snapshot.controllerConnected && (
                <button
                  type="button"
                  onClick={handleDisconnectController}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-500/40 bg-rose-950/35 py-2.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/50"
                >
                  <Link2Off className="h-4 w-4" />
                  <span>Disconnect Controller & Force STOP</span>
                </button>
              )}
            </section>

            {/* Live Vehicle Telemetry Mirror */}
            <section className="ets-panel rounded-2xl p-6 lg:col-span-7 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl font-semibold text-white">
                  Validated Command State
                </h2>
                <span className="font-mono-tabular text-xs text-slate-400">
                  Rate {snapshot.commandRatePerSec}/s · Rejected {snapshot.rejectedCount}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono-tabular">
                <div className="ets-recessed rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">MOTION STATE</div>
                  <div className={`mt-1 text-base font-bold ${
                    snapshot.commandState.motionState.includes('STOP')
                      ? 'text-rose-400'
                      : snapshot.commandState.motionState === 'FORWARD'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                  }`}>
                    {snapshot.commandState.motionState}
                  </div>
                </div>

                <div className="ets-recessed rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">COMMANDED SPEED</div>
                  <div className="mt-1 text-xl font-bold text-white">
                    {snapshot.commandState.commandedSpeed}%
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Limit {snapshot.commandState.speedLimit}%
                  </div>
                </div>

                <div className="ets-recessed rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">GEAR / STEER</div>
                  <div className="mt-1 text-xl font-bold text-amber-400">
                    {snapshot.commandState.gear} · {snapshot.commandState.steer.toUpperCase()}
                  </div>
                  <div className="text-[10px] text-slate-500">
                    Angle {snapshot.commandState.steerAngle}°
                  </div>
                </div>

                <div className="ets-recessed rounded-xl p-3.5">
                  <div className="text-[11px] text-slate-400">AUXILIARY</div>
                  <div className="mt-1 text-sm font-bold text-slate-200">
                    Lights: {snapshot.commandState.headlights ? 'ON' : 'OFF'}
                  </div>
                  <div className="text-xs text-slate-400">
                    Horn: {snapshot.commandState.horn ? 'ACTIVE' : 'OFF'}
                  </div>
                </div>
              </div>

              {/* Command Log Table */}
              <div className="border-t border-white/10 pt-4">
                <h3 className="text-xs font-semibold text-slate-300 mb-2">
                  Live Validated Command & Safety Log
                </h3>
                <div className="ets-recessed max-h-60 overflow-y-auto rounded-xl">
                  {logs.length === 0 ? (
                    <div className="p-4 text-xs text-slate-500">
                      Waiting for controller frames...
                    </div>
                  ) : (
                    <table className="w-full text-left text-xs font-mono-tabular">
                      <thead className="sticky top-0 bg-[#0d1014] text-[11px] text-slate-400 border-b border-white/10">
                        <tr>
                          <th className="px-3 py-2">Time</th>
                          <th className="px-3 py-2">Seq</th>
                          <th className="px-3 py-2">Event</th>
                          <th className="px-3 py-2 text-right">Cmd</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {logs.map((entry) => (
                          <tr key={entry.id} className="hover:bg-white/[0.02]">
                            <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                              {new Date(entry.ts).toLocaleTimeString()}
                            </td>
                            <td className="px-3 py-2 text-slate-400">#{entry.seq}</td>
                            <td
                              className={`px-3 py-2 ${
                                entry.status === 'failsafe'
                                  ? 'text-rose-400 font-semibold'
                                  : entry.status === 'rejected'
                                    ? 'text-amber-400'
                                    : 'text-slate-200'
                              }`}
                            >
                              {entry.summary}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-300">
                              {entry.commandedSpeed}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </main>
  );
}
