import { aggregateDisplayEvents } from "../eventAggregator";
import { getVisualizerStore, visualizerStore, createInitialReplayState } from "../visualizerStore";
import {
  ReplayEvent,
  ReplayFrameUpdate,
  ReplayState,
  VisualizerEvent,
} from "../visualizerTypes";

const EPSILON = 1e-3;

function sortEvents(events: VisualizerEvent[]): VisualizerEvent[] {
  return [...events].sort((a, b) => a.sequence - b.sequence);
}

function buildReplayBuffer(events: VisualizerEvent[]): ReplayEvent[] {
  if (events.length === 0) {
    return [];
  }
  const sorted = sortEvents(events);
  const base = sorted[0].timestampMs;
  return sorted.map((event) => ({
    ...event,
    relativeTime: (event.timestampMs - base) / 1000,
  }));
}

function resetReplayState(target: ReplayState) {
  Object.assign(target, createInitialReplayState());
}

export function beginReplay(): boolean {
  const store = getVisualizerStore();
  const existing = store.replay;
  if (existing.mode === "replay") {
    return existing.buffer.length > 0;
  }

  const events = sortEvents(store.events);
  if (events.length === 0) {
    return false;
  }

  const buffer = buildReplayBuffer(events);
  const displayEvents = aggregateDisplayEvents(events);
  const duration = buffer[buffer.length - 1]?.relativeTime ?? 0;
  const replay = store.replay;
  replay.mode = "replay";
  replay.status = "paused";
  replay.speed = 1;
  replay.cursor = -1;
  replay.currentTime = 0;
  replay.duration = duration;
  replay.baseTimestampMs = buffer[0]?.timestampMs ?? null;
  replay.buffer = buffer;
  replay.displayEvents = displayEvents;
  replay.pendingLive = 0;
  replay.pendingFrame = { timestamp: 0, events: [], reset: true } satisfies ReplayFrameUpdate;
  return true;
}

export function exitReplay() {
  const replay = visualizerStore.replay;
  if (replay.mode === "live") {
    return;
  }
  resetReplayState(replay);
}

export function playReplay() {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay" || replay.buffer.length === 0) {
    return;
  }
  replay.status = "playing";
}

export function pauseReplay() {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return;
  }
  replay.status = "paused";
}

export function restartReplay(): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return { timestamp: 0, events: [], reset: false };
  }
  replay.cursor = -1;
  replay.currentTime = 0;
  replay.status = replay.buffer.length > 0 ? replay.status : "paused";
  const frame: ReplayFrameUpdate = { timestamp: 0, events: [], reset: true };
  replay.pendingFrame = frame;
  return frame;
}

export function setReplaySpeed(speed: number) {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return;
  }
  replay.speed = Math.max(0.25, Math.min(speed, 16));
}

function findTargetIndex(replay: ReplayState, targetTime: number): number {
  const buffer = replay.buffer;
  if (buffer.length === 0) {
    return -1;
  }
  let targetIndex = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index].relativeTime <= targetTime + EPSILON) {
      targetIndex = index;
    } else {
      break;
    }
  }
  return targetIndex;
}

export function seekReplayToTime(timeSeconds: number): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return { timestamp: 0, events: [], reset: false };
  }
  const clamped = Math.max(0, Math.min(timeSeconds, replay.duration));
  const targetIndex = findTargetIndex(replay, clamped);
  const rewinding = targetIndex < replay.cursor;

  const events: VisualizerEvent[] = [];
  const startIndex = rewinding ? 0 : replay.cursor + 1;
  for (let index = startIndex; index <= targetIndex; index += 1) {
    const next = replay.buffer[index];
    if (next) {
      events.push(next);
    }
  }

  replay.cursor = targetIndex;
  replay.currentTime = clamped;

  const frame: ReplayFrameUpdate = {
    timestamp: clamped,
    events,
    reset: rewinding,
  };

  replay.pendingFrame = frame;
  return frame;
}

export function seekReplayToIndex(index: number): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return { timestamp: 0, events: [], reset: false };
  }
  if (replay.buffer.length === 0) {
    replay.cursor = -1;
    replay.currentTime = 0;
    const frame: ReplayFrameUpdate = { timestamp: 0, events: [], reset: true };
    replay.pendingFrame = frame;
    return frame;
  }
  const clampedIndex = Math.max(-1, Math.min(index, replay.buffer.length - 1));
  if (clampedIndex === -1) {
    return seekReplayToTime(0);
  }
  const targetTime = replay.buffer[clampedIndex].relativeTime;
  return seekReplayToTime(targetTime);
}

export function stepReplay(step: number): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return { timestamp: 0, events: [], reset: false };
  }
  const nextIndex = Math.max(-1, Math.min(replay.cursor + step, replay.buffer.length - 1));
  return seekReplayToIndex(nextIndex);
}

export function advanceReplay(deltaSeconds: number): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay" || replay.status !== "playing") {
    return { timestamp: replay.currentTime, events: [], reset: false };
  }
  const nextTime = replay.currentTime + deltaSeconds * replay.speed;
  const frame = seekReplayToTime(nextTime);
  if (frame.timestamp >= replay.duration) {
    replay.status = "paused";
  }
  replay.pendingFrame = frame;
  return frame;
}

export function getReplayProgress(): { current: number; duration: number } {
  const replay = visualizerStore.replay;
  return { current: replay.currentTime, duration: replay.duration };
}

export function consumePendingReplayFrame(): ReplayFrameUpdate | null {
  const replay = visualizerStore.replay;
  const frame = replay.pendingFrame;
  if (!frame) {
    return null;
  }
  replay.pendingFrame = null;
  return frame;
}

export function isReplayMode(): boolean {
  return visualizerStore.replay.mode === "replay";
}

export function replayStatus() {
  return visualizerStore.replay.status;
}
