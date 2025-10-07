import {
  AggregatedDelta,
  AggregatedSegment,
  DisplayEvent,
  ProtocolEventAction,
  ProtocolEventMessage,
  ProtocolEventPayload,
  VisualizerEvent,
} from "./visualizerTypes";

const DELTA_SUBTYPES = new Set(["agent_message_delta", "agent_reasoning_delta"]);

type PendingAggregate = {
  key: string;
  entry: DisplayEvent;
  index: number;
};

export type DisplayAggregatorState = {
  pending: PendingAggregate | null;
  sequenceIndex: Map<number, number>;
};

export function createAggregatorState(): DisplayAggregatorState {
  return {
    pending: null,
    sequenceIndex: new Map(),
  };
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function registerSequence(
  sequence: number,
  index: number,
  state: DisplayAggregatorState
) {
  state.sequenceIndex.set(sequence, index);
}

function updateSerializedAction(entry: DisplayEvent) {
  if (entry.aggregated) {
    const segments: AggregatedSegment[] = entry.aggregatedSegments ?? [];
    entry.actionJson = prettyJson({
      aggregated: true,
      subtype: entry.aggregated.subtype,
      combinedText: entry.aggregated.combinedText,
      segments,
    });
    return;
  }

  entry.actionJson = prettyJson(entry.event.action);
}

function ensureAggregatedSegments(entry: DisplayEvent): AggregatedSegment[] {
  if (!entry.aggregatedSegments) {
    entry.aggregatedSegments = [];
  }
  return entry.aggregatedSegments;
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

function startAggregate(
  target: DisplayEvent[],
  state: DisplayAggregatorState,
  key: string,
  event: VisualizerEvent,
  subtype: string,
  delta: string
): DisplayEvent {
  const aggregated: AggregatedDelta = {
    subtype,
    combinedText: delta,
    events: [event],
  };

  const entry: DisplayEvent = {
    event: { ...event },
    subtype,
    aggregated,
    aggregatedSegments: [
      {
        sequence: event.sequence,
        timestampMs: event.timestampMs,
        action: event.action,
      },
    ],
    sequences: [event.sequence],
    actionJson: "",
  };

  updateSerializedAction(entry);
  target.push(entry);
  const index = target.length - 1;
  registerSequence(event.sequence, index, state);
  state.pending = { key, entry, index } satisfies PendingAggregate;
  return entry;
}

function pushSimpleEvent(
  target: DisplayEvent[],
  state: DisplayAggregatorState,
  event: VisualizerEvent,
  subtype: string | null
): DisplayEvent {
  const entry: DisplayEvent = {
    event,
    subtype,
    sequences: [event.sequence],
    actionJson: "",
  };
  updateSerializedAction(entry);
  target.push(entry);
  registerSequence(event.sequence, target.length - 1, state);
  state.pending = null;
  return entry;
}

function appendToAggregate(
  state: DisplayAggregatorState,
  event: VisualizerEvent,
  delta: string
): DisplayEvent | null {
  if (!state.pending) {
    return null;
  }

  const { entry, index } = state.pending;
  const aggregated = entry.aggregated;
  if (!aggregated) {
    return null;
  }

  aggregated.events.push(event);
  aggregated.combinedText += delta;
  entry.event.state = event.state;
  entry.event.timestampMs = event.timestampMs;
  ensureAggregatedSegments(entry).push({
    sequence: event.sequence,
    timestampMs: event.timestampMs,
    action: event.action,
  });
  entry.sequences.push(event.sequence);
  registerSequence(event.sequence, index, state);
  updateSerializedAction(entry);
  return entry;
}

function processProtocolDelta(
  target: DisplayEvent[],
  state: DisplayAggregatorState,
  event: VisualizerEvent,
  subtype: string,
  delta: string
): DisplayEvent {
  const id = protocolEventId(event.action) ?? "__no_id__";
  const key = `${id}::${subtype}`;

  if (state.pending && state.pending.key === key) {
    const existing = appendToAggregate(state, event, delta);
    if (existing) {
      return existing;
    }
  }

  state.pending = null;
  return startAggregate(target, state, key, event, subtype, delta);
}

function processEvent(
  target: DisplayEvent[],
  state: DisplayAggregatorState,
  event: VisualizerEvent
): DisplayEvent {
  const subtype = event.actionType === "protocol_event" ? protocolEventType(event.action) : null;

  if (event.actionType === "protocol_event" && subtype && DELTA_SUBTYPES.has(subtype)) {
    const delta = protocolEventDelta(event.action);
    if (typeof delta === "string") {
      return processProtocolDelta(target, state, event, subtype, delta);
    }
  }

  return pushSimpleEvent(target, state, event, subtype);
}

export function rebuildDisplayEvents(
  events: VisualizerEvent[],
  target: DisplayEvent[],
  state: DisplayAggregatorState
) {
  target.splice(0, target.length);
  state.pending = null;
  state.sequenceIndex.clear();
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  for (const event of sorted) {
    processEvent(target, state, event);
  }
}

export function appendDisplayEvent(
  event: VisualizerEvent,
  target: DisplayEvent[],
  state: DisplayAggregatorState
): DisplayEvent {
  return processEvent(target, state, event);
}

export function aggregateDisplayEvents(events: VisualizerEvent[]): DisplayEvent[] {
  return aggregateDisplayEventsWithIndex(events).displayEvents;
}

export function aggregateDisplayEventsWithIndex(
  events: VisualizerEvent[]
): { displayEvents: DisplayEvent[]; sequenceIndex: Map<number, number> } {
  const state = createAggregatorState();
  const displayEvents: DisplayEvent[] = [];
  rebuildDisplayEvents(events, displayEvents, state);
  return {
    displayEvents,
    sequenceIndex: new Map(state.sequenceIndex),
  };
}

export function lookupSequenceIndex(
  state: DisplayAggregatorState,
  sequence: number
): number | undefined {
  return state.sequenceIndex.get(sequence);
}
