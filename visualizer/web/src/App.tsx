import type { Snapshot } from "valtio";
import { CSSProperties, useEffect, useMemo, useRef } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import { actionBackground, colorForAction, stateBackground } from "./theme";
import { useVisualizerData } from "./visualizerClient";
import { DisplayEvent } from "./visualizerTypes";
import { VisualizerSketch } from "./VisualizerSketch";
import { ReplayControls } from "./replay/ReplayControls";

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

type DisplayEventSnapshot = Snapshot<DisplayEvent>;

const computeDisplayEventKey = (_index: number, item: DisplayEventSnapshot) =>
  `${item.event.sequence}-${item.event.timestampMs}`;

export default function App() {
  const { displayEvents, connectionStatus, events, replay } = useVisualizerData();
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const previousModeRef = useRef(replay.mode);
  const prevLengthRef = useRef(-1);

  const followOutput = replay.mode === "live" ? "smooth" : undefined;

  const sequenceToDisplayIndex = useMemo(() => {
    const map = new Map<number, number>();
    displayEvents.forEach((display, index) => {
      map.set(display.event.sequence, index);
      const aggregated = display.aggregated?.events;
      if (aggregated) {
        aggregated.forEach((segment) => {
          map.set(segment.sequence, index);
        });
      }
    });
    return map;
  }, [displayEvents]);

  const activeReplayIndex = useMemo(() => {
    if (replay.mode !== "replay") {
      return null;
    }
    if (displayEvents.length === 0) {
      return null;
    }
    if (replay.cursor < 0) {
      return 0;
    }
    const targetEvent = replay.buffer[replay.cursor];
    if (!targetEvent) {
      return displayEvents.length - 1;
    }
    const mapped = sequenceToDisplayIndex.get(targetEvent.sequence);
    return mapped ?? displayEvents.length - 1;
  }, [displayEvents.length, replay.buffer, replay.cursor, replay.mode, sequenceToDisplayIndex]);

  useEffect(() => {
    const previousMode = previousModeRef.current;
    const modeChangedToLive = previousMode !== "live" && replay.mode === "live";
    previousModeRef.current = replay.mode;

    if (replay.mode !== "live") {
      prevLengthRef.current = displayEvents.length;
      return;
    }

    const hasNewItems = displayEvents.length > prevLengthRef.current;
    prevLengthRef.current = displayEvents.length;

    if (!modeChangedToLive && !hasNewItems) {
      return;
    }

    const index = displayEvents.length - 1;
    if (index < 0) {
      return;
    }

    virtuosoRef.current?.scrollToIndex({ index, align: "end", behavior: "auto" });
  }, [displayEvents.length, replay.mode]);

  useEffect(() => {
    if (replay.mode !== "replay") {
      return;
    }
    if (activeReplayIndex === null) {
      return;
    }
    virtuosoRef.current?.scrollToIndex({
      index: activeReplayIndex,
      align: "center",
      behavior: replay.status === "playing" ? "auto" : "smooth",
    });
  }, [activeReplayIndex, replay.mode, replay.status]);

  const activeSequence = useMemo(() => {
    if (replay.mode !== "replay" || replay.cursor < 0) {
      return null;
    }
    const target = replay.buffer[replay.cursor];
    return target ? target.sequence : null;
  }, [replay.buffer, replay.cursor, replay.mode]);

  const renderDisplayEvent = (display: DisplayEventSnapshot) => {
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

    const isActive =
      activeSequence !== null &&
      (event.sequence === activeSequence ||
        aggregated?.events.some((segment) => segment.sequence === activeSequence));

    return (
      <details
        className={`event-item${isActive ? " event-item-active" : ""}`}
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
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Codex Agent Visualizer</h1>
        <div className="status">WebSocket status: {connectionStatus}</div>
      </header>
      <VisualizerSketch />
      <ReplayControls eventCount={events.length} />
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
          <Virtuoso<DisplayEventSnapshot>
            ref={virtuosoRef}
            data={displayEvents as DisplayEventSnapshot[]}
            className="timeline-virtuoso"
            computeItemKey={computeDisplayEventKey}
            followOutput={followOutput}
            itemContent={(_index, display) => renderDisplayEvent(display)}
            overscan={200}
          />
        )}
      </main>
    </div>
  );
}
