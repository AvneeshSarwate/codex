import {
  AggregatedDelta,
  DisplayEvent,
  ProtocolEventAction,
  ProtocolEventMessage,
  ProtocolEventPayload,
  VisualizerEvent,
} from "./visualizerTypes";

const DELTA_SUBTYPES = new Set(["agent_message_delta", "agent_reasoning_delta"]);

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

export function aggregateDisplayEvents(events: VisualizerEvent[]): DisplayEvent[] {
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
    const aggregated: AggregatedDelta = {
      subtype: pending.subtype,
      combinedText: pending.combinedText,
      events: aggregatedEvents,
    };
    result.push({
      event: aggregatedEvent,
      subtype: pending.subtype,
      aggregated,
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
}
