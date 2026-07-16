import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import {
  authorizeCollaborationRequest,
  isAllowedCollaborationOrigin,
  type CollaborationAuthorizationResult,
} from "./collaborationAuthorization";

interface CollaborationServerAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface CollaborationServerWorkspaceStore {
  getDocumentAccess(userId: string, workspaceId: string, documentId: string): Promise<{
    role: "owner" | "editor" | "viewer";
    workspaceId: string;
  } | null>;
}

type SetupConnection = (
  socket: WebSocket,
  request: IncomingMessage,
  options: { docName: string },
) => void;

interface CollaborationServerOptions {
  allowedOrigins: string[];
  authStore: CollaborationServerAuthStore;
  flushRooms?: () => Promise<void>;
  prepareRoom?: (roomName: string) => Promise<void>;
  setupConnection: SetupConnection;
  workspaceStore: CollaborationServerWorkspaceStore;
}

function toRequest(request: IncomingMessage) {
  const host = request.headers.host ?? "localhost";
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  return new Request(`http://${host}${request.url ?? "/"}`, { headers });
}

function rejectUpgrade(socket: Duplex, status: number, message: string) {
  const body = Buffer.from(message, "utf8");
  socket.write([
    `HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : status === 403 ? "Forbidden" : "Bad Request"}`,
    "Connection: close",
    "Content-Type: text/plain; charset=utf-8",
    `Content-Length: ${body.byteLength}`,
    "",
    message,
  ].join("\r\n"));
  socket.destroy();
}

export function createCollaborationServer({
  allowedOrigins,
  authStore,
  flushRooms,
  prepareRoom,
  setupConnection,
  workspaceStore,
}: CollaborationServerOptions) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ service: "collaboration", status: "ok" }));
  });

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (!isAllowedCollaborationOrigin(request.headers.origin, allowedOrigins)) {
        rejectUpgrade(socket, 403, "协作请求来源不受信任");
        return;
      }

      let authorization: CollaborationAuthorizationResult;
      try {
        authorization = await authorizeCollaborationRequest(toRequest(request), { authStore, workspaceStore });
      } catch {
        rejectUpgrade(socket, 403, "协作授权失败");
        return;
      }
      if (!authorization.ok) {
        rejectUpgrade(socket, authorization.status, authorization.message);
        return;
      }

      const docName = authorization.roomName;
      try {
        await prepareRoom?.(docName);
      } catch {
        rejectUpgrade(socket, 503, "协作房间暂时不可用");
        return;
      }

      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        setupConnection(webSocket, request, {
          docName,
        });
      });
    })();
  });

  return {
    server,
    async close() {
      for (const client of webSocketServer.clients) {
        client.terminate();
      }
      await flushRooms?.();
      webSocketServer.close();
      if (!server.listening) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
    async listen(port: number, host: string) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      return server.address() as AddressInfo;
    },
  };
}
