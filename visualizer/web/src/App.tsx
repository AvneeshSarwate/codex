import type { Snapshot } from "valtio";
import { CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import type { VirtuosoHandle } from "react-virtuoso";
import { actionBackground, colorForAction, stateBackground } from "./theme";
import { useVisualizerData } from "./visualizerClient";
import { DisplayEvent } from "./visualizerTypes";
import { getDisplayIndexForSequence } from "./visualizerStore";
import { VisualizerSketch } from "./VisualizerSketch";
import { ReplayControls } from "./replay/ReplayControls";
import { seekReplayToDisplayIndex } from "./replay/replayStore";
import { CircleSelection } from "./visualizerSketch/konvaManager";

function formatTimestamp(timestampMs: number) {
  const date = new Date(timestampMs);
  return `${date.toLocaleTimeString()} • ${date.toLocaleDateString()}`;
}

function formatJson(value: unknown) {
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
  type SelectedEventState = {
    sourceSequence: number;
    timelineSequence: number;
  };

  const [selectedEvent, setSelectedEvent] = useState<SelectedEventState | null>(null);

  const followOutput = replay.mode === "live" ? "auto" : false;

  const resolveDisplayIndex = useCallback(
    (sequence: number): number | undefined => {
      if (replay.mode === "replay") {
        const index = replay.sequenceIndex[sequence];
        return typeof index === "number" ? index : undefined;
      }
      return getDisplayIndexForSequence(sequence);
    },
    [replay.mode, replay.sequenceIndex]
  );

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
    const mapped = resolveDisplayIndex(targetEvent.sequence);
    return mapped ?? displayEvents.length - 1;
  }, [displayEvents.length, replay.buffer, replay.cursor, replay.mode, resolveDisplayIndex]);

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
      behavior: "auto",
    });
  }, [activeReplayIndex, replay.mode, replay.status]);

  const activeSequence = useMemo(() => {
    if (selectedEvent) {
      return selectedEvent.sourceSequence;
    }
    if (replay.mode !== "replay" || replay.cursor < 0) {
      return null;
    }
    const target = replay.buffer[replay.cursor];
    return target ? target.sequence : null;
  }, [replay.buffer, replay.cursor, replay.mode, selectedEvent]);

  useEffect(() => {
    if (replay.mode === "live") {
      setSelectedEvent(null);
    }
  }, [replay.mode]);

  useEffect(() => {
    if (!selectedEvent) {
      return;
    }
    const hasTimeline = resolveDisplayIndex(selectedEvent.timelineSequence) !== undefined;
    const hasSource = resolveDisplayIndex(selectedEvent.sourceSequence) !== undefined;
    if (!hasTimeline && !hasSource) {
      setSelectedEvent(null);
    }
  }, [displayEvents, resolveDisplayIndex, selectedEvent]);

  useEffect(() => {
    if (replay.mode !== "replay") {
      return;
    }
    const index = replay.displayCursor;
    if (index < 0 || index >= displayEvents.length) {
      setSelectedEvent(null);
      return;
    }
    const display = displayEvents[index];
    setSelectedEvent((prev) => {
      if (prev && prev.timelineSequence === display.event.sequence) {
        return prev;
      }
      return {
        sourceSequence: display.event.sequence,
        timelineSequence: display.event.sequence,
      } satisfies SelectedEventState;
    });
  }, [displayEvents, replay.displayCursor, replay.mode]);

  const highlightSequences = useMemo(() => {
    if (selectedEvent) {
      const displayIndex = resolveDisplayIndex(selectedEvent.timelineSequence);
      const display = displayIndex !== undefined ? displayEvents[displayIndex] : undefined;
      if (display) {
        return new Set(display.sequences);
      }
      return new Set([selectedEvent.sourceSequence, selectedEvent.timelineSequence]);
    }
    if (activeSequence !== null) {
      const displayIndex = resolveDisplayIndex(activeSequence);
      const display = displayIndex !== undefined ? displayEvents[displayIndex] : undefined;
      if (display) {
        return new Set(display.sequences);
      }
    }
    return new Set<number>();
  }, [activeSequence, displayEvents, resolveDisplayIndex, selectedEvent]);

  const handleCircleSelect = useCallback(
    (selection: CircleSelection) => {
      const primaryIndex = resolveDisplayIndex(selection.latestSequence);
      const fallbackIndex = resolveDisplayIndex(selection.primarySequence);
      const index = primaryIndex ?? fallbackIndex;
      if (index === undefined) {
        return;
      }
      const display = displayEvents[index];
      if (!display) {
        return;
      }
      setSelectedEvent({
        sourceSequence: selection.latestSequence,
        timelineSequence: display.event.sequence,
      });
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
    },
    [displayEvents, resolveDisplayIndex]
  );

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
    const actionJson = <pre className="event-json">{display.actionJson}</pre>;
    const sequences = display.sequences.length > 0 ? display.sequences : [event.sequence];
    const timelineSequence = sequences[sequences.length - 1] ?? event.sequence;
    const showInTimelineDisabled = replay.mode !== "replay";

    const isActive =
      activeSequence !== null &&
      (event.sequence === activeSequence ||
        aggregated?.events.some((segment) => segment.sequence === activeSequence));

    const isSelected = selectedEvent ? selectedEvent.timelineSequence === event.sequence : false;
    const handleSelect = () => {
      setSelectedEvent((prev) =>
        prev && prev.timelineSequence === event.sequence
          ? null
          : {
              sourceSequence: event.sequence,
              timelineSequence: event.sequence,
            }
      );
    };

    const handleShowInTimeline = () => {
      setSelectedEvent({
        sourceSequence: timelineSequence,
        timelineSequence,
      });

      if (replay.mode !== "replay") {
        return;
      }

      const candidateSequences = [...new Set([timelineSequence, event.sequence, ...sequences])];
      for (const sequence of candidateSequences) {
        const index = resolveDisplayIndex(sequence);
        if (typeof index === "number") {
          seekReplayToDisplayIndex(index);
          return;
        }
      }
    };

    return (
      <div
        className={`event-item${isActive ? " event-item-active" : ""}${isSelected ? " event-item-selected" : ""}`}
        key={`${event.sequence}-${event.timestampMs}`}
        style={accentStyle}
      >
        <button className="event-header" type="button" onClick={handleSelect}>
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
            <span >
              <button
                className="event-show-timeline"
                type="button"
                onClick={handleShowInTimeline}
                disabled={showInTimelineDisabled}
                style={{ marginRight: "0.5rem" }}
              >
                Show in timeline
              </button>
              <span className="event-summary-sequence">#{event.sequence}</span>
            </span>
          </div>
          <div className="event-summary-meta event-meta">
            <span>{formatTimestamp(event.timestampMs)}</span>
            {event.conversationId ? <span>Conversation: {event.conversationId}</span> : null}
          </div>
        </button>  
        <details className="event-details">
          <summary className="event-details-summary">View details</summary>
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
              <pre className="state-json">{formatJson(event.state ?? {})}</pre>
            </section>
          </div>
        </details>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Codex Agent Visualizer</h1>
        <div className="status">WebSocket status: {connectionStatus}</div>
      </header>
      <VisualizerSketch highlightSequences={highlightSequences} onCircleSelect={handleCircleSelect} />
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
