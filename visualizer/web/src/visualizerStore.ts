import { proxy, subscribe as subscribeProxy } from "valtio";
import { useSnapshot } from "valtio/react";
import {
  appendDisplayEvent,
  createAggregatorState,
  rebuildDisplayEvents,
} from "./eventAggregator";
import {
  ConnectionStatus,
  DisplayEvent,
  VisualizerEvent,
  VisualizerState,
  ReplayState,
} from "./visualizerTypes";

const MAX_EVENTS = 50000;

const aggregatorState = createAggregatorState();

export function createInitialReplayState(): ReplayState {
  return {
    mode: "live",
    status: "idle",
    speed: 1,
    cursor: -1,
    currentTime: 0,
    duration: 0,
    baseTimestampMs: null,
    buffer: [],
    displayEvents: [],
    pendingLive: 0,
    pendingFrame: null,
  } satisfies ReplayState;
}

const displayEventListeners = new Set<(event: DisplayEvent) => void>();

export const visualizerStore = proxy<VisualizerState>({
  connectionStatus: "idle",
  events: [],
  displayEvents: [],
  replay: createInitialReplayState(),
});

function notifyLiveListeners(event: DisplayEvent) {
  for (const listener of displayEventListeners) {
    listener(event);
  }
}

export function setConnectionStatus(status: ConnectionStatus) {
  visualizerStore.connectionStatus = status;
}

export function replaceEvents(events: VisualizerEvent[]) {
  const trimmed = events.slice(-MAX_EVENTS);
  visualizerStore.events.splice(0, visualizerStore.events.length, ...trimmed);
  rebuildDisplayEvents(trimmed, visualizerStore.displayEvents, aggregatorState);
  if (visualizerStore.replay.mode === "replay") {
    visualizerStore.replay.pendingLive = 0;
  }
}

export function pushEvent(event: VisualizerEvent): DisplayEvent | null {
  visualizerStore.events.push(event);
  let rebuilt = false;

  if (visualizerStore.events.length > MAX_EVENTS) {
    const startIndex = visualizerStore.events.length - MAX_EVENTS;
    visualizerStore.events.splice(0, startIndex);
    rebuildDisplayEvents(visualizerStore.events, visualizerStore.displayEvents, aggregatorState);
    rebuilt = true;
  }

  const entry = rebuilt
    ? visualizerStore.displayEvents[visualizerStore.displayEvents.length - 1] ?? null
    : appendDisplayEvent(event, visualizerStore.displayEvents, aggregatorState);

  if (visualizerStore.replay.mode === "replay") {
    visualizerStore.replay.pendingLive += 1;
  }

  if (entry) {
    notifyLiveListeners(entry);
  }

  return entry;
}

export function onDisplayEvent(listener: (event: DisplayEvent) => void): () => void {
  displayEventListeners.add(listener);
  return () => {
    displayEventListeners.delete(listener);
  };
}

export function useVisualizerSnapshot() {
  return useSnapshot(visualizerStore);
}

export function useReplaySnapshot() {
  return useSnapshot(visualizerStore).replay;
}

export function subscribeToVisualizerStore(
  listener: (state: VisualizerState) => void
): () => void {
  return subscribeProxy(visualizerStore, () => {
    listener(visualizerStore);
  });
}

export function getVisualizerStore() {
  return visualizerStore;
}

export const VISUALIZER_MAX_EVENTS = MAX_EVENTS;
