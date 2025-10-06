export type VisualizerEvent = {
  sequence: number;
  timestampMs: number;
  conversationId?: string;
  actionType: string;
  action: unknown;
  state?: unknown;
};

export type ProtocolEventMessage = {
  type?: string;
  delta?: unknown;
  text?: unknown;
};

export type ProtocolEventPayload = {
  id?: string;
  msg?: ProtocolEventMessage;
};

export type ProtocolEventAction = {
  event?: ProtocolEventPayload;
};

export type AggregatedDelta = {
  subtype: string;
  combinedText: string;
  events: VisualizerEvent[];
};

export type DisplayEvent = {
  event: VisualizerEvent;
  subtype: string | null;
  aggregated?: AggregatedDelta;
};

export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "idle";

export type VisualizerState = {
  connectionStatus: ConnectionStatus;
  events: VisualizerEvent[];
  displayEvents: DisplayEvent[];
};
