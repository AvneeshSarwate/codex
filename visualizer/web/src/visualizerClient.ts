import { useEffect } from "react";
import {
  getVisualizerStore,
  onDisplayEvent,
  pushEvent,
  replaceEvents,
  setConnectionStatus,
  subscribeToVisualizerStore,
  useVisualizerSnapshot,
} from "./visualizerStore";
import { ConnectionStatus, VisualizerSocketMessage } from "./visualizerTypes";

const WEBSOCKET_URL = import.meta.env.VITE_VISUALIZER_WS ?? "ws://localhost:4100/?role=viewer";
const RECONNECT_DELAY_MS = 1000;

type ConnectionToken = symbol;

class VisualizerConnection {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private activeTokens = new Set<ConnectionToken>();

  constructor(url: string) {
    this.url = url;
  }

  acquire(): ConnectionToken {
    const token: ConnectionToken = Symbol("visualizer-connection");
    this.activeTokens.add(token);
    if (!this.shouldReconnect) {
      this.shouldReconnect = true;
      this.connect();
    }
    return token;
  }

  release(token: ConnectionToken) {
    this.activeTokens.delete(token);
    if (this.activeTokens.size === 0) {
      this.shutdown();
    }
  }

  private connect() {
    if (!this.shouldReconnect || this.socket) {
      return;
    }

    this.updateStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        socket.close();
        return;
      }
      this.updateStatus("connected");
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      if (typeof event.data !== "string") {
        console.warn("visualizer websocket received non-text message", event.data);
        return;
      }
      let message: VisualizerSocketMessage;
      try {
        message = JSON.parse(event.data) as VisualizerSocketMessage;
      } catch (err) {
        console.warn("failed to parse visualizer message", err);
        return;
      }

      if (message.type === "backlog") {
        replaceEvents(message.events);
        return;
      }

      if (message.type === "event") {
        pushEvent(message.event);
        return;
      }

      console.warn("received unknown visualizer message type", message);
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      if (!this.shouldReconnect) {
        this.updateStatus("idle");
        return;
      }
      this.scheduleReconnect();
    };

    socket.onerror = (err) => {
      if (this.socket !== socket) {
        return;
      }
      console.warn("visualizer websocket error", err);
      this.updateStatus("error");
    };
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) {
      return;
    }
    this.updateStatus("reconnecting");
    this.clearReconnectTimer();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private shutdown() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    if (this.socket) {
      const socket = this.socket;
      this.socket = null;
      try {
        socket.close();
      } catch (err) {
        console.warn("failed to close visualizer websocket", err);
      }
    }
    this.updateStatus("idle");
  }

  private updateStatus(status: ConnectionStatus) {
    setConnectionStatus(status);
  }
}

const connection = new VisualizerConnection(WEBSOCKET_URL);

export function ensureVisualizerConnection(): () => void {
  const token = connection.acquire();
  return () => connection.release(token);
}

export function useVisualizerData() {
  useEffect(ensureVisualizerConnection, []);
  const snapshot = useVisualizerSnapshot();
  const displayEvents = snapshot.replay.mode === "replay" ? snapshot.replay.displayEvents : snapshot.displayEvents;
  return { ...snapshot, displayEvents };
}

export function getVisualizerState() {
  return getVisualizerStore();
}

export const subscribeToVisualizer = subscribeToVisualizerStore;
export const watchDisplayEvents = onDisplayEvent;
export const useVisualizerSnapshotState = useVisualizerSnapshot;
export { VISUALIZER_MAX_EVENTS } from "./visualizerStore";
