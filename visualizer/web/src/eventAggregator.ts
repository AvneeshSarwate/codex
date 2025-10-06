import {
  AggregatedDelta,
  DisplayEvent,
  ProtocolEventAction,
  ProtocolEventMessage,
  ProtocolEventPayload,
  VisualizerEvent,
} from "./visualizerTypes";

const DELTA_SUBTYPES = new Set(["agent_message_delta", "agent_reasoning_delta"]);

type PendingAggregate = {
  key: string;
  subtype: string;
  firstEvent: VisualizerEvent;
  combinedText: string;
  events: VisualizerEvent[];
  displayIndex: number;
};

export type DisplayAggregatorState = {
  pending: PendingAggregate | null;
};

export function createAggregatorState(): DisplayAggregatorState {
  return { pending: null };
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

function writeAggregateEntry(target: DisplayEvent[], pending: PendingAggregate): DisplayEvent {
  const last = pending.events[pending.events.length - 1];
  const entry: DisplayEvent = {
    event: {
      ...pending.firstEvent,
      state: last.state,
    },
    subtype: pending.subtype,
    aggregated: {
      subtype: pending.subtype,
      combinedText: pending.combinedText,
      events: pending.events.slice(),
    } satisfies AggregatedDelta,
  };
  target[pending.displayIndex] = entry;
  return entry;
}

function pushSimpleEvent(
  target: DisplayEvent[],
  event: VisualizerEvent,
  subtype: string | null
): DisplayEvent {
  const entry: DisplayEvent = { event, subtype };
  target.push(entry);
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
    state.pending.events.push(event);
    state.pending.combinedText += delta;
    return writeAggregateEntry(target, state.pending);
  }

  state.pending = {
    key,
    subtype,
    firstEvent: event,
    combinedText: delta,
    events: [event],
    displayIndex: target.length,
  } satisfies PendingAggregate;
  target.push({ event, subtype: null });
  return writeAggregateEntry(target, state.pending);
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

  state.pending = null;
  return pushSimpleEvent(target, event, subtype);
}

export function rebuildDisplayEvents(
  events: VisualizerEvent[],
  target: DisplayEvent[],
  state: DisplayAggregatorState
) {
  target.splice(0, target.length);
  state.pending = null;
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
  const state = createAggregatorState();
  const displayEvents: DisplayEvent[] = [];
  rebuildDisplayEvents(events, displayEvents, state);
  return displayEvents;
}
