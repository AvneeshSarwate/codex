import { getVisualizerState } from "../visualizerClient";
import { VisualizerEvent } from "../visualizerTypes";
import { advanceReplay, isReplayMode, replayStatus } from "../replay/replayStore";
import { Launcher, CircleSnapshot } from "./launcher";

export const SKETCH_WIDTH = 640;
export const SKETCH_HEIGHT = 480;

export type FrameMode = "live" | "replay";

export type VisualizerFrame = {
  mode: FrameMode;
  snapshots: CircleSnapshot[];
};

export type FrameListener = (frame: VisualizerFrame) => void;

export class VisualizerAnimationController {
  private liveSequenceSeen = -1;
  private lastMode: FrameMode = "live";

  constructor(private readonly launcher: Launcher, private readonly notify: FrameListener) {}

  tick(nowSeconds: number) {
    const replayMode = isReplayMode();

    if (!replayMode && this.lastMode === "replay") {
      this.launcher.reset();
      this.updateLiveSequenceToLatest();
    }
    this.lastMode = replayMode ? "replay" : "live";

    if (!replayMode) {
      const events = this.drainLiveEvents();
      if (events.length > 0) {
        this.launcher.processEvents(events, nowSeconds);
      }
      const snapshots = this.launcher.update(nowSeconds);
      this.notify({ mode: "live", snapshots });
      return;
    }

    if (replayStatus() === "playing") {
      advanceReplay();
    }

    const replayState = getVisualizerState().replay;
    const timestamp = replayState.currentTime;
    const snapshots = Launcher.fromReplay(replayState.circles, timestamp);
    this.notify({ mode: "replay", snapshots });
  }

  private drainLiveEvents(): VisualizerEvent[] {
    const { events } = getVisualizerState();
    if (!events || events.length === 0) {
      return [];
    }

    const fresh: VisualizerEvent[] = [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.sequence <= this.liveSequenceSeen) {
        break;
      }
      fresh.push(event);
    }

    if (fresh.length === 0) {
      return [];
    }

    fresh.reverse();
    this.liveSequenceSeen = fresh[fresh.length - 1]?.sequence ?? this.liveSequenceSeen;
    return fresh;
  }

  private updateLiveSequenceToLatest() {
    const { events } = getVisualizerState();
    if (!events || events.length === 0) {
      this.liveSequenceSeen = -1;
      return;
    }
    this.liveSequenceSeen = events[events.length - 1]?.sequence ?? -1;
  }
}
