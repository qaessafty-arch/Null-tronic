import { store, log } from '../state/store';
import { dispatchCommand, dispatchNormalizedPointer, getAdapter } from '../input-system/input';

/**
 * WebSocket client for the local Python service (backend/). The service only emits input
 * commands (shared/commands/input-commands.schema.json); this client feeds them into the
 * same input system used by mouse and keyboard. It never touches the project model.
 */

let ws: WebSocket | null = null;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRequests = new Map<string, (msg: Record<string, unknown>) => void>();

type Msg =
  | { type: 'pointer'; phase: 'move' | 'down' | 'up'; x: number; y: number }
  | { type: 'command'; name: string }
  | { type: 'zoom'; factor: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'status'; camera?: string; fps?: number; hands?: number; gesture?: string; paused?: boolean; landmarks?: number[][][]; message?: string }
  | { type: 'result'; requestId: string; [k: string]: unknown };

const setHand = (patch: Partial<ReturnType<typeof store.get>['hand']>) => store.set((s) => ({ hand: { ...s.hand, ...patch } }));

export function handleMessage(msg: Msg): void {
  const s = store.get();
  switch (msg.type) {
    case 'pointer': {
      const x = Math.min(1, Math.max(0, msg.x));
      const y = Math.min(1, Math.max(0, msg.y));
      setHand({ cursor: { x, y }, pinching: msg.phase === 'down' ? true : msg.phase === 'up' ? false : s.hand.pinching });
      if (s.hand.paused) return;
      dispatchNormalizedPointer(msg.phase, x, y, 'hand');
      return;
    }
    case 'command':
      dispatchCommand(msg.name, 'hand');
      if (msg.name === 'pause' || msg.name === 'resume') setHand({ paused: msg.name === 'pause' });
      return;
    case 'zoom':
      if (!s.hand.paused && msg.factor > 0) getAdapter()?.zoomAt(msg.factor, s.hand.cursor?.x, s.hand.cursor?.y);
      return;
    case 'pan':
      if (!s.hand.paused) getAdapter()?.panBy(-msg.dx, -msg.dy);
      return;
    case 'status':
      setHand({
        camera: msg.camera ?? s.hand.camera,
        fps: msg.fps ?? s.hand.fps,
        hands: msg.hands ?? s.hand.hands,
        gesture: msg.gesture ?? s.hand.gesture,
        paused: msg.paused ?? s.hand.paused,
        landmarks: msg.landmarks ?? s.hand.landmarks,
        message: msg.message ?? s.hand.message,
      });
      return;
    case 'result': {
      const cb = pendingRequests.get(msg.requestId);
      if (cb) {
        pendingRequests.delete(msg.requestId);
        cb(msg);
      }
      return;
    }
  }
}

export function connectHand(url = store.get().hand.url): void {
  disconnectHand(false);
  setHand({ enabled: true, url, connection: 'connecting', message: '' });
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setHand({ connection: 'error', message: (e as Error).message });
    return;
  }
  ws.onopen = () => {
    retry = 0;
    setHand({ connection: 'connected', message: 'Connected' });
    log('info', `Hand-tracking service connected (${url})`, true);
    ws?.send(JSON.stringify({ type: 'hello', client: 'null-tech-circuit-studio', protocol: 1 }));
  };
  ws.onmessage = (ev) => {
    try {
      handleMessage(JSON.parse(String(ev.data)) as Msg);
    } catch (e) {
      log('warn', `Bad message from hand-tracking service: ${(e as Error).message}`, false);
    }
  };
  ws.onclose = () => {
    const wasConnected = store.get().hand.connection === 'connected';
    setHand({ connection: 'disconnected', cursor: null, pinching: false, hands: 0 });
    if (wasConnected) log('warn', 'Hand-tracking service disconnected — mouse and keyboard remain active.');
    if (store.get().hand.enabled) {
      retry = Math.min(retry + 1, 6);
      retryTimer = setTimeout(() => connectHand(url), 500 * 2 ** retry);
    }
  };
  ws.onerror = () => setHand({ connection: 'error', message: `Cannot reach ${url}. Start the service: python -m nulltech_backend` });
}

export function disconnectHand(disable = true): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (disable) setHand({ enabled: false });
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  setHand({ connection: 'disconnected', cursor: null, pinching: false });
}

export function sendToBackend(msg: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

/** Request/response over the same socket (e.g. ngspice verification). */
export function requestBackend(msg: Record<string, unknown>, timeoutMs = 30000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const requestId = Math.random().toString(36).slice(2);
    if (!sendToBackend({ ...msg, requestId })) {
      reject(new Error('Local service not connected'));
      return;
    }
    pendingRequests.set(requestId, resolve);
    setTimeout(() => {
      if (pendingRequests.delete(requestId)) reject(new Error('Local service did not answer in time'));
    }, timeoutMs);
  });
}
