import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.CODEX_VISUALIZER_PORT ?? 4100);
const backlogLimit = Number(process.env.CODEX_VISUALIZER_BACKLOG ?? 200);

const server = createServer();
const wss = new WebSocketServer({ server });

const producerSockets = new Set();
const viewerSockets = new Set();
const backlog = [];

function broadcast(message, except) {
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

function pushBacklog(message) {
  backlog.push(message);
  if (backlog.length > backlogLimit) {
    backlog.splice(0, backlog.length - backlogLimit);
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
    for (const message of backlog) {
      try {
        socket.send(message);
      } catch (err) {
        console.warn("failed to replay backlog to viewer", err);
        break;
      }
    }
  }

  socket.on("message", (data) => {
    const payload = typeof data === "string" ? data : data.toString();
    if (role === "producer") {
      pushBacklog(payload);
      broadcast(payload, null);
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
