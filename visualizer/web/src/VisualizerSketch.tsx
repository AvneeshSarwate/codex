import { useEffect, useRef } from "react";
import p5 from "p5";
import { createVisualizerSketch, SKETCH_HEIGHT, SKETCH_WIDTH } from "./visualizerSketch/createSketch";
import { Launcher } from "./visualizerSketch/launcher";

export function VisualizerSketch() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<Launcher | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    if (!launcherRef.current) {
      launcherRef.current = new Launcher();
    }

    const sketch = createVisualizerSketch(launcherRef.current);
    const instance = new p5(sketch, container);

    return () => {
      instance.remove();
    };
  }, []);

  return (
    <div className="visualizer-sketch" style={{ width: `${SKETCH_WIDTH}px`, height: `${SKETCH_HEIGHT}px` }}>
      <div ref={containerRef} className="visualizer-sketch-inner" />
    </div>
  );
}
