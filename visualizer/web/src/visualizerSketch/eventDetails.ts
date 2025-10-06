import {
  ProtocolEventAction,
  ProtocolEventMessage,
  ProtocolEventPayload,
  VisualizerEvent,
} from "../visualizerTypes";

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

function extractProtocolMessage(action: unknown): ProtocolEventMessage | null {
  const payload = extractProtocolEvent(action);
  const message = payload?.msg;
  return message && typeof message === "object" ? (message as ProtocolEventMessage) : null;
}

export function eventSubtype(event: VisualizerEvent): string | null {
  if (event.actionType !== "protocol_event") {
    return null;
  }
  const message = extractProtocolMessage(event.action);
  const subtype = message?.type;
  return typeof subtype === "string" ? subtype : null;
}

export function eventId(event: VisualizerEvent): string | null {
  const payload = extractProtocolEvent(event.action);
  const id = payload?.id;
  return typeof id === "string" ? id : null;
}

export function isDeltaEvent(event: VisualizerEvent): boolean {
  const subtype = eventSubtype(event);
  if (subtype && subtype.includes("_delta")) {
    return true;
  }
  return event.actionType.includes("_delta");
}
