// @vitest-environment node
import type { AddressInfo } from "node:net";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { createCollaborationServer } from "./collaborationServer";
import type { WorkspaceAccessInvalidationSource } from "./workspaceAccessNotifications";

const servers: Array<ReturnType<typeof createCollaborationServer>> = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) {
    socket.terminate();
  }
  for (const collaborationServer of servers.splice(0)) {
    await collaborationServer.close();
  }
});

async function listen(collaborationServer: ReturnType<typeof createCollaborationServer>) {
  await collaborationServer.listen(0, "127.0.0.1");
  const address = collaborationServer.server.address() as AddressInfo;
  return `ws://127.0.0.1:${address.port}/workspace%3Aworkspace-1%3Adocument%3Adocument-1`;
}

function getRejectedStatus(url: string, origin: string) {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: origin } });
    sockets.push(socket);
    socket.once("unexpected-response", (_request, response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("open", () => reject(new Error("WebSocket unexpectedly opened")));
    socket.once("error", () => undefined);
  });
}

function createFakeInvalidationSource(): WorkspaceAccessInvalidationSource & { emit(event: { userId: string | null; workspaceId: string }): void } {
  const emitter = new EventEmitter();
  return {
    on: (event: "invalidation", listener: (event: { userId: string | null; workspaceId: string }) => void) => {
      emitter.on(event, listener);
    },
    removeAllListeners: () => {
      emitter.removeAllListeners();
    },
    emit: (event: { userId: string | null; workspaceId: string }) => {
      emitter.emit("invalidation", event);
    },
  };
}

async function waitForClose(socket: WebSocket): Promise<number> {
  return new Promise<number>((resolve) => {
    socket.once("close", (code) => resolve(code));
  });
}

