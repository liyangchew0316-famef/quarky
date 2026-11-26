export type GearPosition = 'R' | 'N' | 'D';
export type SteerDirection = 'left' | 'right' | 'center';
export type HostMode = 'hardware' | 'simulated';
export type OperationalState = 'ui_only' | 'simulated_relay' | 'hardware_bridge_unverified';

export interface ControlPayload {
  gear: GearPosition;
  throttle: number; // 0..100 clamped
  brake: boolean;
  steer: SteerDirection;
  steerAngle: number; // -100..100 clamped
  speedLimit: number; // 0..100 clamped
  horn: boolean;
  headlights: boolean;
  emergencyStop: boolean;
}

export interface ControlMessage {
  type: 'control';
  seq: number;
  ts: number;
  payload: ControlPayload;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  seq: number;
  ts: number;
}

export interface DisconnectMessage {
  type: 'disconnect';
  seq: number;
  ts: number;
  reason?: string;
}

export type ClientProtocolMessage = ControlMessage | HeartbeatMessage | DisconnectMessage;

export interface ResolvedCommandState {
  commandedSpeed: number; // 0..100 effective commanded speed sent to robot
  speedLimit: number; // 0..100
  gear: GearPosition;
  steer: SteerDirection;
  steerAngle: number;
  throttle: number;
  brake: boolean;
  horn: boolean;
  headlights: boolean;
  emergencyStop: boolean;
  motionState: 'STOPPED' | 'FORWARD' | 'REVERSE' | 'NEUTRAL' | 'FAILSAFE_STOP';
  failSafeReason: string | null;
  seq: number;
  updatedAt: number;
}

export interface SessionSnapshot {
  sessionId: string;
  mode: HostMode;
  hostConnected: boolean;
  hostLabel: string;
  controllerConnected: boolean;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  lastHeartbeatAt: number | null;
  lastCommandAt: number | null;
  commandRatePerSec: number;
  rejectedCount: number;
  commandState: ResolvedCommandState;
  hardwareVerified: boolean;
}

export interface CommandLogEntry {
  id: string;
  ts: number;
  seq: number;
  source: 'controller' | 'relay_watchdog' | 'system';
  summary: string;
  status: 'accepted' | 'rejected' | 'failsafe';
  commandedSpeed: number;
  gear: GearPosition;
  steer: SteerDirection;
}

export const PROTOCOL_LIMITS = {
  MIN_SPEED: 0,
  MAX_SPEED: 100,
  HEARTBEAT_INTERVAL_MS: 250,
  SERVER_WATCHDOG_MS: 850,
  BRIDGE_WATCHDOG_MS: 600,
  MAX_CLOCK_SKEW_MS: 15000,
  PAIRING_TTL_MS: 5 * 60 * 1000,
  WS_MAX_COMMANDS_PER_SEC: 50,
} as const;

