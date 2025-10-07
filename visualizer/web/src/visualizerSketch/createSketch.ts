import p5 from "p5";
import { getVisualizerState } from "../visualizerClient";
import { VisualizerEvent } from "../visualizerTypes";
import {
  advanceReplay,
  isReplayMode,
  replayStatus,
} from "../replay/replayStore";
import { Launcher, CircleSnapshot } from "./launcher";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

export function createVisualizerSketch(launcher: Launcher) {
  let liveSequenceSeen = -1;
  let lastMode: "live" | "replay" = "live";

  function drainLiveEvents(): VisualizerEvent[] {
    const { events } = getVisualizerState();
    if (!events || events.length === 0) {
      return [];
    }

    const fresh: VisualizerEvent[] = [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.sequence <= liveSequenceSeen) {
        break;
      }
      fresh.push(event);
    }

    if (fresh.length === 0) {
      return [];
    }

    fresh.reverse();
    liveSequenceSeen = fresh[fresh.length - 1]?.sequence ?? liveSequenceSeen;
    return fresh;
  }

  function updateLiveSequenceToLatest() {
    const { events } = getVisualizerState();
    if (!events || events.length === 0) {
      liveSequenceSeen = -1;
      return;
    }
    liveSequenceSeen = events[events.length - 1]?.sequence ?? -1;
  }

  function renderSnapshots(p: p5, snapshots: CircleSnapshot[]) {
    p.background(12, 18, 32);
    const scale = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const circle of snapshots) {
      const x = circle.x * CANVAS_WIDTH;
      const y = circle.y * CANVAS_HEIGHT;
      const radius = circle.radius * scale;

      p.stroke(circle.stroke);
      p.strokeWeight(circle.state === "flying" ? 3 : 2);
      p.fill(circle.fill);
      p.circle(x, y, radius * 2);
    }
  }

  return (p: p5) => {
    p.setup = () => {
      p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      p.frameRate(60);
      p.noStroke();
      p.smooth();
    };

    p.draw = () => {
      const nowSeconds = p.millis() / 1000;
      const deltaSeconds = p.deltaTime / 1000;
      const replayMode = isReplayMode();

      if (!replayMode && lastMode === "replay") {
        launcher.reset();
        updateLiveSequenceToLatest();
      }
      lastMode = replayMode ? "replay" : "live";

      if (!replayMode) {
        const events = drainLiveEvents();
        if (events.length > 0) {
          launcher.processEvents(events, nowSeconds);
        }
        renderSnapshots(p, launcher.update(nowSeconds));
        return;
      }

      if (replayStatus() === "playing") {
        advanceReplay(deltaSeconds);
      }

      const replayState = getVisualizerState().replay;
      const timestamp = replayState.currentTime;
      const snapshots = Launcher.fromReplay(replayState.circles, timestamp);
      renderSnapshots(p, snapshots);
    };
  };
}

export const SKETCH_WIDTH = CANVAS_WIDTH;
export const SKETCH_HEIGHT = CANVAS_HEIGHT;
