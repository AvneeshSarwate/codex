import type { Snapshot } from "valtio";
import { CSSProperties } from "react";
import { actionBackground, colorForAction, stateBackground } from "./theme";
import { useVisualizerData } from "./visualizerClient";
import { DisplayEvent } from "./visualizerTypes";

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

function renderDisplayEvent(display: Snapshot<DisplayEvent>) {
  const { event, subtype, aggregated } = display;
  const color = colorForAction(event.actionType);
  const subtypeColor = subtype ? colorForAction(subtype) : null;
  const repeatCount = aggregated?.events.length ?? 0;
  const badgeLabel = subtype
    ? `${subtype}${repeatCount > 1 ? ` × ${repeatCount}` : ""}`
    : null;
  const titleText = badgeLabel ? `${event.actionType} • ${badgeLabel}` : event.actionType;
  const accentStyle = { "--accent-color": color } as CSSProperties;
  const badgeStyle = subtypeColor ? ({ backgroundColor: subtypeColor } as CSSProperties) : undefined;
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

  const actionJson = (
    <pre className="event-json">{stringify(actionPayload)}</pre>
  );

  return (
    <details className="event-item" key={`${event.sequence}-${event.timestampMs}`} style={accentStyle}>
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
        <section className="event-action" style={{ borderLeftColor: color, background: actionBackground }}>
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
          {aggregated ? (
            <details className="event-json-details">
              <summary>Raw aggregated payload</summary>
              {actionJson}
            </details>
          ) : (
            actionJson
          )}
        </section>
        <section className="event-state" style={{ background: stateBackground }}>
          <h2>State after action</h2>
          <pre className="state-json">{stringify(event.state ?? {})}</pre>
        </section>
      </div>
    </details>
  );
}

export default function App() {
  const { displayEvents, connectionStatus } = useVisualizerData();

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
              Start the Codex agent with the CODEX_VISUALIZER_WS environment variable pointing at the websocket
              server to watch internal actions stream in real time.
            </p>
          </div>
        ) : (
          displayEvents.map(renderDisplayEvent)
        )}
      </main>
    </div>
  );
}
