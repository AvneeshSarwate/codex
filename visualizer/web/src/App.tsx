import { CSSProperties, useEffect, useMemo, useState } from "react";
import { actionBackground, colorForAction, stateBackground } from "./theme";

type VisualizerEvent = {
  sequence: number;
  timestampMs: number;
  conversationId?: string;
  actionType: string;
  action: unknown;
  state?: unknown;
};

const WEBSOCKET_URL = import.meta.env.VITE_VISUALIZER_WS ?? "ws://localhost:4100/?role=viewer";

function formatTimestamp(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.toLocaleTimeString()} • ${date.toLocaleDateString()}`;
}

function stringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function protocolEventType(action: unknown): string | null {
  if (!action || typeof action !== "object") {
    return null;
  }

  const actionRecord = action as { [key: string]: unknown };
  const eventValue = actionRecord.event;
  if (!eventValue || typeof eventValue !== "object") {
    return null;
  }

  const eventRecord = eventValue as { [key: string]: unknown };
  const msg = eventRecord.msg;
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const msgRecord = msg as { [key: string]: unknown };
  const eventType = msgRecord.type;
  return typeof eventType === "string" ? eventType : null;
}

export default function App() {
  const [events, setEvents] = useState<VisualizerEvent[]>([]);
  const [connectionStatus, setConnectionStatus] = useState("connecting");

  useEffect(() => {
    let socket: WebSocket | null = null;
    let shouldReconnect = true;

    const connect = () => {
      setConnectionStatus("connecting");
      socket = new WebSocket(WEBSOCKET_URL);

      socket.onopen = () => {
        setConnectionStatus("connected");
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as VisualizerEvent;
          setEvents((prev) => {
            const next = [...prev, parsed];
            return next.slice(-500);
          });
        } catch (err) {
          console.warn("failed to parse visualizer event", err);
        }
      };

      socket.onclose = () => {
        if (!shouldReconnect) {
          return;
        }
        setConnectionStatus("reconnecting");
        setTimeout(connect, 1000);
      };

      socket.onerror = (err) => {
        console.warn("visualizer websocket error", err);
        setConnectionStatus("error");
      };
    };

    connect();

    return () => {
      shouldReconnect = false;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);

  const orderedEvents = useMemo(
    () => [...events].sort((a, b) => a.sequence - b.sequence),
    [events]
  );

  return (
    <div className="app">
      <header className="header">
        <h1>Codex Agent Visualizer</h1>
        <div className="status">WebSocket status: {connectionStatus}</div>
      </header>
      <main className="timeline">
        {orderedEvents.length === 0 ? (
          <div className="empty-state">
            <h2>No events yet</h2>
            <p>
              Start the Codex agent with the CODEX_VISUALIZER_WS environment variable pointing at the
              websocket server to watch internal actions stream in real time.
            </p>
          </div>
        ) : (
          orderedEvents.map((event) => {
            const color = colorForAction(event.actionType);
            const inferredType = event.actionType === "protocol_event" ? protocolEventType(event.action) : null;
            const title = inferredType ? `${event.actionType} • ${inferredType}` : event.actionType;
            const accentStyle = { "--accent-color": color } as CSSProperties;

            return (
              <details
                className="event-item"
                key={`${event.sequence}-${event.timestampMs}`}
                style={accentStyle}
              >
                <summary className="event-summary">
                  <div className="event-summary-main">
                    <span className="event-summary-title">{title}</span>
                    <span className="event-summary-sequence">#{event.sequence}</span>
                  </div>
                  <div className="event-summary-meta event-meta">
                    <span>{formatTimestamp(event.timestampMs)}</span>
                    {event.conversationId ? <span>Conversation: {event.conversationId}</span> : null}
                  </div>
                </summary>
                <div className="event-content">
                  <section
                    className="event-action"
                    style={{ borderLeftColor: color, background: actionBackground }}
                  >
                    <h2>{title}</h2>
                    <div className="event-meta">
                      <span>{formatTimestamp(event.timestampMs)}</span>
                      {event.conversationId ? <span>Conversation: {event.conversationId}</span> : null}
                    </div>
                    <pre className="event-json">{stringify(event.action)}</pre>
                  </section>
                  <section className="event-state" style={{ background: stateBackground }}>
                    <h2>State after action</h2>
                    <pre className="state-json">{stringify(event.state ?? {})}</pre>
                  </section>
                </div>
              </details>
            );
          })
        )}
      </main>
    </div>
  );
}
