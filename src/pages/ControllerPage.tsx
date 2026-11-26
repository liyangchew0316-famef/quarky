import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Lightbulb,
  Link2Off,
  Lock,
  OctagonAlert,
  RotateCcw,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { AcceleratorPedal, BrakePedal } from '../components/PedalControl';
import { SpeedometerGauge } from '../components/SpeedometerGauge';
import { SteeringWheel } from '../components/SteeringWheel';
import { startHornAudio, stopHornAudio } from '../lib/audio';
import {
  PROTOCOL_LIMITS,
  clampNumber,
  resolveCommandWithStopPriority,
  type ControlPayload,
  type GearPosition,
  type HostMode,
  type SessionSnapshot,
  type SteerDirection,
} from '../shared/protocol';

interface ControllerPageProps {
  search: string;
  onNavigate: (to: string) => void;
}

type LinkStatus = 'unpaired' | 'ui_preview' | 'connecting' | 'connected' | 'disconnected' | 'error';

export function ControllerPage({ search, onNavigate }: ControllerPageProps) {
  const initialCode = useMemo(() => {
    const params = new URLSearchParams(search);
    return (params.get('code') || '').toUpperCase().slice(0, 7);
  }, [search]);

  // Pairing & authenticated session state (held in React memory only, never localStorage)
  const [pairingInput, setPairingInput] = useState(initialCode);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [isPairing, setIsPairing] = useState(false);

  const [linkStatus, setLinkStatus] = useState<LinkStatus>('unpaired');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hostMode, setHostMode] = useState<HostMode | null>(null);
  const [hostLabel, setHostLabel] = useState<string>('');
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Ready to pair');
  const [audioMuted, setAudioMuted] = useState(false);

  // Local tactile control state
  const [gear, setGear] = useState<GearPosition>('N');
  const [throttle, setThrottle] = useState<number>(0);
  const [brake, setBrake] = useState<boolean>(false);
  const [steer, setSteer] = useState<SteerDirection>('center');
  const [steerAngle, setSteerAngle] = useState<number>(0);
  const [speedLimit, setSpeedLimit] = useState<number>(60);
  const [horn, setHorn] = useState<boolean>(false);
  const [headlights, setHeadlights] = useState<boolean>(false);
  const [emergencyStop, setEmergencyStop] = useState<boolean>(false);

  // Latest payload ref for heartbeats & emergency safety callbacks
  const stateRef = useRef<ControlPayload>({
    gear: 'N',
    throttle: 0,
    brake: false,
    steer: 'center',
    steerAngle: 0,
    speedLimit: 60,
    horn: false,
    headlights: false,
    emergencyStop: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const seqRef = useRef<number>(1);
  const tokenRef = useRef<string | null>(null);
  const linkStatusRef = useRef<LinkStatus>('unpaired');

  useEffect(() => {
    linkStatusRef.current = linkStatus;
  }, [linkStatus]);

  useEffect(() => {
    stateRef.current = {
      gear,
      throttle,
      brake,
      steer,
      steerAngle,
      speedLimit,
      horn,
      headlights,
      emergencyStop,
    };
  }, [gear, throttle, brake, steer, steerAngle, speedLimit, horn, headlights, emergencyStop]);

  // Horn audio synthesis
  useEffect(() => {
    if (horn) {
      startHornAudio(audioMuted);
    } else {
      stopHornAudio();
    }
    return () => stopHornAudio();
  }, [horn, audioMuted]);

  const sendFrame = useCallback((frame: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(frame));
  }, []);

  const transmitControl = useCallback(
    (nextPayload: ControlPayload) => {
      if (linkStatusRef.current !== 'connected') return;
      const seq = seqRef.current++;
      sendFrame({
        type: 'control',
        seq,
        ts: Date.now(),
        payload: nextPayload,
      });
    },
    [sendFrame]
  );

  // Immediately force STOP + release active pedals/steering (safety handler)
  const triggerFailSafeRelease = useCallback(
    (reason: string, latchEStop = false) => {
      stopHornAudio();
      setThrottle(0);
      setSteer('center');
      setSteerAngle(0);
      setHorn(false);
      setBrake(latchEStop);
      if (latchEStop) {
        setEmergencyStop(true);
        setGear('N');
      }

      const stopPayload: ControlPayload = {
        ...stateRef.current,
        gear: latchEStop ? 'N' : stateRef.current.gear,
        throttle: 0,
        brake: latchEStop,
        steer: 'center',
        steerAngle: 0,
        horn: false,
        emergencyStop: latchEStop,
      };
      stateRef.current = stopPayload;
      transmitControl(stopPayload);
      if (latchEStop) {
        setStatusMessage(reason);
      }
    },
    [transmitControl]
  );

  // Global browser safety listeners: page hide, blur, beforeunload
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        triggerFailSafeRelease('Page hidden — STOP sent', true);
      }
    };
    const onBlur = () => {
      triggerFailSafeRelease('Window lost focus — STOP sent', false);
    };
    const onPageHide = () => {
      triggerFailSafeRelease('Page unloaded — STOP sent', true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [triggerFailSafeRelease]);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        try {
          wsRef.current.close(1000, 'Controller unmounted');
        } catch {
          // ignore
        }
      }
    };
  }, []);

  // Heartbeat loop while connected
  useEffect(() => {
    if (linkStatus !== 'connected') return;
    const timer = window.setInterval(() => {
      const seq = seqRef.current++;
      sendFrame({
        type: 'heartbeat',
        seq,
        ts: Date.now(),
      });
    }, PROTOCOL_LIMITS.HEARTBEAT_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [linkStatus, sendFrame]);

  // Helper to update a subset of controls and immediately transmit
  const updateControls = useCallback(
    (patch: Partial<ControlPayload>) => {
      const prev = stateRef.current;
      // If emergency stop is latched, block motion inputs until explicitly reset
      if (prev.emergencyStop && patch.emergencyStop !== false) {
        const safePatch: Partial<ControlPayload> = {
          ...patch,
          throttle: 0,
          steer: 'center',
          steerAngle: 0,
          brake: true,
        };
        const next: ControlPayload = {
          ...prev,
          ...safePatch,
          speedLimit: clampNumber(safePatch.speedLimit ?? prev.speedLimit, 0, 100, 60),
        };
        setSpeedLimit(next.speedLimit);
        if (patch.headlights !== undefined) setHeadlights(next.headlights);
        stateRef.current = next;
        transmitControl(next);
        return;
      }

      const next: ControlPayload = {
        ...prev,
        ...patch,
        throttle: clampNumber(patch.throttle ?? prev.throttle, 0, 100, 0),
        speedLimit: clampNumber(patch.speedLimit ?? prev.speedLimit, 0, 100, 60),
        steerAngle: clampNumber(patch.steerAngle ?? prev.steerAngle, -100, 100, 0),
      };

      if (next.emergencyStop) {
        next.throttle = 0;
        next.steer = 'center';
        next.steerAngle = 0;
        next.brake = true;
        next.horn = false;
      }

      setGear(next.gear);
      setThrottle(next.throttle);
      setBrake(next.brake);
      setSteer(next.steer);
      setSteerAngle(next.steerAngle);
      setSpeedLimit(next.speedLimit);
      setHorn(next.horn);
      setHeadlights(next.headlights);
      setEmergencyStop(next.emergencyStop);

      stateRef.current = next;
      transmitControl(next);
    },
    [transmitControl]
  );

  // Keyboard bindings for desktop browser control
  useEffect(() => {
    const activeKeys = new Set<string>();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (linkStatusRef.current === 'unpaired') return;
      const k = e.key.toLowerCase();
      if (activeKeys.has(k)) return;
      activeKeys.add(k);

      if (k === ' ') {
        e.preventDefault();
        triggerFailSafeRelease('Spacebar EMERGENCY STOP', true);
        return;
      }
      if (k === 'w' || k === 'arrowup') {
        e.preventDefault();
        const g = stateRef.current.gear === 'N' ? 'D' : stateRef.current.gear;
        updateControls({ gear: g, throttle: 100, brake: false });
      } else if (k === 's' || k === 'arrowdown') {
        e.preventDefault();
        updateControls({ brake: true, throttle: 0 });
      } else if (k === 'a' || k === 'arrowleft') {
        e.preventDefault();
        updateControls({ steer: 'left', steerAngle: -100 });
      } else if (k === 'd' || k === 'arrowright') {
        e.preventDefault();
        updateControls({ steer: 'right', steerAngle: 100 });
      } else if (k === 'h') {
        updateControls({ horn: true });
      } else if (k === 'l') {
        updateControls({ headlights: !stateRef.current.headlights });
      } else if (k === '1') {
        updateControls({ gear: 'R', throttle: 0 });
      } else if (k === '2') {
        updateControls({ gear: 'N', throttle: 0 });
      } else if (k === '3') {
        updateControls({ gear: 'D' });
      } else if (k === '[' || k === '-') {
        updateControls({ speedLimit: clampNumber(stateRef.current.speedLimit - 10, 0, 100, 60) });
      } else if (k === ']' || k === '=') {
        updateControls({ speedLimit: clampNumber(stateRef.current.speedLimit + 10, 0, 100, 60) });
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      activeKeys.delete(k);
      if (linkStatusRef.current === 'unpaired') return;

      if (k === 'w' || k === 'arrowup') {
        updateControls({ throttle: 0 });
      } else if (k === 's' || k === 'arrowdown') {
        updateControls({ brake: false });
      } else if (k === 'a' || k === 'arrowleft' || k === 'd' || k === 'arrowright') {
        updateControls({ steer: 'center', steerAngle: 0 });
      } else if (k === 'h') {
        updateControls({ horn: false });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [triggerFailSafeRelease, updateControls]);

  async function handlePairSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPairingError(null);
    setIsPairing(true);

    try {
      const resp = await fetch('/api/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pairingCode: pairingInput }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setPairingError(data.error || 'Pairing failed.');
        setIsPairing(false);
        return;
      }

      tokenRef.current = data.controllerToken;
      setSessionId(data.sessionId);
      setHostMode(data.mode);
      setHostLabel(data.hostLabel || 'Host');
      setLinkStatus('connecting');
      setStatusMessage('Authenticating WebSocket relay...');

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
      wsRef.current = ws;
      seqRef.current = 1;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'auth:controller',
            sessionId: data.sessionId,
            token: data.controllerToken,
          })
        );
        setLinkStatus('connected');
        setStatusMessage(
          data.mode === 'hardware'
            ? 'Paired with Windows Host Bridge (Verify physical motion carefully)'
            : 'Paired with Simulated Browser Host'
        );
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'session:state' && msg.snapshot) {
            setSnapshot(msg.snapshot);
          } else if (msg.type === 'rejected') {
            setStatusMessage(`Command rejected: ${msg.error}`);
          } else if (msg.type === 'error') {
            setStatusMessage(msg.message || 'Relay error');
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = (ev) => {
        wsRef.current = null;
        tokenRef.current = null;
        setThrottle(0);
        setSteer('center');
        setSteerAngle(0);
        setBrake(true);
        setEmergencyStop(true);
        setGear('N');
        setLinkStatus('disconnected');
        setStatusMessage(ev.reason ? `Disconnected: ${ev.reason}` : 'Connection closed — STOP activated');
      };

      ws.onerror = () => {
        setStatusMessage('WebSocket transport error — STOP activated');
      };
    } catch {
      setPairingError('Network error while reaching the relay server.');
    } finally {
      setIsPairing(false);
    }
  }

  function handleDisconnect() {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const seq = seqRef.current++;
      sendFrame({
        type: 'disconnect',
        seq,
        ts: Date.now(),
        reason: 'Operator pressed Disconnect',
      });
      wsRef.current.close(1000, 'Operator disconnected');
    }
    wsRef.current = null;
    tokenRef.current = null;
    setSnapshot(null);
    setSessionId(null);
    setHostMode(null);
    setThrottle(0);
    setSteer('center');
    setSteerAngle(0);
    setGear('N');
    setEmergencyStop(false);
    setLinkStatus('unpaired');
    setStatusMessage('Disconnected cleanly');
  }

  const resolvedLocal = resolveCommandWithStopPriority(stateRef.current, seqRef.current);

  // Pairing Screen when unpaired
  if (linkStatus === 'unpaired') {
    return (
      <main className="mx-auto flex min-h-[calc(100vh-80px)] max-w-3xl items-center justify-center px-4 py-10">
        <div className="ets-panel w-full rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold tracking-widest text-amber-400">
              AUTHENTICATED CONTROLLER PAIRING
            </p>
            <h1 className="font-display text-3xl font-bold text-white">
              Connect to Quarky Host
            </h1>
            <p className="text-sm text-slate-300">
              Enter the 6-character pairing code from your Desktop Dashboard (<span className="font-mono text-slate-200">/dashboard</span>) or Windows Bridge terminal. Codes expire after 5 minutes and work once.
            </p>
          </div>

          <form onSubmit={handlePairSubmit} className="space-y-4">
            <div>
              <label htmlFor="pairing-code" className="block text-xs font-semibold text-slate-300 mb-2">
                6-Character Pairing Code
              </label>
              <input
                id="pairing-code"
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="ABC-123"
                value={pairingInput}
                onChange={(e) => setPairingInput(e.target.value.toUpperCase())}
                className="w-full rounded-xl border border-white/15 bg-[#0D1014] px-4 py-3.5 text-center font-mono-tabular text-2xl font-bold tracking-[0.25em] text-amber-400 placeholder:text-slate-600 focus:border-amber-400 focus:outline-none"
                maxLength={7}
                required
              />
            </div>

            {pairingError && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-4 py-2.5 text-xs text-rose-200">
                {pairingError}
              </div>
            )}

            <button
              type="submit"
              disabled={isPairing || pairingInput.replace(/[^A-Z0-9]/g, '').length < 6}
              className="w-full rounded-xl bg-amber-500 py-3.5 text-sm font-bold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isPairing ? 'Verifying Pairing Code...' : 'Pair & Open Controller'}
            </button>
          </form>

          <div className="border-t border-white/10 pt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-slate-400">
              Want to inspect the cockpit UI without a host running?
            </div>
            <button
              type="button"
              onClick={() => {
                setLinkStatus('ui_preview');
                setStatusMessage('UI Preview Mode — commands stay in browser');
              }}
              className="whitespace-nowrap shrink-0 rounded-lg border border-white/15 px-4 py-2 text-xs font-semibold text-slate-200 hover:border-amber-400/50 hover:text-amber-300"
            >
              Open UI Preview Mode
            </button>
          </div>
        </div>
      </main>
    );
  }

  const hostOnline = snapshot?.hostConnected ?? false;
  const isPreview = linkStatus === 'ui_preview';

  return (
    <main className="mx-auto flex min-h-[calc(100vh-70px)] max-w-[1360px] flex-col justify-between gap-3 px-3 py-3 sm:px-5 sm:py-4">
      {/* Compact Instrument Status Strip */}
      <section className="ets-recessed flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            {linkStatus === 'connected' ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-amber-400" />
            )}
            <span className="font-semibold text-white">
              {isPreview
                ? 'UI PREVIEW ONLY · NO ROBOT'
                : linkStatus === 'connected'
                  ? hostMode === 'hardware'
                    ? 'RELAY LIVE · WINDOWS BRIDGE'
                    : 'RELAY LIVE · SIMULATED HOST'
                  : 'RELAY DISCONNECTED · SAFE STOP'}
            </span>
          </div>

          {!isPreview && (
            <>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className={hostOnline ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                Host: {hostOnline ? `Online (${hostLabel})` : 'Waiting for Host'}
              </span>
              <span className="text-slate-600" aria-hidden="true">·</span>
              <span className="font-mono-tabular text-slate-400">
                Session {sessionId} · Seq #{seqRef.current}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5">
          <span className="hidden lg:inline text-slate-400">{statusMessage}</span>
          <button
            type="button"
            onClick={() => setAudioMuted((m) => !m)}
            aria-label={audioMuted ? 'Unmute horn sound' : 'Mute horn sound'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#171C23] px-2.5 py-1.5 text-xs text-slate-300 hover:text-white"
          >
            {audioMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">{audioMuted ? 'Muted' : 'Audio'}</span>
          </button>

          {isPreview ? (
            <button
              type="button"
              onClick={() => setLinkStatus('unpaired')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Lock className="h-3.5 w-3.5" />
              <span>Pair Host</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-900/50"
            >
              <Link2Off className="h-3.5 w-3.5" />
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </section>

      {/* Main ETS2 3-Column Simulator Cockpit (Stacks cleanly in Portrait, 3-Column Bezel in Landscape/Desktop) */}
      <section className="ets-panel grid flex-1 grid-cols-1 gap-4 rounded-2xl p-3 sm:p-5 lg:grid-cols-12 lg:items-stretch">
        {/* LEFT PANEL: Virtual Steering Wheel + L/Headlight/R + Horn */}
        <div className="ets-recessed flex flex-col items-center justify-between gap-4 rounded-xl p-4 lg:col-span-4">
          <div className="w-full flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-400">
            <span>STEERING UNIT</span>
            <span className="font-mono-tabular text-amber-400">
              {steer === 'center' ? 'STRAIGHT' : steer.toUpperCase()}
            </span>
          </div>

          <SteeringWheel
            steer={steer}
            steerAngle={steerAngle}
            disabled={emergencyStop}
            onSteerChange={(nextSteer, nextAngle) =>
              updateControls({ steer: nextSteer, steerAngle: nextAngle })
            }
          />

          {/* Tactile Left / Headlights / Right cluster */}
          <div className="w-full max-w-xs space-y-2.5">
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                aria-label="Steer Left"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateControls({ steer: 'left', steerAngle: -100 });
                }}
                onPointerUp={() => updateControls({ steer: 'center', steerAngle: 0 })}
                onPointerCancel={() => updateControls({ steer: 'center', steerAngle: 0 })}
                onLostPointerCapture={() => updateControls({ steer: 'center', steerAngle: 0 })}
                className={`touch-control flex min-h-[54px] flex-col items-center justify-center rounded-xl border text-xs font-semibold transition-all ${
                  steer === 'left'
                    ? 'border-emerald-400 bg-emerald-950/45 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
                    : 'border-white/10 bg-[#171C23] text-slate-300 hover:border-white/25'
                }`}
              >
                <ArrowLeft className="h-5 w-5" />
                <span className="mt-0.5 text-[10px]">LEFT</span>
              </button>

              <button
                type="button"
                aria-label="Toggle Headlights"
                aria-pressed={headlights}
                onClick={() => updateControls({ headlights: !headlights })}
                className={`flex min-h-[54px] flex-col items-center justify-center rounded-xl border text-xs font-semibold transition-all ${
                  headlights
                    ? 'border-amber-400 bg-amber-500/20 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.35)]'
                    : 'border-white/10 bg-[#171C23] text-slate-300 hover:border-amber-400/40'
                }`}
              >
                <Lightbulb className="h-5 w-5" />
                <span className="mt-0.5 text-[10px]">{headlights ? 'LIGHTS ON' : 'LIGHTS'}</span>
              </button>

              <button
                type="button"
                aria-label="Steer Right"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateControls({ steer: 'right', steerAngle: 100 });
                }}
                onPointerUp={() => updateControls({ steer: 'center', steerAngle: 0 })}
                onPointerCancel={() => updateControls({ steer: 'center', steerAngle: 0 })}
                onLostPointerCapture={() => updateControls({ steer: 'center', steerAngle: 0 })}
                className={`touch-control flex min-h-[54px] flex-col items-center justify-center rounded-xl border text-xs font-semibold transition-all ${
                  steer === 'right'
                    ? 'border-emerald-400 bg-emerald-950/45 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
                    : 'border-white/10 bg-[#171C23] text-slate-300 hover:border-white/25'
                }`}
              >
                <ArrowRight className="h-5 w-5" />
                <span className="mt-0.5 text-[10px]">RIGHT</span>
              </button>
            </div>

            {/* Wide HONK bar */}
            <button
              type="button"
              aria-label="Horn (Press and hold)"
              onPointerDown={(e) => {
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                updateControls({ horn: true });
              }}
              onPointerUp={() => updateControls({ horn: false })}
              onPointerCancel={() => updateControls({ horn: false })}
              onLostPointerCapture={() => updateControls({ horn: false })}
              className={`touch-control flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-xl border text-sm font-bold tracking-wider transition-all ${
                horn
                  ? 'border-amber-300 bg-amber-500/25 text-amber-200 shadow-[0_0_20px_rgba(245,158,11,0.35)]'
                  : 'border-amber-500/60 bg-[#171C23] text-amber-400 hover:border-amber-400'
              }`}
            >
              <Volume2 className="h-5 w-5" />
              <span>HONK</span>
            </button>
          </div>
        </div>

        {/* CENTER PANEL: Headlights status + R/N/D Gear Selector + Speedometer + Limiter + E-STOP */}
        <div className="ets-recessed flex flex-col items-center justify-between gap-4 rounded-xl p-4 lg:col-span-4">
          {/* Top row: Headlight indicator + R/N/D Gear Selector */}
          <div className="flex w-full items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => updateControls({ headlights: !headlights })}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-all ${
                headlights
                  ? 'border-amber-400 bg-amber-500/20 text-amber-300'
                  : 'border-white/15 bg-[#171C23] text-slate-300 hover:border-amber-400/50'
              }`}
            >
              <Lightbulb className="h-4 w-4" />
              <span>{headlights ? 'BEAM ON' : 'BEAM OFF'}</span>
            </button>

            <div className="flex items-center rounded-lg border border-white/10 bg-[#0c0f14] p-1" role="group" aria-label="Gear Selector">
              {(['R', 'N', 'D'] as GearPosition[]).map((g) => {
                const active = gear === g;
                return (
                  <button
                    key={g}
                    type="button"
                    onClick={() => {
                      if (emergencyStop) return;
                      updateControls({ gear: g, throttle: g === 'N' ? 0 : throttle });
                    }}
                    className={`min-h-[38px] min-w-[44px] rounded-md font-display text-base font-bold transition-colors ${
                      active
                        ? g === 'D'
                          ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-400/70'
                          : g === 'R'
                            ? 'bg-amber-500/25 text-amber-300 border border-amber-400/70'
                            : 'bg-slate-700/60 text-white border border-white/25'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {g}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Speedometer */}
          <SpeedometerGauge
            commandedSpeed={resolvedLocal.commandedSpeed}
            speedLimit={speedLimit}
            gear={gear}
            emergencyStop={emergencyStop}
            brake={brake}
          />

          {/* Adjustable Speed Limiter (0-100%) */}
          <div className="w-full max-w-xs space-y-1.5 rounded-xl border border-white/10 bg-[#141921] px-3.5 py-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-400">SPEED LIMITER</span>
              <span className="font-mono-tabular font-bold text-white">{speedLimit}%</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Decrease speed limit"
                onClick={() => updateControls({ speedLimit: clampNumber(speedLimit - 10, 0, 100, 60) })}
                className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-[#1b222c] text-xs font-bold text-slate-200 hover:border-amber-400/60"
              >
                -10
              </button>
              <input
                type="range"
                aria-label="Speed Limiter Percentage"
                min={0}
                max={100}
                step={5}
                value={speedLimit}
                onChange={(e) => updateControls({ speedLimit: Number(e.target.value) })}
                className="h-2 w-full cursor-pointer accent-amber-500"
              />
              <button
                type="button"
                aria-label="Increase speed limit"
                onClick={() => updateControls({ speedLimit: clampNumber(speedLimit + 10, 0, 100, 60) })}
                className="min-h-[36px] min-w-[36px] rounded-lg border border-white/10 bg-[#1b222c] text-xs font-bold text-slate-200 hover:border-amber-400/60"
              >
                +10
              </button>
            </div>
          </div>

          {/* EMERGENCY STOP + Reset Latch */}
          <div className="w-full max-w-xs space-y-2">
            <button
              type="button"
              onClick={() => triggerFailSafeRelease('Operator pressed EMERGENCY STOP', true)}
              className={`flex min-h-[64px] w-full items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 py-3 text-base font-bold tracking-wider transition-all ${
                emergencyStop
                  ? 'border-rose-400 bg-rose-600 text-white shadow-[0_0_28px_rgba(239,68,68,0.6)]'
                  : 'border-rose-500/80 bg-rose-950/45 text-rose-100 hover:bg-rose-900/60 shadow-[0_0_18px_rgba(239,68,68,0.25)]'
              }`}
            >
              <OctagonAlert className="h-6 w-6 shrink-0" />
              <span>{emergencyStop ? 'E-STOP LATCHED' : 'EMERGENCY STOP'}</span>
            </button>

            {emergencyStop && (
              <button
                type="button"
                onClick={() => {
                  updateControls({ emergencyStop: false, brake: false, throttle: 0, gear: 'N' });
                  setStatusMessage('E-STOP cleared — shift to D or R to drive');
                }}
                className="flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg border border-amber-400/50 bg-amber-500/15 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Release E-Stop Latch (Stays in Neutral)</span>
              </button>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Brake & Accelerator Pedals */}
        <div className="ets-recessed flex flex-col items-center justify-between gap-4 rounded-xl p-4 lg:col-span-4">
          <div className="w-full flex items-center justify-between text-[11px] font-semibold tracking-wider text-slate-400">
            <span>PEDAL BOX</span>
            <span className="font-mono-tabular text-slate-300">
              {brake
                ? 'BRAKE APPLIED'
                : gear === 'N'
                  ? 'SHIFT TO D OR R'
                  : `CMD ${resolvedLocal.commandedSpeed}%`}
            </span>
          </div>

          <div className="flex w-full items-end justify-center gap-5 sm:gap-7 py-2">
            <BrakePedal
              active={brake}
              onChange={(pressed) => updateControls({ brake: pressed, throttle: pressed ? 0 : throttle })}
            />
            <AcceleratorPedal
              value={throttle}
              disabled={gear === 'N' || brake || emergencyStop}
              onChange={(val) => updateControls({ throttle: val })}
            />
          </div>

          <div className="w-full rounded-lg border border-white/10 bg-[#12161d] px-3 py-2 text-[11px] text-slate-400 flex items-center justify-between">
            <span>
              {gear === 'N' ? (
                <span className="inline-flex items-center gap-1.5 text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Select D or R before pressing Accelerator
                </span>
              ) : (
                <span>Release pedal or switch tab to auto-STOP</span>
              )}
            </span>
            <button
              type="button"
              onClick={() => onNavigate('/dashboard')}
              className="hidden sm:inline text-amber-400 hover:underline whitespace-nowrap ml-2"
            >
              Dashboard
            </button>
          </div>
        </div>
      </section>

      {/* Desktop Keyboard Reference */}
      <footer className="hidden lg:flex items-center justify-between px-1 text-[11px] text-slate-400 font-mono-tabular">
        <span>Keys: W/↑ Gas · S/↓ Brake · A/D or ←/→ Steer · 1/2/3 Gear R/N/D · Space E-STOP · H Horn · L Lights · [-/+] Speed Limit</span>
        <span>Motion State: {resolvedLocal.motionState}</span>
      </footer>
    </main>
  );
}
