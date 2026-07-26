import { useEffect, useRef, useCallback } from 'react';

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

interface Options {
  sessionId: number;
  scannerId: string;
  onMessage: (msg: WsMessage) => void;
  enabled?: boolean;
  scanning?: boolean;
}

const WS_BASE = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;

export function useWebSocket({ sessionId, scannerId, onMessage, enabled = true, scanning = false }: Options) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const heartbeatTimer = useRef<ReturnType<typeof setInterval>>();
  const connectionVersion = useRef(0);
  const scanningRef = useRef(scanning);
  scanningRef.current = scanning;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const version = ++connectionVersion.current;
    const ws = new WebSocket(`${WS_BASE}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'join', sessionId, scannerId, scanning: scanningRef.current }));

      heartbeatTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, 10_000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        onMessageRef.current(msg);
      } catch {}
    };

    ws.onclose = () => {
      if (version !== connectionVersion.current) return;
      clearInterval(heartbeatTimer.current);
      reconnectTimer.current = setTimeout(connect, 1000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [sessionId, scannerId]);

  useEffect(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'set_scanning', scanning }));
    }
  }, [scanning]);

  useEffect(() => {
    if (!enabled) {
      wsRef.current?.close();
      wsRef.current = null;
      clearInterval(heartbeatTimer.current);
      clearTimeout(reconnectTimer.current);
      return;
    }

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      clearInterval(heartbeatTimer.current);
      clearTimeout(reconnectTimer.current);
    };
  }, [enabled, connect]);
}
