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
import type { DocumentAccess } from "../shared/documentAccess";
import type { WorkspaceAccessInvalidationSource } from "./workspaceAccessNotifications";

interface CollaborationServerAuthStore {
  getUserBySessionToken(token: string): Promise<{ id: string } | null>;
}

interface CollaborationServerDocumentAuthorization {
  requireWorkspaceDocumentAction(
    userId: string,
    workspaceId: string,
    documentId: string,
    action: "write",
  ): Promise<DocumentAccess>;
}

type SetupConnection = (
  socket: WebSocket,
  request: IncomingMessage,
  options: { docName: string },
) => void;

interface CollaborationServerOptions {
  accessInvalidations?: WorkspaceAccessInvalidationSource;
  allowedOrigins: string[];
  authStore: CollaborationServerAuthStore;
  flushRooms?: () => Promise<void>;
  prepareRoom?: (roomName: string) => Promise<void>;
  setupConnection: SetupConnection;
  documentAuthorization: CollaborationServerDocumentAuthorization;
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
  accessInvalidations,
  allowedOrigins,
  authStore,
  flushRooms,
  prepareRoom,
  setupConnection,
  documentAuthorization,
}: CollaborationServerOptions) {
  const webSocketServer = new WebSocketServer({ noServer: true });
  const connections = new Map<WebSocket, { userId: string; workspaceId: string }>();
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ service: "collaboration", status: "ok" }));
  });

  function handleInvalidation(event: { userId: string | null; workspaceId: string }) {
    for (const [socket, info] of connections) {
      if (info.workspaceId !== event.workspaceId) continue;
      if (event.userId !== null && info.userId !== event.userId) continue;
      socket.close(4403, "Access revoked");
      connections.delete(socket);
    }
  }

  accessInvalidations?.on("invalidation", handleInvalidation);

  server.on("upgrade", (request, socket, head) => {
    void (async () => {
      if (!isAllowedCollaborationOrigin(request.headers.origin, allowedOrigins)) {
        rejectUpgrade(socket, 403, "协作请求来源不受信任");
        return;
      }

      let authorization: CollaborationAuthorizationResult;
      try {
        authorization = await authorizeCollaborationRequest(toRequest(request), {
          authStore,
          documentAuthorization,
        });
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
        connections.set(webSocket, {
          userId: authorization.userId,
          workspaceId: authorization.access.workspaceId,
        });
        webSocket.on("close", () => {
          connections.delete(webSocket);
        });
        setupConnection(webSocket, request, {
          docName,
        });
      });
    })();
  });

  return {
    connections,
    server,
    async close() {
      accessInvalidations?.removeAllListeners();
      for (const client of webSocketServer.clients) {
        client.terminate();
      }
      connections.clear();
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
