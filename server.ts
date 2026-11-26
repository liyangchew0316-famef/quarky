import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import {
  PROTOCOL_LIMITS,
  createInitialResolvedState,
  createNeutralPayload,
  resolveCommandWithStopPriority,
  validateClientMessage,
  type CommandLogEntry,
  type HostMode,
  type ResolvedCommandState,
  type SessionSnapshot,
} from './src/shared/protocol.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const BRIDGE_DIR = path.resolve(__dirname, 'windows_bridge');

const ALLOWED_BRIDGE_FILES = new Set([
  'quarky_bridge.py',
  'test_pictoblox_keys.py',
  'test_bridge_protocol.py',
  'requirements.txt',
  'README_WINDOWS.md',
]);

// ---------------------------------------------------------------------------
// Security & Token Helpers
// ---------------------------------------------------------------------------

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeCompareHex(aHex: string, bPlain: string): boolean {
  const bHex = sha256Hex(bPlain);
  const aBuf = Buffer.from(aHex, 'hex');
  const bBuf = Buffer.from(bHex, 'hex');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function safeComparePlain(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function generatePairingCode(): string {
  // Unambiguous uppercase alphanumeric characters (omits 0, O, 1, I, L)
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return `${out.slice(0, 3)}-${out.slice(3)}`;
}

function normalizePairingCode(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== 6) return '';
  return `${cleaned.slice(0, 3)}-${cleaned.slice(3)}`;
}

// ---------------------------------------------------------------------------
// Session Store & Rate Limiters
// ---------------------------------------------------------------------------

interface RelaySession {
  sessionId: string;
  mode: HostMode;
  hostLabel: string;
  hostTokenHash: string;
  monitorTokenHash: string;
  controllerTokenHash: string | null;
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  hostSocket: WebSocket | null;
  controllerSocket: WebSocket | null;
  monitorSockets: Set<WebSocket>;
  lastSeq: number;
  lastHeartbeatAt: number | null;
  lastCommandAt: number | null;
  rejectedCount: number;
  cmdTimestamps: number[];
  commandState: ResolvedCommandState;
  logs: CommandLogEntry[];
  createdAt: number;
}

const sessions = new Map<string, RelaySession>();
const pairingCodeIndex = new Map<string, string>(); // normalized pairingCode -> sessionId

const httpRateLimits = new Map<string, number[]>();

function checkHttpRateLimit(ip: string, maxPerMin = 30): boolean {
  const now = Date.now();
  const windowStart = now - 60_000;
  const recent = (httpRateLimits.get(ip) || []).filter((t) => t > windowStart);
  if (recent.length >= maxPerMin) {
    httpRateLimits.set(ip, recent);
    return false;
  }
  recent.push(now);
  httpRateLimits.set(ip, recent);
  return true;
}

function appendLog(session: RelaySession, entry: Omit<CommandLogEntry, 'id'>): void {
  session.logs.unshift({
    ...entry,
    id: `${entry.ts}-${Math.random().toString(36).slice(2, 7)}`,
  });
  if (session.logs.length > 60) {
    session.logs.length = 60;
  }
}

function toSnapshot(session: RelaySession): SessionSnapshot {
  const now = Date.now();
  const oneSecAgo = now - 1000;
  const recentCmds = session.cmdTimestamps.filter((t) => t > oneSecAgo);
  session.cmdTimestamps = recentCmds;

  const pairingValid =
    session.pairingCode !== null &&
    session.pairingExpiresAt !== null &&
    session.pairingExpiresAt > now;

  if (!pairingValid && session.pairingCode) {
    pairingCodeIndex.delete(session.pairingCode);
    session.pairingCode = null;
    session.pairingExpiresAt = null;
  }

  return {
    sessionId: session.sessionId,
    mode: session.mode,
    hostConnected: Boolean(session.hostSocket && session.hostSocket.readyState === WebSocket.OPEN),
    hostLabel: session.hostLabel,
    controllerConnected: Boolean(
      session.controllerSocket && session.controllerSocket.readyState === WebSocket.OPEN
    ),
    pairingCode: pairingValid ? session.pairingCode : null,
    pairingExpiresAt: pairingValid ? session.pairingExpiresAt : null,
    lastHeartbeatAt: session.lastHeartbeatAt,
    lastCommandAt: session.lastCommandAt,
    commandRatePerSec: recentCmds.length,
    rejectedCount: session.rejectedCount,
    commandState: session.commandState,
    hardwareVerified: false, // Explicitly false until verified on physical hardware
  };
}

function sendJson(ws: WebSocket | null | undefined, payload: unknown): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastSessionState(session: RelaySession): void {
  const snapshot = toSnapshot(session);
  const frame = {
    type: 'session:state',
    snapshot,
    logs: session.logs.slice(0, 20),
  };
  sendJson(session.hostSocket, frame);
  sendJson(session.controllerSocket, frame);
  for (const mon of session.monitorSockets) {
    sendJson(mon, frame);
  }
}

function forwardCommandToHost(session: RelaySession, state: ResolvedCommandState): void {
  sendJson(session.hostSocket, {
    type: 'command',
    state,
  });
}

function issueNewPairingCode(session: RelaySession): { pairingCode: string; pairingExpiresAt: number } {
  if (session.pairingCode) {
    pairingCodeIndex.delete(session.pairingCode);
  }
  let code = generatePairingCode();
  while (pairingCodeIndex.has(code)) {
    code = generatePairingCode();
  }
  const expiresAt = Date.now() + PROTOCOL_LIMITS.PAIRING_TTL_MS;
  session.pairingCode = code;
  session.pairingExpiresAt = expiresAt;
  pairingCodeIndex.set(code, session.sessionId);
  return { pairingCode: code, pairingExpiresAt: expiresAt };
}

function triggerFailSafeStop(session: RelaySession, reason: string): void {
  const now = Date.now();
  const neutral = createNeutralPayload(session.commandState.speedLimit, session.commandState.headlights);
  const nextSeq = session.lastSeq + 1;
  session.lastSeq = nextSeq;
  session.commandState = resolveCommandWithStopPriority(neutral, nextSeq, now, reason);
  appendLog(session, {
    ts: now,
    seq: nextSeq,
    source: 'relay_watchdog',
    summary: `FAIL-SAFE STOP: ${reason}`,
    status: 'failsafe',
    commandedSpeed: 0,
    gear: 'N',
    steer: 'center',
  });
  forwardCommandToHost(session, session.commandState);
  broadcastSessionState(session);
}

// ---------------------------------------------------------------------------
// Express App & Authenticated API Endpoints
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '32kb' }));

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, activeSessions: sessions.size, timestamp: Date.now() });
  });

  // Create a new Host Session (used by quarky_bridge.py or Browser Simulated Dashboard)
  app.post('/api/sessions', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkHttpRateLimit(ip, 25)) {
      res.status(429).json({ error: 'Too many session requests. Wait a minute and retry.' });
      return;
    }

    const modeRaw = req.body?.mode;
    const mode: HostMode = modeRaw === 'hardware' ? 'hardware' : 'simulated';

    const configuredHostKey = (process.env.HOST_API_KEY || '').trim();
    if (mode === 'hardware' && configuredHostKey.length > 0) {
      const provided = String(req.headers['x-host-key'] || '');
      if (!safeComparePlain(configuredHostKey, provided)) {
        res.status(401).json({ error: 'Invalid or missing HOST_API_KEY for hardware session.' });
        return;
      }
    }

    const hostLabelRaw = typeof req.body?.hostLabel === 'string' ? req.body.hostLabel.trim() : '';
    const hostLabel = (hostLabelRaw || (mode === 'hardware' ? 'Windows-PictoBlox-Host' : 'Browser-Simulated-Host')).slice(0, 64);

    const sessionId = `qk_${crypto.randomBytes(6).toString('hex')}`;
    const hostToken = generateToken();
    const monitorToken = generateToken();

    const session: RelaySession = {
      sessionId,
      mode,
      hostLabel,
      hostTokenHash: sha256Hex(hostToken),
      monitorTokenHash: sha256Hex(monitorToken),
      controllerTokenHash: null,
      pairingCode: null,
      pairingExpiresAt: null,
      hostSocket: null,
      controllerSocket: null,
      monitorSockets: new Set(),
      lastSeq: 0,
      lastHeartbeatAt: null,
      lastCommandAt: null,
      rejectedCount: 0,
      cmdTimestamps: [],
      commandState: createInitialResolvedState(),
      logs: [],
      createdAt: Date.now(),
    };

    const { pairingCode, pairingExpiresAt } = issueNewPairingCode(session);
    sessions.set(sessionId, session);

    appendLog(session, {
      ts: Date.now(),
      seq: 0,
      source: 'system',
      summary: `Session created (${mode === 'hardware' ? 'Windows Bridge' : 'Simulated Browser Host'})`,
      status: 'accepted',
      commandedSpeed: 0,
      gear: 'N',
      steer: 'center',
    });

    res.status(201).json({
      sessionId,
      mode,
      hostLabel,
      hostToken,
      monitorToken,
      pairingCode,
      pairingExpiresAt,
    });
  });

  // Exchange short-lived single-use pairing code for a controller session token
  app.post('/api/pair', (req, res) => {
    const ip = req.ip || 'unknown';
    if (!checkHttpRateLimit(ip, 20)) {
      res.status(429).json({ error: 'Too many pairing attempts. Wait 60 seconds.' });
      return;
    }

    const code = normalizePairingCode(req.body?.pairingCode);
    if (!code) {
      res.status(400).json({ error: 'Enter a valid 6-character pairing code (e.g. ABC-123).' });
      return;
    }

    const sessionId = pairingCodeIndex.get(code);
    if (!sessionId) {
      res.status(401).json({ error: 'Invalid or already used pairing code.' });
      return;
    }

    const session = sessions.get(sessionId);
    if (!session || !session.pairingExpiresAt || session.pairingExpiresAt < Date.now()) {
      pairingCodeIndex.delete(code);
      if (session) {
        session.pairingCode = null;
        session.pairingExpiresAt = null;
      }
      res.status(401).json({ error: 'Pairing code expired. Generate a new code on the host dashboard.' });
      return;
    }

    // Consume pairing code immediately (single-use)
    pairingCodeIndex.delete(code);
    session.pairingCode = null;
    session.pairingExpiresAt = null;

    // Revoke any previous controller session
    if (session.controllerSocket && session.controllerSocket.readyState === WebSocket.OPEN) {
      sendJson(session.controllerSocket, {
        type: 'error',
        message: 'Disconnected because a new controller paired with this host.',
      });
      session.controllerSocket.close(4009, 'Replaced by newly paired controller');
      session.controllerSocket = null;
    }

    const controllerToken = generateToken();
    session.controllerTokenHash = sha256Hex(controllerToken);
    session.lastSeq = 0;

    appendLog(session, {
      ts: Date.now(),
      seq: session.lastSeq,
      source: 'system',
      summary: 'Pairing code verified — single-use controller token issued',
      status: 'accepted',
      commandedSpeed: 0,
      gear: session.commandState.gear,
      steer: 'center',
    });

    broadcastSessionState(session);

    res.json({
      sessionId: session.sessionId,
      mode: session.mode,
      hostLabel: session.hostLabel,
      controllerToken,
    });
  });

  // Rotate pairing code (Host or Monitor authenticated)
  app.post('/api/sessions/:sessionId/rotate-code', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (
      !token ||
      (!safeCompareHex(session.hostTokenHash, token) &&
        !safeCompareHex(session.monitorTokenHash, token))
    ) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    const { pairingCode, pairingExpiresAt } = issueNewPairingCode(session);
    appendLog(session, {
      ts: Date.now(),
      seq: session.lastSeq,
      source: 'system',
      summary: 'Rotated short-lived pairing code',
      status: 'accepted',
      commandedSpeed: session.commandState.commandedSpeed,
      gear: session.commandState.gear,
      steer: session.commandState.steer,
    });
    broadcastSessionState(session);

    res.json({ pairingCode, pairingExpiresAt });
  });

  // Force disconnect active controller from dashboard / host
  app.post('/api/sessions/:sessionId/disconnect-controller', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }

    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (
      !token ||
      (!safeCompareHex(session.hostTokenHash, token) &&
        !safeCompareHex(session.monitorTokenHash, token))
    ) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }

    session.controllerTokenHash = null;
    if (session.controllerSocket && session.controllerSocket.readyState === WebSocket.OPEN) {
      sendJson(session.controllerSocket, {
        type: 'error',
        message: 'Controller disconnected by host dashboard.',
      });
      session.controllerSocket.close(4003, 'Disconnected by host');
      session.controllerSocket = null;
    }
    triggerFailSafeStop(session, 'Host revoked controller session');
    res.json({ ok: true });
  });

  // Fetch authenticated session snapshot
  app.get('/api/sessions/:sessionId/state', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found.' });
      return;
    }
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (
      !token ||
      (!safeCompareHex(session.hostTokenHash, token) &&
        !safeCompareHex(session.monitorTokenHash, token))
    ) {
      res.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    res.json({ snapshot: toSnapshot(session), logs: session.logs });
  });

  // Safe allowlisted download endpoint for Windows Host Bridge files
  app.get('/api/bridge-files/:filename', (req, res) => {
    const filename = req.params.filename;
    if (!ALLOWED_BRIDGE_FILES.has(filename)) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }
    const resolved = path.resolve(BRIDGE_DIR, filename);
    if (!resolved.startsWith(BRIDGE_DIR + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not available.' });
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(resolved);
  });

  // -------------------------------------------------------------------------
  // HTTP Server + Authenticated WebSocket Relay (/ws)
  // -------------------------------------------------------------------------

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    let authedRole: 'host' | 'controller' | 'monitor' | null = null;
    let authedSession: RelaySession | null = null;

    const authTimer = setTimeout(() => {
      if (!authedRole) {
        sendJson(ws, { type: 'error', message: 'Authentication timeout' });
        ws.close(4001, 'Authentication timeout');
      }
    }, 5000);

    ws.on('message', (data) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        sendJson(ws, { type: 'error', message: 'Malformed JSON' });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(ws, { type: 'error', message: 'Invalid message frame' });
        return;
      }

      const frame = parsed as Record<string, unknown>;

      // Step 1: Authenticate WebSocket connection
      if (!authedRole) {
        const type = frame.type;
        const sessionId = typeof frame.sessionId === 'string' ? frame.sessionId : '';
        const token = typeof frame.token === 'string' ? frame.token : '';
        const session = sessions.get(sessionId);

        if (!session || !token) {
          sendJson(ws, { type: 'error', message: 'Invalid session or token' });
          ws.close(4001, 'Unauthorized');
          return;
        }

        if (type === 'auth:host' && safeCompareHex(session.hostTokenHash, token)) {
          clearTimeout(authTimer);
          authedRole = 'host';
          authedSession = session;
          if (session.hostSocket && session.hostSocket !== ws && session.hostSocket.readyState === WebSocket.OPEN) {
            session.hostSocket.close(4009, 'Replaced by new host connection');
          }
          session.hostSocket = ws;
          appendLog(session, {
            ts: Date.now(),
            seq: session.lastSeq,
            source: 'system',
            summary: `Host online (${session.hostLabel})`,
            status: 'accepted',
            commandedSpeed: 0,
            gear: session.commandState.gear,
            steer: 'center',
          });
          broadcastSessionState(session);
          return;
        }

        if (type === 'auth:monitor' && safeCompareHex(session.monitorTokenHash, token)) {
          clearTimeout(authTimer);
          authedRole = 'monitor';
          authedSession = session;
          session.monitorSockets.add(ws);
          broadcastSessionState(session);
          return;
        }

        if (
          type === 'auth:controller' &&
          session.controllerTokenHash &&
          safeCompareHex(session.controllerTokenHash, token)
        ) {
          clearTimeout(authTimer);
          authedRole = 'controller';
          authedSession = session;
          session.controllerSocket = ws;
          session.lastHeartbeatAt = Date.now();
          session.lastSeq = 0;
          appendLog(session, {
            ts: Date.now(),
            seq: 0,
            source: 'system',
            summary: 'Controller authenticated over WebSocket',
            status: 'accepted',
            commandedSpeed: 0,
            gear: session.commandState.gear,
            steer: 'center',
          });
          broadcastSessionState(session);
          return;
        }

        sendJson(ws, { type: 'error', message: 'Authentication failed' });
        ws.close(4001, 'Unauthorized');
        return;
      }

      if (!authedSession) return;

      // Host & Monitor sockets do not send movement commands
      if (authedRole === 'host' && frame.type === 'ping') {
        sendJson(ws, { type: 'pong', ts: Date.now() });
        return;
      }

      if (authedRole !== 'controller') {
        return;
      }

      // Step 2: Validate every controller message
      const now = Date.now();
      const validation = validateClientMessage(frame, authedSession.lastSeq, now);
      if (!validation.ok) {
        authedSession.rejectedCount += 1;
        appendLog(authedSession, {
          ts: now,
          seq: authedSession.lastSeq,
          source: 'controller',
          summary: `Rejected frame: ${validation.error}`,
          status: 'rejected',
          commandedSpeed: authedSession.commandState.commandedSpeed,
          gear: authedSession.commandState.gear,
          steer: authedSession.commandState.steer,
        });
        sendJson(ws, { type: 'rejected', error: validation.error });
        broadcastSessionState(authedSession);
        return;
      }

      const msg = validation.message;
      authedSession.lastSeq = msg.seq;
      authedSession.lastHeartbeatAt = now;

      if (msg.type === 'heartbeat') {
        sendJson(ws, { type: 'heartbeat:ack', seq: msg.seq, serverTs: now });
        sendJson(authedSession.hostSocket, { type: 'heartbeat:ack', seq: msg.seq, serverTs: now });
        return;
      }

      if (msg.type === 'disconnect') {
        authedSession.controllerTokenHash = null;
        triggerFailSafeStop(authedSession, msg.reason || 'Controller requested disconnect');
        ws.close(1000, 'Controller disconnected');
        return;
      }

      // Rate-limit check (STOP/E-STOP/Brake/Neutral frames NEVER dropped!)
      const isStopFrame =
        msg.payload.emergencyStop ||
        msg.payload.brake ||
        msg.payload.gear === 'N' ||
        msg.payload.throttle === 0;

      const oneSecAgo = now - 1000;
      authedSession.cmdTimestamps = authedSession.cmdTimestamps.filter((t) => t > oneSecAgo);
      if (!isStopFrame && authedSession.cmdTimestamps.length >= PROTOCOL_LIMITS.WS_MAX_COMMANDS_PER_SEC) {
        authedSession.rejectedCount += 1;
        sendJson(ws, { type: 'rejected', error: 'Rate limit exceeded (>50 cmds/sec)' });
        return;
      }
      authedSession.cmdTimestamps.push(now);
      authedSession.lastCommandAt = now;

      const resolved = resolveCommandWithStopPriority(msg.payload, msg.seq, now);
      authedSession.commandState = resolved;

      appendLog(authedSession, {
        ts: now,
        seq: msg.seq,
        source: 'controller',
        summary: resolved.emergencyStop
          ? 'EMERGENCY STOP'
          : `${resolved.motionState} · Gear ${resolved.gear} · Cmd ${resolved.commandedSpeed}% · Steer ${resolved.steer}`,
        status: resolved.emergencyStop ? 'failsafe' : 'accepted',
        commandedSpeed: resolved.commandedSpeed,
        gear: resolved.gear,
        steer: resolved.steer,
      });

      forwardCommandToHost(authedSession, resolved);
      broadcastSessionState(authedSession);
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!authedSession) return;

      if (authedRole === 'host' && authedSession.hostSocket === ws) {
        authedSession.hostSocket = null;
        appendLog(authedSession, {
          ts: Date.now(),
          seq: authedSession.lastSeq,
          source: 'system',
          summary: 'Host bridge disconnected',
          status: 'failsafe',
          commandedSpeed: 0,
          gear: 'N',
          steer: 'center',
        });
        broadcastSessionState(authedSession);
      } else if (authedRole === 'monitor') {
        authedSession.monitorSockets.delete(ws);
      } else if (authedRole === 'controller' && authedSession.controllerSocket === ws) {
        authedSession.controllerSocket = null;
        sendJson(authedSession.hostSocket, { type: 'controller:disconnected' });
        triggerFailSafeStop(authedSession, 'Controller WebSocket connection closed');
      }
    });
  });

  // Server-side fail-safe watchdog (200ms tick)
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of sessions.entries()) {
      // Garbage-collect stale idle sessions older than 6 hours with no sockets
      const hasAnySocket =
        Boolean(session.hostSocket) ||
        Boolean(session.controllerSocket) ||
        session.monitorSockets.size > 0;
      if (!hasAnySocket && now - session.createdAt > 6 * 60 * 60 * 1000) {
        if (session.pairingCode) pairingCodeIndex.delete(session.pairingCode);
        sessions.delete(id);
        continue;
      }

      if (
        session.controllerSocket &&
        session.controllerSocket.readyState === WebSocket.OPEN &&
        session.lastHeartbeatAt !== null
      ) {
        const elapsed = now - session.lastHeartbeatAt;
        const isMoving =
          session.commandState.commandedSpeed > 0 ||
          session.commandState.steer !== 'center' ||
          session.commandState.horn;

        if (elapsed > PROTOCOL_LIMITS.SERVER_WATCHDOG_MS && isMoving) {
          triggerFailSafeStop(session, `Controller heartbeat timeout (${elapsed}ms)`);
        }
      }
    }
  }, 200);

  // -------------------------------------------------------------------------
  // Vite Middleware (Dev) or Static Assets (Prod)
  // -------------------------------------------------------------------------

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Quarky Drive relay & web server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
