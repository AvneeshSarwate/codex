import { useEffect, useState } from "react";
import { aggregateDisplayEvents } from "./eventAggregator";
import {
  ConnectionStatus,
  VisualizerSocketMessage,
  VisualizerState,
} from "./visualizerTypes";

const WEBSOCKET_URL = import.meta.env.VITE_VISUALIZER_WS ?? "ws://localhost:4100/?role=viewer";
const MAX_EVENTS = 50000;
const RECONNECT_DELAY_MS = 1000;

type StateListener = (state: VisualizerState) => void;

class VisualizerClient {
  private readonly url: string;
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private shouldReconnect = false;
  private listeners = new Set<StateListener>();
  private state: VisualizerState = {
    connectionStatus: "idle",
    events: [],
    displayEvents: [],
  };

  constructor(url: string) {
    this.url = url;
  }

  getState(): VisualizerState {
    return this.state;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);

    if (!this.shouldReconnect) {
      this.shouldReconnect = true;
      this.connect();
    }

    listener(this.state);

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.shutdown();
      }
    };
  }

  private setState(updater: (prev: VisualizerState) => VisualizerState) {
    const next = updater(this.state);
    this.state = next;
    for (const listener of this.listeners) {
      listener(next);
    }
  }

  private updateStatus(status: ConnectionStatus) {
    this.setState((prev) => ({ ...prev, connectionStatus: status }));
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
        this.setState((prev) => {
          const events = message.events.slice(-MAX_EVENTS);
          const displayEvents = aggregateDisplayEvents(events);
          return {
            connectionStatus: prev.connectionStatus,
            events,
            displayEvents,
          };
        });
        return;
      }

      if (message.type === "event") {
        this.setState((prev) => {
          const events = [...prev.events, message.event].slice(-MAX_EVENTS);
          const displayEvents = aggregateDisplayEvents(events);
          return {
            connectionStatus: prev.connectionStatus,
            events,
            displayEvents,
          };
        });
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
}

const client = new VisualizerClient(WEBSOCKET_URL);

export function useVisualizerData(): VisualizerState {
  const [state, setState] = useState(client.getState());

  useEffect(() => client.subscribe(setState), []);

  return state;
}
