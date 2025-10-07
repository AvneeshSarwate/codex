import { getVisualizerStore, visualizerStore, createInitialReplayState, snapshotDisplayEvents } from "../visualizerStore";
import { colorForAction } from "../theme";
import { eventSubtype, isDeltaEvent } from "../visualizerSketch/eventDetails";
import { buildEventMatchKey } from "../visualizerSketch/circleKeys";
import { TRAVEL_DURATION } from "../visualizerSketch/launcher";
import {
  DisplayEvent,
  ReplayCircle,
  ReplayEvent,
  ReplayFrameUpdate,
  ReplayState,
  VisualizerEvent,
} from "../visualizerTypes";

const EPSILON = 1e-3;
const EPSILON_MS = 1;

function nowSeconds(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

function sortEvents(events: VisualizerEvent[]): VisualizerEvent[] {
  return [...events].sort((a, b) => a.sequence - b.sequence);
}

function replayTotalDuration(replay: ReplayState): number {
  return replay.duration + TRAVEL_DURATION;
}

type ActiveReplayCharge = {
  matchKey: string;
  chargingStart: number;
  fill: string;
  stroke: string;
  subtype: string | null;
  actionType: string;
  startSequence: number;
  latestSequence: number;
};

function buildReplayCircles(events: ReplayEvent[]): ReplayCircle[] {
  const circles: ReplayCircle[] = [];
  const active = new Map<string, ActiveReplayCharge>();
  const launchStacks = new Map<number, number>();

  for (const event of events) {
    const subtype = eventSubtype(event);
    const matchKey = buildEventMatchKey(event);
    const stroke = colorForAction(event.actionType);
    const fill = colorForAction(subtype ?? event.actionType);
    const time = event.relativeTime;

    if (isDeltaEvent(event)) {
      if (!active.has(matchKey)) {
        active.set(matchKey, {
          matchKey,
          chargingStart: time,
          fill,
          stroke,
          subtype,
          actionType: event.actionType,
          startSequence: event.sequence,
          latestSequence: event.sequence,
        });
      } else {
        const entry = active.get(matchKey)!;
        entry.fill = fill;
        entry.stroke = stroke;
        entry.subtype = subtype;
        entry.actionType = event.actionType;
        entry.latestSequence = Math.max(entry.latestSequence, event.sequence);
      }
      continue;
    }

    const stackKey = Math.round(time * 1000);
    const stackIndex = launchStacks.get(stackKey) ?? 0;
    launchStacks.set(stackKey, stackIndex + 1);

    const entry = active.get(matchKey);
    if (entry) {
      entry.fill = fill;
      entry.stroke = stroke;
      entry.subtype = subtype;
      entry.actionType = event.actionType;
      entry.latestSequence = Math.max(entry.latestSequence, event.sequence);
      circles.push({
        id: `replay-circle-${event.sequence}`,
        actionType: event.actionType,
        subtype,
        fill,
        stroke,
        chargingStart: entry.chargingStart,
        launchTime: time,
        stackIndex,
        matchKey: entry.matchKey,
        primarySequence: entry.startSequence,
        latestSequence: entry.latestSequence,
      });
      active.delete(matchKey);
    } else {
      circles.push({
        id: `replay-circle-${event.sequence}`,
        actionType: event.actionType,
        subtype,
        fill,
        stroke,
        chargingStart: time,
        launchTime: time,
        stackIndex,
        matchKey,
        primarySequence: event.sequence,
        latestSequence: event.sequence,
      });
    }
  }

  const orphaned = [...active.values()]
    .sort((a, b) => a.chargingStart - b.chargingStart || a.startSequence - b.startSequence);
  orphaned.forEach((entry, index) => {
    circles.push({
      id: `replay-circle-${entry.startSequence}-pending`,
      actionType: entry.actionType,
      subtype: entry.subtype,
      fill: entry.fill,
      stroke: entry.stroke,
      chargingStart: entry.chargingStart,
      launchTime: null,
      stackIndex: index,
      matchKey: entry.matchKey,
      primarySequence: entry.startSequence,
      latestSequence: entry.latestSequence,
    });
  });

  return circles;
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

function displayEventTimestampMs(display: DisplayEvent): number {
  const segments = display.aggregated?.events;
  if (segments && segments.length > 0) {
    const last = segments[segments.length - 1];
    if (last) {
      return last.timestampMs;
    }
  }
  return display.event.timestampMs;
}

function displayIndexForSequence(replay: ReplayState, sequence: number | undefined): number {
  if (sequence === undefined) {
    return -1;
  }
  const index = replay.sequenceIndex[sequence];
  return typeof index === "number" ? index : -1;
}

function displayIndexForTime(replay: ReplayState, timeSeconds: number): number {
  if (replay.displayEvents.length === 0 || replay.baseTimestampMs === null) {
    return -1;
  }
  const targetTimestamp = replay.baseTimestampMs + timeSeconds * 1000;
  let index = -1;
  for (let i = 0; i < replay.displayEvents.length; i += 1) {
    const display = replay.displayEvents[i];
    if (displayEventTimestampMs(display) <= targetTimestamp + EPSILON_MS) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

function syncDisplayCursorFromBuffer(replay: ReplayState) {
  if (replay.cursor < 0) {
    replay.displayCursor = -1;
    return;
  }
  const sequence = replay.buffer[replay.cursor]?.sequence;
  const bySequence = displayIndexForSequence(replay, sequence);
  if (bySequence !== -1) {
    replay.displayCursor = bySequence;
    return;
  }
  const byTime = displayIndexForTime(replay, replay.currentTime);
  replay.displayCursor = byTime;
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
  const { displayEvents, sequenceIndex } = snapshotDisplayEvents();
  const circles = buildReplayCircles(buffer);
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
  replay.sequenceIndex = sequenceIndex;
  replay.bufferIndex = buffer.reduce<Record<number, number>>((map, event, index) => {
    map[event.sequence] = index;
    return map;
  }, {});
  replay.displayCursor = -1;
  replay.pendingLive = 0;
  replay.pendingFrame = { timestamp: 0, events: [], reset: true } satisfies ReplayFrameUpdate;
  replay.circles = circles;
  replay.lastTick = null;
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
  replay.lastTick = nowSeconds();
}

export function pauseReplay() {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay") {
    return;
  }
  replay.status = "paused";
  replay.lastTick = null;
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
  replay.lastTick = nowSeconds();
  replay.displayCursor = -1;
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
  const previousCursor = replay.cursor;
  const previousTime = replay.currentTime;
  const clamped = Math.max(0, Math.min(timeSeconds, replayTotalDuration(replay)));
  const targetIndex = findTargetIndex(replay, clamped);
  const rewinding =
    targetIndex < previousCursor || clamped + EPSILON < previousTime;

  const events: VisualizerEvent[] = [];
  const startIndex = rewinding ? 0 : previousCursor + 1;
  for (let index = startIndex; index <= targetIndex; index += 1) {
    const next = replay.buffer[index];
    if (next) {
      events.push(next);
    }
  }

  replay.cursor = targetIndex;
  replay.currentTime = clamped;
  replay.lastTick = nowSeconds();
  syncDisplayCursorFromBuffer(replay);

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
    replay.displayCursor = -1;
    const frame: ReplayFrameUpdate = { timestamp: 0, events: [], reset: true };
    replay.pendingFrame = frame;
    return frame;
  }
  const clampedIndex = Math.max(-1, Math.min(index, replay.buffer.length - 1));
  if (clampedIndex === -1) {
    const frame = seekReplayToTime(0);
    replay.displayCursor = -1;
    return frame;
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

function bufferIndexForDisplay(replay: ReplayState, displayIndex: number): number | undefined {
  if (displayIndex < 0 || displayIndex >= replay.displayEvents.length) {
    return undefined;
  }
  const displayEvent = replay.displayEvents[displayIndex];
  const sequences = displayEvent.sequences.length > 0 ? displayEvent.sequences : [displayEvent.event.sequence];
  let best: number | undefined;
  for (const sequence of sequences) {
    const candidate = replay.bufferIndex[sequence];
    if (typeof candidate === "number") {
      if (best === undefined || candidate < best) {
        best = candidate;
      }
    }
  }
  if (best !== undefined) {
    return best;
  }
  const fallback = replay.bufferIndex[displayEvent.event.sequence];
  return typeof fallback === "number" ? fallback : undefined;
}

export function stepReplayByDisplay(offset: number): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay" || replay.displayEvents.length === 0) {
    return { timestamp: replay.currentTime, events: [], reset: false };
  }

  const currentDisplayIndex = replay.displayCursor;

  if (currentDisplayIndex === -1 && offset <= 0) {
    const frame = seekReplayToIndex(-1);
    replay.displayCursor = -1;
    return frame;
  }

  let targetDisplayIndex = currentDisplayIndex === -1 ? 0 : currentDisplayIndex + offset;
  if (targetDisplayIndex < 0) {
    const frame = seekReplayToIndex(-1);
    replay.displayCursor = -1;
    return frame;
  }
  if (targetDisplayIndex >= replay.displayEvents.length) {
    targetDisplayIndex = replay.displayEvents.length - 1;
  }

  const targetBufferIndex = bufferIndexForDisplay(replay, targetDisplayIndex);
  let frame: ReplayFrameUpdate;
  if (typeof targetBufferIndex === "number") {
    frame = seekReplayToIndex(targetBufferIndex);
  } else {
    const targetEvent = replay.displayEvents[targetDisplayIndex];
    const fallbackTime = replay.baseTimestampMs !== null
      ? (displayEventTimestampMs(targetEvent) - replay.baseTimestampMs) / 1000
      : replay.currentTime;
    frame = seekReplayToTime(fallbackTime);
  }
  replay.displayCursor = targetDisplayIndex;
  return frame;
}

export function advanceReplay(): ReplayFrameUpdate {
  const replay = visualizerStore.replay;
  if (replay.mode !== "replay" || replay.status !== "playing") {
    replay.lastTick = null;
    return { timestamp: replay.currentTime, events: [], reset: false };
  }
  const now = nowSeconds();
  if (replay.lastTick === null) {
    replay.lastTick = now;
    return { timestamp: replay.currentTime, events: [], reset: false };
  }
  const deltaSeconds = (now - replay.lastTick) * replay.speed;
  replay.lastTick = now;
  if (deltaSeconds <= 0) {
    return { timestamp: replay.currentTime, events: [], reset: false };
  }
  const nextTime = replay.currentTime + deltaSeconds;
  const frame = seekReplayToTime(nextTime);
  if (frame.timestamp >= replayTotalDuration(replay) - EPSILON) {
    replay.status = "paused";
    replay.lastTick = null;
  }
  replay.pendingFrame = frame;
  return frame;
}

export function getReplayProgress(): { current: number; duration: number } {
  const replay = visualizerStore.replay;
  return { current: replay.currentTime, duration: replayTotalDuration(replay) };
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