export function clampNumber(value: unknown, min: number, max: number, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function createNeutralPayload(speedLimit = 60, headlights = false): ControlPayload {
  return {
    gear: 'N',
    throttle: 0,
    brake: false,
    steer: 'center',
    steerAngle: 0,
    speedLimit: clampNumber(speedLimit, PROTOCOL_LIMITS.MIN_SPEED, PROTOCOL_LIMITS.MAX_SPEED, 60),
    horn: false,
    headlights,
    emergencyStop: false,
  };
}

export function createInitialResolvedState(): ResolvedCommandState {
  return {
    commandedSpeed: 0,
    speedLimit: 60,
    gear: 'N',
    steer: 'center',
    steerAngle: 0,
    throttle: 0,
    brake: false,
    horn: false,
    headlights: false,
    emergencyStop: false,
    motionState: 'STOPPED',
    failSafeReason: null,
    seq: 0,
    updatedAt: Date.now(),
  };
}

/**
 * Resolves a validated payload using strict STOP priority:
 * 1. emergencyStop === true -> immediate STOP (speed 0, steer center, throttle 0)
 * 2. brake === true -> immediate STOP (speed 0, throttle 0)
 * 3. gear === 'N' -> NEUTRAL (speed 0, throttle 0)
 * 4. throttle === 0 -> STOPPED (speed 0)
 * 5. Otherwise commandedSpeed = round((throttle / 100) * speedLimit), clamped 0..100.
 */
export function resolveCommandWithStopPriority(
  payload: ControlPayload,
  seq: number,
  now = Date.now(),
  failSafeReason: string | null = null
): ResolvedCommandState {
  const speedLimit = clampNumber(payload.speedLimit, 0, 100, 60);
  const throttle = clampNumber(payload.throttle, 0, 100, 0);
  const steerAngle = clampNumber(payload.steerAngle, -100, 100, 0);

  if (failSafeReason) {
    return {
      commandedSpeed: 0,
      speedLimit,
      gear: 'N',
      steer: 'center',
      steerAngle: 0,
      throttle: 0,
      brake: true,
      horn: false,
      headlights: payload.headlights,
      emergencyStop: true,
      motionState: 'FAILSAFE_STOP',
      failSafeReason,
      seq,
      updatedAt: now,
    };
  }

  if (payload.emergencyStop) {
    return {
      commandedSpeed: 0,
      speedLimit,
      gear: payload.gear,
      steer: 'center',
      steerAngle: 0,
      throttle: 0,
      brake: true,
      horn: Boolean(payload.horn),
      headlights: Boolean(payload.headlights),
      emergencyStop: true,
      motionState: 'STOPPED',
      failSafeReason: null,
      seq,
      updatedAt: now,
    };
  }

  if (payload.brake) {
    return {
      commandedSpeed: 0,
      speedLimit,
      gear: payload.gear,
      steer: payload.steer,
      steerAngle,
      throttle: 0,
      brake: true,
      horn: Boolean(payload.horn),
      headlights: Boolean(payload.headlights),
      emergencyStop: false,
      motionState: 'STOPPED',
      failSafeReason: null,
      seq,
      updatedAt: now,
    };
  }

  if (payload.gear === 'N') {
    return {
      commandedSpeed: 0,
      speedLimit,
      gear: 'N',
      steer: payload.steer,
      steerAngle,
      throttle: 0,
      brake: false,
      horn: Boolean(payload.horn),
      headlights: Boolean(payload.headlights),
      emergencyStop: false,
      motionState: 'NEUTRAL',
      failSafeReason: null,
      seq,
      updatedAt: now,
    };
  }

  const commandedSpeed = clampNumber((throttle / 100) * speedLimit, 0, 100, 0);
  const motionState =
    commandedSpeed === 0
      ? 'STOPPED'
      : payload.gear === 'D'
        ? 'FORWARD'
        : 'REVERSE';

  return {
    commandedSpeed,
    speedLimit,
    gear: payload.gear,
    steer: payload.steer,
    steerAngle,
    throttle,
    brake: false,
    horn: Boolean(payload.horn),
    headlights: Boolean(payload.headlights),
    emergencyStop: false,
    motionState,
    failSafeReason: null,
    seq,
    updatedAt: now,
  };
}

export type ValidationResult =
  | { ok: true; message: ClientProtocolMessage }
  | { ok: false; error: string };

export function validateClientMessage(
  raw: unknown,
  lastSeq: number,
  now = Date.now()
): ValidationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Malformed JSON object' };
  }

  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (type !== 'control' && type !== 'heartbeat' && type !== 'disconnect') {
    return { ok: false, error: 'Unsupported message type' };
  }

  const seq = obj.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return { ok: false, error: 'Invalid sequence number' };
  }

  if (seq <= lastSeq) {
    return { ok: false, error: `Stale sequence number (${seq} <= ${lastSeq})` };
  }

  const ts = obj.ts;
  if (typeof ts !== 'number' || !Number.isFinite(ts)) {
    return { ok: false, error: 'Invalid timestamp' };
  }

  if (Math.abs(now - ts) > PROTOCOL_LIMITS.MAX_CLOCK_SKEW_MS) {
    return { ok: false, error: 'Stale command timestamp outside allowed window' };
  }

  if (type === 'heartbeat') {
    return { ok: true, message: { type: 'heartbeat', seq, ts } };
  }

  if (type === 'disconnect') {
    const reason = typeof obj.reason === 'string' ? obj.reason.slice(0, 120) : undefined;
    return { ok: true, message: { type: 'disconnect', seq, ts, reason } };
  }

  const rawPayload = obj.payload;
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { ok: false, error: 'Missing control payload' };
  }

  const p = rawPayload as Record<string, unknown>;
  if (p.gear !== 'R' && p.gear !== 'N' && p.gear !== 'D') {
    return { ok: false, error: 'Invalid gear value' };
  }
  if (p.steer !== 'left' && p.steer !== 'right' && p.steer !== 'center') {
    return { ok: false, error: 'Invalid steer value' };
  }
  if (typeof p.throttle !== 'number' || !Number.isFinite(p.throttle)) {
    return { ok: false, error: 'Invalid throttle number' };
  }
  if (typeof p.speedLimit !== 'number' || !Number.isFinite(p.speedLimit)) {
    return { ok: false, error: 'Invalid speedLimit number' };
  }
  if (typeof p.brake !== 'boolean' || typeof p.horn !== 'boolean' || typeof p.headlights !== 'boolean' || typeof p.emergencyStop !== 'boolean') {
    return { ok: false, error: 'Invalid boolean control flags' };
  }

  const steerAngle =
    typeof p.steerAngle === 'number' && Number.isFinite(p.steerAngle)
      ? clampNumber(p.steerAngle, -100, 100, 0)
      : p.steer === 'left'
        ? -100
        : p.steer === 'right'
          ? 100
          : 0;

  return {
    ok: true,
    message: {
      type: 'control',
      seq,
      ts,
      payload: {
        gear: p.gear,
        throttle: clampNumber(p.throttle, 0, 100, 0),
        brake: p.brake,
        steer: p.steer,
        steerAngle,
        speedLimit: clampNumber(p.speedLimit, 0, 100, 60),
        horn: p.horn,
        headlights: p.headlights,
        emergencyStop: p.emergencyStop,
      },
    },
  };
}