describe("authenticated collaboration server", () => {
  it("rejects untrusted origins before authentication", async () => {
    const authStore = { getUserBySessionToken: vi.fn() };
    const collaborationServer = createCollaborationServer({
      allowedOrigins: ["http://localhost:3000"],
      authStore,
      setupConnection: vi.fn(),
      workspaceStore: { getDocumentAccess: vi.fn() },
    });
    servers.push(collaborationServer);
    const url = await listen(collaborationServer);

    await expect(getRejectedStatus(url, "https://attacker.example")).resolves.toBe(403);
    expect(authStore.getUserBySessionToken).not.toHaveBeenCalled();
  });

  it("upgrades authorized editors into a workspace-scoped Yjs room", async () => {
    const prepareRoom = vi.fn().mockResolvedValue(undefined);
    const setupConnection = vi.fn((
      socket: WebSocket,
      _request: unknown,
      _options: { docName: string },
    ) => socket.send("ready"));
    const getDocumentAccess = vi.fn().mockResolvedValue({ role: "editor", workspaceId: "workspace-1" });
    const collaborationServer = createCollaborationServer({
      allowedOrigins: ["http://localhost:3000"],
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "editor-1" }) },
      prepareRoom,
      setupConnection,
      workspaceStore: {
        getDocumentAccess,
      },
    });
    servers.push(collaborationServer);
    const url = await listen(collaborationServer);
    const socket = new WebSocket(url, {
      headers: {
        Cookie: "notion_editor_session=session-token",
        Origin: "http://localhost:3000",
      },
    });
    sockets.push(socket);

    await expect(new Promise<string>((resolve, reject) => {
      socket.once("message", (message) => resolve(message.toString()));
      socket.once("error", reject);
    })).resolves.toBe("ready");
    expect(setupConnection).toHaveBeenCalledTimes(1);
    expect(setupConnection.mock.calls[0][2]).toEqual({
      docName: "workspace:workspace-1:document:document-1",
    });
    expect(prepareRoom).toHaveBeenCalledWith("workspace:workspace-1:document:document-1");
    expect(getDocumentAccess).toHaveBeenCalledWith("editor-1", "workspace-1", "document-1");
    expect(prepareRoom.mock.invocationCallOrder[0]).toBeLessThan(setupConnection.mock.invocationCallOrder[0]);
  });

  it("rejects viewers before preparing a room", async () => {
    const prepareRoom = vi.fn();
    const setupConnection = vi.fn();
    const collaborationServer = createCollaborationServer({
      allowedOrigins: ["http://localhost:3000"],
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "viewer-1" }) },
      prepareRoom,
      setupConnection,
      workspaceStore: {
        getDocumentAccess: vi.fn().mockResolvedValue({ role: "viewer", workspaceId: "workspace-1" }),
      },
    });
    servers.push(collaborationServer);
    const url = await listen(collaborationServer);

    await expect(getRejectedStatus(url, "http://localhost:3000")).resolves.toBe(403);
    expect(prepareRoom).not.toHaveBeenCalled();
    expect(setupConnection).not.toHaveBeenCalled();
  });

  it("flushes pending rooms during graceful shutdown", async () => {
    const flushRooms = vi.fn().mockResolvedValue(undefined);
    const collaborationServer = createCollaborationServer({
      allowedOrigins: ["http://localhost:3000"],
      authStore: { getUserBySessionToken: vi.fn() },
      flushRooms,
      setupConnection: vi.fn(),
      workspaceStore: { getDocumentAccess: vi.fn() },
    });

    await collaborationServer.close();

    expect(flushRooms).toHaveBeenCalledOnce();
  });

  it("closes only the invalidated user sockets", async () => {
    const invalidations = createFakeInvalidationSource();
    const getDocumentAccess = vi.fn().mockResolvedValue({ role: "editor", workspaceId: "workspace-1" });
    const setupConnection = vi.fn((
      socket: WebSocket,
      _request: unknown,
      _options: { docName: string },
    ) => socket.send("ready"));
    const collaborationServer = createCollaborationServer({
      accessInvalidations: invalidations,
      allowedOrigins: ["http://localhost:3000"],
      authStore: { getUserBySessionToken: vi.fn().mockResolvedValue({ id: "user-1" }) },
      setupConnection,
      workspaceStore: { getDocumentAccess },
    });
    servers.push(collaborationServer);
    const url = await listen(collaborationServer);

    const first = new WebSocket(url, {
      headers: {
        Cookie: "notion_editor_session=session-token",
        Origin: "http://localhost:3000",
      },
    });
    sockets.push(first);
    await new Promise<string>((resolve, reject) => {
      first.once("message", (message) => resolve(message.toString()));
      first.once("error", reject);
    });

    // Override auth for second user
    getDocumentAccess.mockResolvedValue({ role: "editor", workspaceId: "workspace-1" });
    collaborationServer.connections.set(first, { userId: "user-1", workspaceId: "workspace-1" });

    // Create a second connection tracked as user-2
    const second = new WebSocket(url, {
      headers: {
        Cookie: "notion_editor_session=session-token-2",
        Origin: "http://localhost:3000",
      },
    });
    sockets.push(second);
    await new Promise<string>((resolve, reject) => {
      second.once("message", (message) => resolve(message.toString()));
      second.once("error", reject);
    });

    // Manually track second as user-2
    for (const [socket] of collaborationServer.connections) {
      if (socket !== first) {
        collaborationServer.connections.set(socket, { userId: "user-2", workspaceId: "workspace-1" });
      }
    }

    invalidations.emit({ userId: "user-1", workspaceId: "workspace-1" });

    await expect(waitForClose(first)).resolves.toBe(4403);
    expect(second.readyState).toBe(WebSocket.OPEN);
  });

  it("closes all workspace connections on workspace-level invalidation", async () => {
    const invalidations = createFakeInvalidationSource();
    const getDocumentAccess = vi.fn().mockResolvedValue({ role: "editor", workspaceId: "workspace-1" });
    const setupConnection = vi.fn((
      socket: WebSocket,
      _request: unknown,
      _options: { docName: string },
    ) => socket.send("ready"));

    const userByToken = new Map<string, string>([
      ["session-token", "user-1"],
      ["session-token-2", "user-2"],
    ]);
    const authStore = {
      getUserBySessionToken: vi.fn(async (token: string) => {
        const id = userByToken.get(token);
        return id ? { id } : null;
      }),
    };

    const collaborationServer = createCollaborationServer({
      accessInvalidations: invalidations,
      allowedOrigins: ["http://localhost:3000"],
      authStore,
      setupConnection,
      workspaceStore: { getDocumentAccess },
    });
    servers.push(collaborationServer);
    const url = await listen(collaborationServer);

    const first = new WebSocket(url, {
      headers: {
        Cookie: "notion_editor_session=session-token",
        Origin: "http://localhost:3000",
      },
    });
    sockets.push(first);
    await new Promise<string>((resolve, reject) => {
      first.once("message", (message) => resolve(message.toString()));
      first.once("error", reject);
    });

    const second = new WebSocket(url, {
      headers: {
        Cookie: "notion_editor_session=session-token-2",
        Origin: "http://localhost:3000",
      },
    });
    sockets.push(second);
    await new Promise<string>((resolve, reject) => {
      second.once("message", (message) => resolve(message.toString()));
      second.once("error", reject);
    });

    const firstClose = waitForClose(first);
    const secondClose = waitForClose(second);

    invalidations.emit({ userId: null, workspaceId: "workspace-1" });

    await expect(firstClose).resolves.toBe(4403);
    await expect(secondClose).resolves.toBe(4403);
  });
});
