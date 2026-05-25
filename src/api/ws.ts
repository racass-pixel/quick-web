// WebSocket manager: connects to the realtime endpoint using the session token,
// auto-reconnects with exponential backoff, fans incoming JSON envelopes out to
// subscribers, lets callers push envelopes back up the wire.
//
// Wire format: a single JSON envelope per message. Each envelope has a `kind`
// discriminator and arbitrary additional fields.

import { session } from './session';

export type WsEnvelope = { kind: string; [k: string]: unknown };
export type WsHandler = (env: WsEnvelope) => void;
export type WsStatus = 'idle' | 'connecting' | 'open' | 'closed';
export type WsLifecycle = 'open' | 'close';
export type WsLifecycleHandler = (event: WsLifecycle) => void;

const apiUrl = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8080';

function wsUrl(token: string): string {
  // http -> ws, https -> wss. Use a single replace anchored at the start.
  const base = apiUrl.replace(/^http/, 'ws');
  return `${base}/ws?token=${encodeURIComponent(token)}`;
}

class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Set<WsHandler>();
  private lifecycle = new Set<WsLifecycleHandler>();
  private status: WsStatus = 'idle';
  private currentToken: string | null = null;
  private retryAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  connect(): void {
    const token = session.token;
    if (!token) {
      this.disconnect();
      return;
    }
    // If already connected with the same token, no-op.
    if (
      this.currentToken === token &&
      (this.status === 'open' || this.status === 'connecting')
    ) {
      return;
    }
    this.intentionallyClosed = false;
    this.currentToken = token;
    this.openSocket();
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    this.clearReconnect();
    this.currentToken = null;
    this.retryAttempt = 0;
    if (this.ws) {
      try {
        this.ws.close(1000, 'client disconnect');
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.status = 'idle';
  }

  send(envelope: WsEnvelope): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(envelope));
      return true;
    }
    return false;
  }

  subscribe(fn: WsHandler): () => void {
    this.handlers.add(fn);
    return () => {
      this.handlers.delete(fn);
    };
  }

  onLifecycle(fn: WsLifecycleHandler): () => void {
    this.lifecycle.add(fn);
    return () => {
      this.lifecycle.delete(fn);
    };
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private openSocket(): void {
    if (!this.currentToken) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl(this.currentToken));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.status = 'open';
      this.retryAttempt = 0;
      for (const fn of this.lifecycle) fn('open');
    });

    ws.addEventListener('message', (ev) => {
      let env: WsEnvelope | null = null;
      try {
        env = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as WsEnvelope;
      } catch {
        return;
      }
      if (!env || typeof env.kind !== 'string') return;
      for (const fn of this.handlers) {
        try {
          fn(env);
        } catch {
          /* handler errors must not break the loop */
        }
      }
    });

    const handleClose = () => {
      this.status = 'closed';
      this.ws = null;
      for (const fn of this.lifecycle) fn('close');
      if (!this.intentionallyClosed) this.scheduleReconnect();
    };
    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', () => {
      // The browser will fire 'close' after 'error'; let close handle reconnect.
    });
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    if (this.intentionallyClosed) return;
    if (!session.token) {
      this.disconnect();
      return;
    }
    const attempt = this.retryAttempt++;
    // Exponential backoff: 0.5s, 1s, 2s, 4s, 8s, 16s, capped at 30s. Jitter ±25%.
    const baseMs = Math.min(500 * 2 ** attempt, 30_000);
    const jitter = baseMs * 0.25 * (Math.random() * 2 - 1);
    const delay = Math.max(250, Math.round(baseMs + jitter));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.currentToken = session.token;
      if (!this.currentToken) return;
      this.openSocket();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const ws = new WsClient();

// Hook up to token changes: any change in the session token disconnects the
// current socket and reconnects with the new token (or disconnects if cleared).
if (typeof window !== 'undefined') {
  session.subscribe(() => {
    const tok = session.token;
    if (!tok) {
      ws.disconnect();
      return;
    }
    // Force a fresh socket because the auth identity may have changed.
    ws.disconnect();
    // disconnect() flips intentionallyClosed; connect() clears it.
    ws.connect();
  });
}
