import { colorForAction } from "../theme";
import { VisualizerEvent, ReplayCircle } from "../visualizerTypes";
import { eventSubtype, isDeltaEvent } from "./eventDetails";
import { buildEventMatchKey } from "./circleKeys";

const BASE_Y = 2 / 3;
const STACK_SPACING = 0.08;
const BASE_RADIUS = 0.04;
const MAX_RADIUS = 0.12;
const GROWTH_PER_DELTA = 0.75;
const PASSIVE_GROWTH_PER_SECOND = 0.35;
export const TRAVEL_DURATION = 1;
const EPSILON = 1e-6;

export type CircleSnapshot = {
  id: string;
  x: number;
  y: number;
  radius: number;
  fill: string;
  stroke: string;
  state: "charging" | "flying";
  matchKey: string;
  primarySequence: number;
  latestSequence: number;
};

type CircleState = "charging" | "flying";

type LaunchCircle = {
  id: string;
  matchKey: string;
  eventType: string;
  subtype: string | null;
  fill: string;
  stroke: string;
  state: CircleState;
  x: number;
  y: number;
  radius: number;
  charge: number;
  createdAt: number;
  launchedAt: number | null;
  lastUpdate: number;
  primarySequence: number;
  latestSequence: number;
};

function makeCircleId(event: VisualizerEvent): string {
  return `circle-${event.sequence}-${event.timestampMs}`;
}

function pickFillColor(eventType: string, subtype: string | null): string {
  return colorForAction(subtype ?? eventType);
}

export class Launcher {
  private readonly circles: LaunchCircle[] = [];
  private readonly charging = new Map<string, LaunchCircle>();

  reset() {
    this.circles.splice(0, this.circles.length);
    this.charging.clear();
  }

  processEvents(events: VisualizerEvent[], timestamp: number) {
    if (events.length === 0) {
      return;
    }

    const launchedThisFrame: LaunchCircle[] = [];

    for (const event of events) {
      const subtype = eventSubtype(event);
      const matchKey = buildEventMatchKey(event);
      const primaryColor = colorForAction(event.actionType);
      const fillColor = pickFillColor(event.actionType, subtype);
      const now = timestamp;

      if (isDeltaEvent(event)) {
        let circle = this.charging.get(matchKey);
        if (!circle) {
          circle = {
            id: makeCircleId(event),
            matchKey,
            eventType: event.actionType,
            subtype,
            fill: fillColor,
            stroke: primaryColor,
            state: "charging",
            x: 1,
            y: BASE_Y,
            radius: BASE_RADIUS,
            charge: 0,
            createdAt: now,
            launchedAt: null,
            lastUpdate: now,
            primarySequence: event.sequence,
            latestSequence: event.sequence,
          } satisfies LaunchCircle;
          this.charging.set(matchKey, circle);
          this.circles.push(circle);
        }
        circle.charge += 1;
        circle.lastUpdate = now;
        circle.subtype = subtype;
        circle.fill = fillColor;
        circle.stroke = primaryColor;
        circle.latestSequence = Math.max(circle.latestSequence, event.sequence);
        continue;
      }

      const pending = this.charging.get(matchKey);
      if (pending) {
        pending.state = "flying";
        pending.launchedAt = now;
        pending.lastUpdate = now;
        pending.x = 1;
        pending.latestSequence = Math.max(pending.latestSequence, event.sequence);
        launchedThisFrame.push(pending);
        this.charging.delete(matchKey);
        continue;
      }

      const circle: LaunchCircle = {
        id: makeCircleId(event),
        matchKey,
        eventType: event.actionType,
        subtype,
        fill: fillColor,
        stroke: primaryColor,
        state: "flying",
        x: 1,
        y: BASE_Y,
        radius: BASE_RADIUS,
        charge: 0,
        createdAt: now,
        launchedAt: now,
        lastUpdate: now,
        primarySequence: event.sequence,
        latestSequence: event.sequence,
      };
      this.circles.push(circle);
      launchedThisFrame.push(circle);
    }

    if (launchedThisFrame.length > 0) {
      launchedThisFrame.forEach((circle, index) => {
        const offset = index * STACK_SPACING;
        circle.y = Math.max(0.05, BASE_Y - offset);
      });
    }
  }

