import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.CODEX_VISUALIZER_PORT ?? 4100);
const backlogLimit = Number(process.env.CODEX_VISUALIZER_BACKLOG ?? 50000);

const server = createServer();
const wss = new WebSocketServer({ server });

const producerSockets = new Set();
const viewerSockets = new Set();
const backlog = [];

function broadcastEvent(eventPayload, except) {
  const message = JSON.stringify({ type: "event", event: eventPayload });
  for (const socket of viewerSockets) {
    if (socket.readyState === socket.OPEN && socket !== except) {
      try {
        socket.send(message);
      } catch (err) {
        console.warn("failed to deliver message to viewer", err);
      }
    }
  }
}

function pushBacklog(eventPayload) {
  backlog.push(eventPayload);
  if (backlog.length > backlogLimit) {
    backlog.splice(0, backlog.length - backlogLimit);
  }
}

function safeParseEvent(payload) {
  try {
    return JSON.parse(payload);
  } catch (err) {
    console.warn("failed to parse producer payload", err);
    return null;
  }
}

wss.on("connection", (socket, request) => {
  const url = new URL(request?.url ?? "/", "http://localhost");
  const role = url.searchParams.get("role") ?? "viewer";
  const clientDescription = `${request.socket.remoteAddress ?? "unknown"}:${request.socket.remotePort ?? "?"}`;

  if (role === "producer") {
    producerSockets.add(socket);
    console.log(`visualizer producer connected (${clientDescription})`);
  } else {
    viewerSockets.add(socket);
    console.log(`visualizer viewer connected (${clientDescription})`);
    try {
      socket.send(JSON.stringify({ type: "backlog", events: backlog }));
    } catch (err) {
      console.warn("failed to send backlog to viewer", err);
    }
  }

  socket.on("message", (data) => {
    const payload = typeof data === "string" ? data : data.toString();
    if (role === "producer") {
      const parsed = safeParseEvent(payload);
      if (!parsed) {
        return;
      }
      pushBacklog(parsed);
      broadcastEvent(parsed, null);
    }
  });

  socket.on("close", () => {
    producerSockets.delete(socket);
    viewerSockets.delete(socket);
    console.log(`visualizer client disconnected (${clientDescription})`);
  });

  socket.on("error", (err) => {
    console.warn(`visualizer websocket error (${clientDescription})`, err);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`codex visualizer websocket server listening on ws://localhost:${port}`);
});
