import { useEffect, useRef } from "react";
import {
  SKETCH_HEIGHT,
  SKETCH_WIDTH,
  VisualizerAnimationController,
} from "./visualizerSketch/animationController";
import { CircleSelection, KonvaStageManager } from "./visualizerSketch/konvaManager";
import { Launcher } from "./visualizerSketch/launcher";

type VisualizerSketchProps = {
  highlightKeys: Set<string>;
  onCircleSelect: (selection: CircleSelection) => void;
};

export function VisualizerSketch({ highlightKeys, onCircleSelect }: VisualizerSketchProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<Launcher | null>(null);
  const managerRef = useRef<KonvaStageManager | null>(null);
  const controllerRef = useRef<VisualizerAnimationController | null>(null);
  const onCircleSelectRef = useRef(onCircleSelect);

  useEffect(() => {
    onCircleSelectRef.current = onCircleSelect;
  }, [onCircleSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (!launcherRef.current) {
      launcherRef.current = new Launcher();
    }

    const manager = new KonvaStageManager(container);
    managerRef.current = manager;
    manager.setSelectionListener((selection) => {
      onCircleSelectRef.current(selection);
    });

    const controller = new VisualizerAnimationController(launcherRef.current, (frame) => {
      manager.applyFrame(frame);
    });
    controllerRef.current = controller;

    let rafId = 0;
    const tick = () => {
      const nowSeconds =
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now() / 1000
          : Date.now() / 1000;
      controller.tick(nowSeconds);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      manager.setSelectionListener(null);
      manager.destroy();
      managerRef.current = null;
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    managerRef.current?.setHighlightKeys(highlightKeys);
  }, [highlightKeys]);

  return (
    <div className="visualizer-sketch" style={{ width: `${SKETCH_WIDTH}px`, height: `${SKETCH_HEIGHT}px` }}>
      <div ref={containerRef} className="visualizer-sketch-inner" />
    </div>
  );
}