  update(timestamp: number): CircleSnapshot[] {
    const snapshots: CircleSnapshot[] = [];

    for (let index = this.circles.length - 1; index >= 0; index -= 1) {
      const circle = this.circles[index];
      const elapsed = Math.max(0, timestamp - circle.lastUpdate);
      circle.lastUpdate = timestamp;

      if (circle.state === "charging") {
        circle.charge += elapsed * PASSIVE_GROWTH_PER_SECOND;
        const growth = 1 - Math.exp(-circle.charge * GROWTH_PER_DELTA);
        circle.radius = BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * growth;
        circle.x = 1;
      } else if (circle.state === "flying") {
        if (circle.launchedAt === null) {
          circle.launchedAt = timestamp;
        }
        const travelElapsed = timestamp - circle.launchedAt;
        const progress = travelElapsed / TRAVEL_DURATION;
        circle.x = 1 - progress;
        circle.radius = Math.max(BASE_RADIUS, circle.radius);
        if (progress >= 1.05) {
          this.circles.splice(index, 1);
          continue;
        }
      }

      snapshots.push({
        id: circle.id,
        x: circle.x,
        y: circle.y,
        radius: Math.min(circle.radius, MAX_RADIUS),
        fill: circle.fill,
        stroke: circle.stroke,
        state: circle.state,
        matchKey: circle.matchKey,
        primarySequence: circle.primarySequence,
        latestSequence: circle.latestSequence,
      });
    }

    return snapshots;
  }

  static fromReplay(circles: ReplayCircle[], timestamp: number): CircleSnapshot[] {
    const chargingCandidates = circles
      .filter((circle) => circle.launchTime === null || timestamp + EPSILON < circle.launchTime)
      .slice()
      .sort((a, b) => a.chargingStart - b.chargingStart);

    const chargingPositions = new Map<string, number>();
    chargingCandidates.forEach((circle, index) => {
      chargingPositions.set(circle.id, index);
    });

    const snapshots: CircleSnapshot[] = [];

    for (const circle of circles) {
      if (timestamp + EPSILON < circle.chargingStart) {
        continue;
      }

      const activeTime = Math.max(0, Math.min(timestamp, circle.launchTime ?? timestamp) - circle.chargingStart);
      const growth = 1 - Math.exp(-activeTime * GROWTH_PER_DELTA);
      const radius = BASE_RADIUS + (MAX_RADIUS - BASE_RADIUS) * growth;

      if (circle.launchTime !== null && timestamp >= circle.launchTime - EPSILON) {
        const flyElapsed = timestamp - circle.launchTime;
        const progress = flyElapsed / TRAVEL_DURATION;
        if (progress >= 1.05) {
          continue;
        }

        snapshots.push({
          id: circle.id,
          x: 1 - progress,
          y: Math.max(0.05, BASE_Y - circle.stackIndex * STACK_SPACING),
          radius: Math.min(radius, MAX_RADIUS),
          fill: circle.fill,
          stroke: circle.stroke,
          state: "flying",
          matchKey: circle.matchKey,
          primarySequence: circle.primarySequence,
          latestSequence: circle.latestSequence,
        });
        continue;
      }

      const stackIndex = chargingPositions.get(circle.id) ?? 0;
      snapshots.push({
        id: circle.id,
        x: 1,
        y: Math.max(0.05, BASE_Y - stackIndex * STACK_SPACING),
        radius: Math.min(radius, MAX_RADIUS),
        fill: circle.fill,
        stroke: circle.stroke,
        state: "charging",
        matchKey: circle.matchKey,
        primarySequence: circle.primarySequence,
        latestSequence: circle.latestSequence,
      });
    }

    return snapshots;
  }
}
