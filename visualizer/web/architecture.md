# Visualizer Web Architecture

This React application renders a live/replay view of events emitted by the Codex agent. It uses Vite for bundling, Valtio for state management, and p5.js for the animated header.

## Data Flow

1. **WebSocket Ingestion** (`visualizerClient.ts`)
   - Connects to the websocket server (`CODEX_VISUALIZER_WS`).
   - Handles `backlog` messages by replacing the event store, and `event` messages by appending a new item.
   - Maintains connection status and exposes a hook (`useVisualizerData`) that derives mode-aware display events.

2. **State Store** (`visualizerStore.ts`)
   - Valtio proxy holds live events, aggregated display events, and replay metadata (`ReplayState`).
   - Aggregation utilities (`eventAggregator.ts`) merge delta events into grouped `DisplayEvent`s, keeping both raw events and textual summaries.
   - `onDisplayEvent` allows consumers to subscribe to append-only updates while live.

3. **Replay Engine** (`replay/replayStore.ts`)
   - Builds a replay buffer from the live events, producing:
     - `ReplayEvent` array (sorted with relative timestamps).
     - `ReplayCircle` descriptors capturing charging start, launch time, colors, and stack order for each circle.
   - Exposes control actions (`begin`, `play`, `pause`, `seek`, `step`, `restart`, `exit`) that operate entirely on the store.
   - Tracks `lastTick` so that `advanceReplay()` can apply real-time deltas using `performance.now()`.
   - Adds a fixed travel buffer (`TRAVEL_DURATION`) to replay duration so the final launch completes before playback stops.

4. **Animation Layer**
   - `VisualizerSketch.tsx` mounts a p5 instance.
   - In live mode, new events flow directly into the `Launcher` state machine and animate frame-by-frame.
   - In replay mode, the sketch ignores the incremental path and instead calls `Launcher.fromReplay()` with the precomputed `ReplayCircle` descriptors and the current replay time. This yields `CircleSnapshot`s that are purely a function of time, enabling instant scrubbing.
   - `Launcher` retains forward-processing logic for live updates and provides shared constants (e.g. `TRAVEL_DURATION`).

5. **UI Components**
   - `App.tsx` renders the header, sketch, `ReplayControls`, and the timeline list using `react-virtuoso` for virtualized scrolling, auto-following new events while live and syncing replay scrubbing with the list position.
   - `ReplayControls.tsx` reflects replay state, exposes play/pause/seek/step actions, and renders a slider whose range equals `duration + TRAVEL_DURATION`.
   - Timeline items use colors from `theme.ts` and display aggregated JSON payloads.

## Key Interactions

- Entering replay freezes the live feed, builds the buffer, and switches the derived `displayEvents` array to the replay snapshot.
- Scrubbing or stepping updates `ReplayState.currentTime`, marks `pendingFrame`, and stashes a new `lastTick`. The sketch reads `replay.circles` + `currentTime` every frame; it no longer replays event messages.
- Returning to live resets the launcher, clears replay metadata, and resumes real-time event ingestion.

## Extensibility Notes

- Additional visualizations can subscribe to `watchDisplayEvents` for live-only hooks or read from `ReplayState` for time-based rendering.
- To incorporate new event types or colors, extend `theme.ts` or augment the circle descriptor builder (`buildReplayCircles`).
- The replay system assumes events share a monotonically increasing `sequence` and `timestampMs`. If the emitter changes, adjust `sortEvents` accordingly.

## Dependencies

- React + Vite for UI and bundling.
- Valtio for observable state.
- react-virtuoso for virtualized timeline rendering.
- p5.js for canvas-based animation.
- TypeScript for static typing.
