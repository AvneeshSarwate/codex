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

type ProtocolEventMessage = {
  type?: string;
  delta?: unknown;
  text?: unknown;
};

type ProtocolEventPayload = {
  id?: string;
  msg?: ProtocolEventMessage;
};

type ProtocolEventAction = {
  event?: ProtocolEventPayload;
};

type AggregatedDelta = {
  subtype: string;
  combinedText: string;
  events: VisualizerEvent[];
};

type DisplayEvent = {
  event: VisualizerEvent;
  subtype: string | null;
  aggregated?: AggregatedDelta;
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

function extractProtocolEvent(action: unknown): ProtocolEventPayload | null {
  if (!action || typeof action !== "object") {
    return null;
  }

  const event = (action as ProtocolEventAction).event;
  if (!event || typeof event !== "object") {
    return null;
  }

  return event as ProtocolEventPayload;
}

function protocolEventType(action: unknown): string | null {
  const event = extractProtocolEvent(action);
  const msg = event?.msg;
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const eventType = (msg as ProtocolEventMessage).type;
  return typeof eventType === "string" ? eventType : null;
}

function protocolEventId(action: unknown): string | null {
  const event = extractProtocolEvent(action);
  const id = event?.id;
  return typeof id === "string" ? id : null;
}

function protocolEventDelta(action: unknown): string | null {
  const event = extractProtocolEvent(action);
  const msg = event?.msg;
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const delta = (msg as ProtocolEventMessage).delta;
  return typeof delta === "string" ? delta : null;
}

const DELTA_SUBTYPES = new Set(["agent_message_delta", "agent_reasoning_delta"]);

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

  const displayEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
    const result: DisplayEvent[] = [];
    type PendingAggregate = {
      key: string;
      subtype: string;
      events: VisualizerEvent[];
      combinedText: string;
    };
    let pending: PendingAggregate | null = null;

    const flushPending = () => {
      if (!pending) {
        return;
      }
      const aggregatedEvents = pending.events;
      const first = aggregatedEvents[0];
      const last = aggregatedEvents[aggregatedEvents.length - 1];
      const aggregatedEvent: VisualizerEvent = {
        ...first,
        state: last.state,
      };
      result.push({
        event: aggregatedEvent,
        subtype: pending.subtype,
        aggregated: {
          subtype: pending.subtype,
          combinedText: pending.combinedText,
          events: aggregatedEvents,
        },
      });
      pending = null;
    };

    for (const event of sorted) {
      const subtype = event.actionType === "protocol_event" ? protocolEventType(event.action) : null;

      if (event.actionType === "protocol_event" && subtype && DELTA_SUBTYPES.has(subtype)) {
        const id = protocolEventId(event.action) ?? "__no_id__";
        const key = `${id}::${subtype}`;
        const delta = protocolEventDelta(event.action);

        if (typeof delta !== "string") {
          flushPending();
          result.push({ event, subtype });
          continue;
        }

        if (pending && pending.key === key) {
          pending.events.push(event);
          pending.combinedText += delta;
        } else {
          flushPending();
          pending = {
            key,
            subtype,
            events: [event],
            combinedText: delta,
          };
        }
        continue;
      }

      flushPending();
      result.push({ event, subtype });
    }

    flushPending();
    return result;
  }, [events]);

  return (
    <div className="app">
      <header className="header">
        <h1>Codex Agent Visualizer</h1>
        <div className="status">WebSocket status: {connectionStatus}</div>
      </header>
      <main className="timeline">
        {displayEvents.length === 0 ? (
          <div className="empty-state">
            <h2>No events yet</h2>
            <p>
              Start the Codex agent with the CODEX_VISUALIZER_WS environment variable pointing at the
              websocket server to watch internal actions stream in real time.
            </p>
          </div>
        ) : (
          displayEvents.map((display) => {
            const { event, subtype, aggregated } = display;
            const color = colorForAction(event.actionType);
            const subtypeColor = subtype ? colorForAction(subtype) : null;
            const badgeLabel = subtype
              ? `${subtype}${aggregated && aggregated.events.length > 1 ? ` × ${aggregated.events.length}` : ""}`
              : null;
            const titleText = badgeLabel ? `${event.actionType} • ${badgeLabel}` : event.actionType;
            const accentStyle = { "--accent-color": color } as CSSProperties;
            const badgeStyle = subtypeColor
              ? ({ backgroundColor: subtypeColor } as CSSProperties)
              : undefined;
            const actionPayload = aggregated
              ? {
                  aggregated: true,
                  subtype: aggregated.subtype,
                  combinedText: aggregated.combinedText,
                  segments: aggregated.events.map((segment) => ({
                    sequence: segment.sequence,
                    timestampMs: segment.timestampMs,
                    action: segment.action,
                  })),
                }
              : event.action;

            return (
              <details
                className="event-item"
                key={`${event.sequence}-${event.timestampMs}`}
                style={accentStyle}
              >
                <summary className="event-summary">
                  <div className="event-summary-main">
                    <span className="event-summary-title">
                      <span>{event.actionType}</span>
                      {badgeLabel ? (
                        <>
                          <span className="event-summary-separator">•</span>
                          <span className="event-subtype-badge" style={badgeStyle}>
                            {badgeLabel}
                          </span>
                        </>
                      ) : null}
                    </span>
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
                    <h2>{titleText}</h2>
                    <div className="event-meta">
                      <span>{formatTimestamp(event.timestampMs)}</span>
                      {event.conversationId ? <span>Conversation: {event.conversationId}</span> : null}
                    </div>
                    {aggregated ? (
                      <div className="event-delta-aggregate">
                        <h3>Aggregated delta ({aggregated.events.length} segments)</h3>
                        <pre className="event-delta-text">{aggregated.combinedText}</pre>
                      </div>
                    ) : null}
                    <pre className="event-json">{stringify(actionPayload)}</pre>
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
