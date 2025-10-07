import { useMemo } from "react";
import { useReplaySnapshot } from "../visualizerStore";

export function useReplayState() {
  return useReplaySnapshot();
}

export function useReplayProgress() {
  const replay = useReplaySnapshot();
  return useMemo(() => ({
    current: replay.currentTime,
    duration: replay.duration,
  }), [replay.currentTime, replay.duration]);
}
