import p5 from "p5";
import { getVisualizerState } from "../visualizerClient";
import { VisualizerEvent } from "../visualizerTypes";
import { Launcher } from "./launcher";

const CANVAS_WIDTH = 640;
const CANVAS_HEIGHT = 480;

export function createVisualizerSketch(launcher: Launcher) {
  let lastSequenceSeen = -1;

  function drainNewEvents(): VisualizerEvent[] {
    const store = getVisualizerState();
    const events = store.events;
    if (!events || events.length === 0) {
      return [];
    }

    const fresh: VisualizerEvent[] = [];
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event.sequence <= lastSequenceSeen) {
        break;
      }
      fresh.push(event);
    }

    if (fresh.length === 0) {
      return [];
    }

    fresh.reverse();
    lastSequenceSeen = fresh[fresh.length - 1]?.sequence ?? lastSequenceSeen;
    return fresh;
  }

  return (p: p5) => {
    p.setup = () => {
      p.createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
      p.frameRate(60);
      p.noStroke();
      p.smooth();
    };

    p.draw = () => {
      const timestamp = p.millis() / 1000;
      const newEvents = drainNewEvents();
      if (newEvents.length > 0) {
        launcher.processEvents(newEvents, timestamp);
      }

      const circles = launcher.update(timestamp);

      p.background(12, 18, 32);
      const scale = Math.min(CANVAS_WIDTH, CANVAS_HEIGHT);

      for (const circle of circles) {
        const x = circle.x * CANVAS_WIDTH;
        const y = circle.y * CANVAS_HEIGHT;
        const radius = circle.radius * scale;

        p.stroke(circle.stroke);
        p.strokeWeight(circle.state === "flying" ? 3 : 2);
        p.fill(circle.fill);
        p.circle(x, y, radius * 2);
      }
    };
  };
}

export const SKETCH_WIDTH = CANVAS_WIDTH;
export const SKETCH_HEIGHT = CANVAS_HEIGHT;
