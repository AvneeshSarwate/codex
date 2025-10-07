import { ChangeEvent, useMemo } from "react";
import {
  beginReplay,
  exitReplay,
  pauseReplay,
  playReplay,
  restartReplay,
  seekReplayToTime,
  setReplaySpeed,
  stepReplayByDisplay,
} from "./replayStore";
import { useReplayState } from "./hooks";
import { TRAVEL_DURATION } from "../visualizerSketch/launcher";

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }
  const clamped = Math.max(0, value);
  const minutes = Math.floor(clamped / 60);
  const seconds = Math.floor(clamped % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

const SPEED_OPTIONS = [0.5, 1, 2, 4];

type ReplayControlsProps = {
  eventCount: number;
};

export function ReplayControls({ eventCount }: ReplayControlsProps) {
  const replay = useReplayState();
  const hasEvents = eventCount > 0;

  const totalDuration = replay.duration + TRAVEL_DURATION;
  const durationLabel = useMemo(() => formatTime(totalDuration), [totalDuration]);
  const currentLabel = useMemo(() => formatTime(replay.currentTime), [replay.currentTime]);

  const canEnterReplay = hasEvents && replay.mode === "live";

  const handleEnterReplay = () => {
    beginReplay();
  };

  const handleExitReplay = () => {
    exitReplay();
  };

  const handleTogglePlay = () => {
    if (replay.status === "playing") {
      pauseReplay();
      return;
    }
    playReplay();
  };

  const handleRestart = () => {
    pauseReplay();
    restartReplay();
  };

  const handleStepBack = () => {
    pauseReplay();
    stepReplayByDisplay(-1);
  };

  const handleStepForward = () => {
    pauseReplay();
    stepReplayByDisplay(1);
  };

  const handleSpeedChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      setReplaySpeed(value);
    }
  };

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    if (Number.isFinite(value)) {
      pauseReplay();
      seekReplayToTime(value);
    }
  };

  const sliderMax = totalDuration > 0 ? totalDuration : 1;

  if (replay.mode === "live") {
    return (
      <div className="replay-controls">
        <div className="replay-controls-row">
          <div className="replay-status">Live stream</div>
          <button className="replay-button" type="button" onClick={handleEnterReplay} disabled={!canEnterReplay}>
            Enter replay
          </button>
        </div>
      </div>
    );
  }

  const isPlaying = replay.status === "playing";
  const hasPending = replay.pendingLive > 0;

  return (
    <div className="replay-controls replay-active">
      <div className="replay-controls-row">
        <div className="replay-status">
          Replay mode
          {hasPending ? <span className="replay-pending">{replay.pendingLive} new</span> : null}
        </div>
        <button className="replay-button" type="button" onClick={handleExitReplay}>
          Back to live
        </button>
      </div>
      <div className="replay-controls-row replay-controls-main">
        <div className="replay-buttons">
          <button className="replay-button" type="button" onClick={handleTogglePlay} disabled={replay.buffer.length === 0}>
            {isPlaying ? "Pause" : "Play"}
          </button>
          <button className="replay-button" type="button" onClick={handleStepBack} disabled={replay.buffer.length === 0}>
            ◀︎
          </button>
          <button className="replay-button" type="button" onClick={handleStepForward} disabled={replay.buffer.length === 0}>
            ▶︎
          </button>
          <button className="replay-button" type="button" onClick={handleRestart} disabled={replay.buffer.length === 0}>
            Restart
          </button>
        </div>
        <div className="replay-slider">
         <input
            type="range"
            min={0}
            max={sliderMax}
            step={0.01}
            value={Math.min(replay.currentTime, sliderMax)}
            onChange={handleSliderChange}
            disabled={replay.buffer.length === 0}
          />
          <div className="replay-times">
            <span>{currentLabel}</span>
            <span>{durationLabel}</span>
          </div>
        </div>
        <div className="replay-speed">
          <label>
           Speed
            <select value={replay.speed} onChange={handleSpeedChange} disabled={replay.buffer.length === 0}>
              {SPEED_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {`${option}×`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
