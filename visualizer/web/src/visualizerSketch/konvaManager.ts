import Konva from "konva";
import { SKETCH_HEIGHT, SKETCH_WIDTH, VisualizerFrame } from "./animationController";
import { CircleSnapshot } from "./launcher";

const CANVAS_SCALE = Math.min(SKETCH_WIDTH, SKETCH_HEIGHT);
const BASE_BACKGROUND = "#0c1220";
const HIGHLIGHT_STROKE = "#ffffff";
const HIGHLIGHT_EXTRA_RADIUS = 10;
const HIGHLIGHT_STROKE_WIDTH = 5;
const STROKE_WIDTH_FLYING = 4;
const STROKE_WIDTH_CHARGING = 3;

export type CircleSelection = {
  primarySequence: number;
  latestSequence: number;
};

type CircleNode = {
  shape: Konva.Circle;
  highlight: Konva.Circle | null;
  snapshot: CircleSnapshot;
};

export class KonvaStageManager {
  private readonly stage: Konva.Stage;
  private readonly backgroundLayer: Konva.Layer;
  private readonly circleLayer: Konva.Layer;
  private readonly circles = new Map<string, CircleNode>();
  private highlightSequences = new Set<number>();
  private selectListener: ((selection: CircleSelection) => void) | null = null;
  private disposed = false;

  constructor(container: HTMLDivElement) {
    this.stage = new Konva.Stage({
      container,
      width: SKETCH_WIDTH,
      height: SKETCH_HEIGHT,
    });

    this.backgroundLayer = new Konva.Layer();
    this.circleLayer = new Konva.Layer();

    this.stage.add(this.backgroundLayer);
    this.stage.add(this.circleLayer);

    this.drawBackground();
  }

  destroy() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stage.destroy();
    this.circles.clear();
  }

  setSelectionListener(listener: ((selection: CircleSelection) => void) | null) {
    this.selectListener = listener;
  }

  setHighlightSequences(sequences: Set<number>) {
    this.highlightSequences = new Set(sequences);
    this.updateHighlights();
  }

  applyFrame(frame: VisualizerFrame) {
    if (this.disposed) {
      return;
    }
    const seen = new Set<string>();

    for (const snapshot of frame.snapshots) {
      seen.add(snapshot.id);
      this.upsertCircle(snapshot);
    }

    for (const [id, node] of this.circles) {
      if (!seen.has(id)) {
        node.shape.destroy();
        node.highlight?.destroy();
        this.circles.delete(id);
      }
    }

    this.circleLayer.batchDraw();
  }

  locateCircleBySequence(sequence: number): CircleSnapshot | null {
    for (const node of this.circles.values()) {
      if (node.snapshot.primarySequence === sequence || node.snapshot.latestSequence === sequence) {
        return node.snapshot;
      }
    }
    return null;
  }

  private upsertCircle(snapshot: CircleSnapshot) {
    const radius = snapshot.radius * CANVAS_SCALE;
    const x = snapshot.x * SKETCH_WIDTH;
    const y = snapshot.y * SKETCH_HEIGHT;
    const strokeWidth = snapshot.state === "flying" ? STROKE_WIDTH_FLYING : STROKE_WIDTH_CHARGING;
    const highlight = this.shouldHighlight(snapshot);

    const node = this.circles.get(snapshot.id);
    if (!node) {
      const shape = new Konva.Circle({
        x,
        y,
        radius,
        fill: snapshot.fill,
        stroke: snapshot.stroke,
        strokeWidth,
        listening: true,
      });
      shape.on("mousedown touchstart", () => {
        const current = this.circles.get(snapshot.id);
        if (current) {
          this.handleCircleSelect(current.snapshot);
        }
      });

      const highlightCircle = highlight
        ? this.createHighlightCircle(x, y, radius + HIGHLIGHT_EXTRA_RADIUS)
        : null;

      this.circleLayer.add(shape);
      if (highlightCircle) {
        this.circleLayer.add(highlightCircle);
        highlightCircle.moveToTop();
        shape.moveToTop();
      }

      this.circles.set(snapshot.id, {
        shape,
        highlight: highlightCircle,
        snapshot,
      });
      return;
    }

    node.snapshot = snapshot;
    node.shape.position({ x, y });
    node.shape.radius(radius);
    node.shape.fill(snapshot.fill);
    node.shape.stroke(snapshot.stroke);
    node.shape.strokeWidth(strokeWidth);

    if (highlight) {
      if (!node.highlight) {
        node.highlight = this.createHighlightCircle(x, y, radius + HIGHLIGHT_EXTRA_RADIUS);
        this.circleLayer.add(node.highlight);
      }
      node.highlight.position({ x, y });
      node.highlight.radius(radius + HIGHLIGHT_EXTRA_RADIUS);
      node.highlight.visible(true);
      node.highlight.moveToTop();
      node.shape.moveToTop();
    } else if (node.highlight) {
      node.highlight.destroy();
      node.highlight = null;
    }

    node.shape.moveToTop();
    if (node.highlight) {
      node.highlight.moveToTop();
    }
  }

  private createHighlightCircle(x: number, y: number, radius: number): Konva.Circle {
    return new Konva.Circle({
      x,
      y,
      radius,
      stroke: HIGHLIGHT_STROKE,
      strokeWidth: HIGHLIGHT_STROKE_WIDTH,
      listening: false,
    });
  }

  private handleCircleSelect(snapshot: CircleSnapshot) {
    if (!this.selectListener) {
      return;
    }
    this.selectListener({
      primarySequence: snapshot.primarySequence,
      latestSequence: snapshot.latestSequence,
    });
  }

  private updateHighlights() {
    for (const node of this.circles.values()) {
      const radius = node.snapshot.radius * CANVAS_SCALE;
      const x = node.snapshot.x * SKETCH_WIDTH;
      const y = node.snapshot.y * SKETCH_HEIGHT;
      const highlight = this.shouldHighlight(node.snapshot);
      if (highlight) {
        if (!node.highlight) {
          node.highlight = this.createHighlightCircle(x, y, radius + HIGHLIGHT_EXTRA_RADIUS);
          this.circleLayer.add(node.highlight);
        }
        node.highlight.position({ x, y });
        node.highlight.radius(radius + HIGHLIGHT_EXTRA_RADIUS);
        node.highlight.visible(true);
        node.highlight.moveToTop();
        node.shape.moveToTop();
      } else if (node.highlight) {
        node.highlight.destroy();
        node.highlight = null;
      }
    }
    this.circleLayer.batchDraw();
  }

  private shouldHighlight(snapshot: CircleSnapshot): boolean {
    if (this.highlightSequences.size === 0) {
      return false;
    }
    const minSequence = Math.min(snapshot.primarySequence, snapshot.latestSequence);
    const maxSequence = Math.max(snapshot.primarySequence, snapshot.latestSequence);
    for (const sequence of this.highlightSequences) {
      if (sequence >= minSequence && sequence <= maxSequence) {
        return true;
      }
    }
    return false;
  }

  private drawBackground() {
    const backgroundRect = new Konva.Rect({
      x: 0,
      y: 0,
      width: SKETCH_WIDTH,
      height: SKETCH_HEIGHT,
      fill: BASE_BACKGROUND,
      listening: false,
    });
    this.backgroundLayer.add(backgroundRect);
    this.backgroundLayer.batchDraw();
  }
}
