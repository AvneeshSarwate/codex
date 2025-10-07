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

export type ReplayPlaybackStatus = "idle" | "playing" | "paused";

export type ReplayMode = "live" | "replay";

export type ReplayEvent = VisualizerEvent & {
  relativeTime: number;
};

export type ReplayFrameUpdate = {
  timestamp: number;
  events: VisualizerEvent[];
  reset: boolean;
};

export type ReplayCircle = {
  id: string;
  actionType: string;
  subtype: string | null;
  fill: string;
  stroke: string;
  chargingStart: number;
  launchTime: number | null;
  stackIndex: number;
  matchKey: string;
  primarySequence: number;
  latestSequence: number;
};

export type ReplayState = {
  mode: ReplayMode;
  status: ReplayPlaybackStatus;
  speed: number;
  cursor: number;
  currentTime: number;
  duration: number;
  baseTimestampMs: number | null;
  buffer: ReplayEvent[];
  displayEvents: DisplayEvent[];
  pendingLive: number;
  pendingFrame: ReplayFrameUpdate | null;
  circles: ReplayCircle[];
  lastTick: number | null;
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
  replay: ReplayState;
};

export type VisualizerSocketMessage =
  | {
      type: "backlog";
      events: VisualizerEvent[];
    }
  | {
      type: "event";
      event: VisualizerEvent;
    };
