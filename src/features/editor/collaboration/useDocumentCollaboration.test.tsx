import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockContentRecord, DocumentStructureRecord } from "./collaborationTypes";
import { getDefaultCollaborationUrl, useDocumentCollaboration } from "./useDocumentCollaboration";
import { changeBlockType, insertBlockAfter, updateBlockContent, updateBlockRichText, updateDocumentTitle } from "../model/documentOperations";
import { createDefaultWorkspace, createWorkspaceDocument } from "../model/workspaceOperations";
import { createRichTextFromPlainText, type RichTextDocument } from "@/shared/richText";

const websocketMock = vi.hoisted(() => {
  type Handler = (event: unknown) => void;

  class FakeAwareness {
    clientID = 1;
    handlers = new Map<string, Set<Handler>>();
    localState: unknown = null;
    states = new Map<number, unknown>();

    getStates() {
      return this.states;
    }

    on(eventName: string, handler: Handler) {
      const eventHandlers = this.handlers.get(eventName) ?? new Set<Handler>();

      eventHandlers.add(handler);
      this.handlers.set(eventName, eventHandlers);
    }

    off(eventName: string, handler: Handler) {
      this.handlers.get(eventName)?.delete(handler);
    }

    setLocalState(state: unknown) {
      this.localState = state;

      if (state === null) {
        this.states.delete(this.clientID);
      } else {
        this.states.set(this.clientID, state);
      }

      this.emit("change", {});
    }

    setLocalStateField(field: string, value: unknown) {
      const current = this.localState && typeof this.localState === "object" ? this.localState : {};

      this.setLocalState({
        ...current,
        [field]: value,
      });
    }

    setRemoteState(clientId: number, state: unknown) {
      this.states.set(clientId, state);
      this.emit("change", {});
    }

    emit(eventName: string, event: unknown) {
      this.handlers.get(eventName)?.forEach((handler) => handler(event));
    }
  }

  class FakeWebsocketProvider {
    awareness = new FakeAwareness();
    handlers = new Map<string, Set<Handler>>();
    destroyed = false;
    doc: { getMap: (name: string) => unknown };
    roomName: string;
    serverUrl: string;
    synced = false;

    constructor(serverUrl: string, roomName: string, doc: { getMap: (name: string) => unknown }) {
      this.serverUrl = serverUrl;
      this.roomName = roomName;
      this.doc = doc;
      initialBlockContentRecords.forEach((record) => {
        (doc.getMap("block-content") as { set: (key: string, value: unknown) => void }).set(record.blockId, record);
      });
      instances.push(this);
    }

    on(eventName: string, handler: Handler) {
      const eventHandlers = this.handlers.get(eventName) ?? new Set<Handler>();

      eventHandlers.add(handler);
      this.handlers.set(eventName, eventHandlers);
    }

    off(eventName: string, handler: Handler) {
      this.handlers.get(eventName)?.delete(handler);
    }

    emit(eventName: string, event: unknown) {
      if (eventName === "sync" || eventName === "synced") {
        this.synced = event === true;
      }

      this.handlers.get(eventName)?.forEach((handler) => handler(event));
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const instances: FakeWebsocketProvider[] = [];
  const initialBlockContentRecords: Array<{
    blockId: string;
    checked: boolean;
    content: string;
    documentId: string;
    updatedAt: number;
  }> = [];

  return {
    FakeWebsocketProvider,
    initialBlockContentRecords,
    instances,
  };
});

vi.mock("y-websocket", () => ({
  WebsocketProvider: websocketMock.FakeWebsocketProvider,
}));

describe("useDocumentCollaboration", () => {
  beforeEach(() => {
    websocketMock.instances.length = 0;
    websocketMock.initialBlockContentRecords.length = 0;
  });

  it("uses the current page host for the default collaboration url", () => {
    expect(getDefaultCollaborationUrl({ hostname: "192.168.10.30", protocol: "http:" })).toBe(
      "ws://192.168.10.30:1234",
    );
    expect(getDefaultCollaborationUrl({ hostname: "docs.example.com", protocol: "https:" })).toBe(
      "wss://docs.example.com:1234",
    );
  });

  it("uses the latest document snapshot when remote records arrive", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const block = document.blocks[0];
    const { rerender, unmount } = renderHook(
      ({ currentDocument }) =>
        useDocumentCollaboration({
          document: currentDocument,
          onRemotePatches,
          workspaceId: "workspace-a",
        }),
      {
        initialProps: {
          currentDocument: document,
        },
      },
    );
    const provider = websocketMock.instances[0];
    const blockContentMap = provider.doc.getMap("block-content") as {
      set: (key: string, value: BlockContentRecord) => void;
    };
    const locallyEditedDocument = updateBlockContent(document, block.id, "local content", 2000);

    rerender({
      currentDocument: locallyEditedDocument,
    });
    onRemotePatches.mockClear();

    act(() => {
      blockContentMap.set(block.id, {
        blockId: block.id,
        checked: block.checked,
        content: "local content",
        documentId: document.id,
        updatedAt: 2000,
      });
    });

    expect(onRemotePatches).not.toHaveBeenCalled();
    unmount();
  });

  it("publishes a same-timestamp mark-only local update", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const block = document.blocks[0];
    const plain = updateBlockRichText(document, block.id, {
      content: "same",
      richText: createRichTextFromPlainText("same"),
    }, 2000);
    const bold: RichTextDocument = {
      content: [{
        content: [{ marks: [{ type: "bold" }], text: "same", type: "text" }],
        type: "paragraph",
      }],
      type: "doc",
    };
    const formatted = updateBlockRichText(plain, block.id, {
      content: "same",
      richText: bold,
    }, 2000);
    const { rerender, unmount } = renderHook(
      ({ currentDocument }) => useDocumentCollaboration({
        document: currentDocument,
        onRemotePatches,
        workspaceId: "workspace-a",
      }),
      { initialProps: { currentDocument: plain } },
    );
    const provider = websocketMock.instances[0];
    const blockContentMap = provider.doc.getMap("block-content") as {
      get: (key: string) => BlockContentRecord | undefined;
    };

    act(() => {
      provider.emit("sync", true);
    });
    rerender({ currentDocument: formatted });

    expect(blockContentMap.get(block.id)?.richText).toEqual(bold);
    unmount();
  });

  it("does not overwrite newer remote block records while publishing local records", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const block = document.blocks[0];
    websocketMock.initialBlockContentRecords.push({
      blockId: block.id,
      checked: block.checked,
      content: "Remote latest",
      documentId: document.id,
      updatedAt: 3000,
    });

    const { unmount } = renderHook(() =>
      useDocumentCollaboration({
        document,
        onRemotePatches,
        workspaceId: "workspace-a",
      }),
    );
    const provider = websocketMock.instances[0];
    const blockContentMap = provider.doc.getMap("block-content") as {
      get: (key: string) => BlockContentRecord | undefined;
    };

    expect(blockContentMap.get(block.id)).toMatchObject({
      content: "Remote latest",
      updatedAt: 3000,
    });
    unmount();
  });

  it("does not publish document structure records for content-only changes", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const block = document.blocks[0];
    const { rerender, unmount } = renderHook(
      ({ currentDocument }) =>
        useDocumentCollaboration({
          document: currentDocument,
          onRemotePatches,
          workspaceId: "workspace-a",
        }),
      {
        initialProps: {
          currentDocument: document,
        },
      },
    );
    const provider = websocketMock.instances[0];
    const documentStructureMap = provider.doc.getMap("document-structure") as {
      get: (key: string) => DocumentStructureRecord | undefined;
    };

    act(() => {
      provider.emit("sync", true);
    });

    expect(documentStructureMap.get(document.id)?.updatedAt).toBe(1000);

    rerender({
      currentDocument: updateBlockContent(document, block.id, "Local content only", 3000),
    });

    expect(documentStructureMap.get(document.id)?.updatedAt).toBe(1000);
    unmount();
  });

  it("publishes a heading-level-only structure change", () => {
    const onRemotePatches = vi.fn();
    const baseDocument = createDefaultWorkspace(1000).documents[0];
    const blockId = baseDocument.blocks[0].id;
    const headingDocument = changeBlockType(baseDocument, blockId, "heading", 1500, 1);
    const { rerender, unmount } = renderHook(
      ({ currentDocument }) =>
        useDocumentCollaboration({
          document: currentDocument,
          onRemotePatches,
          workspaceId: "workspace-a",
        }),
      { initialProps: { currentDocument: headingDocument } },
    );
    const provider = websocketMock.instances[0];
    const documentStructureMap = provider.doc.getMap("document-structure") as {
      get: (key: string) => DocumentStructureRecord | undefined;
    };

    act(() => {
      provider.emit("sync", true);
    });

    rerender({
      currentDocument: changeBlockType(headingDocument, blockId, "heading", 2000, 4),
    });

    expect(documentStructureMap.get(headingDocument.id)).toMatchObject({
      blocks: [expect.objectContaining({ headingLevel: 4 })],
      updatedAt: 2000,
    });
    unmount();
  });

  it("waits for initial sync before exposing the active Yjs document for editor-level collaboration", () => {
    const onRemotePatches = vi.fn();
    const firstDocument = createDefaultWorkspace(1000).documents[0];
    const secondDocument = {
      ...firstDocument,
      id: "document-2000",
    };
    const { result, rerender, unmount } = renderHook(
      ({ currentDocument }) =>
        useDocumentCollaboration({
          document: currentDocument,
          onRemotePatches,
          workspaceId: "workspace-a",
        }),
      {
        initialProps: {
          currentDocument: firstDocument,
        },
      },
    );
    const firstProvider = websocketMock.instances[0];

    expect(result.current.ydoc).toBeNull();
    expect(result.current.roomName).toBe("workspace:workspace-a:document:document-1000");

    act(() => {
      firstProvider.emit("sync", true);
    });

    const firstYDoc = result.current.ydoc;

    expect(firstYDoc).toBe(firstProvider.doc);

    rerender({
      currentDocument: secondDocument,
    });

    expect(firstProvider.destroyed).toBe(true);
    expect(result.current.ydoc).toBeNull();
    expect(result.current.ydoc).not.toBe(firstYDoc);
    expect(result.current.roomName).toBe("workspace:workspace-a:document:document-2000");

    act(() => {
      websocketMock.instances[1].emit("sync", true);
    });

    expect(result.current.ydoc).toBe(websocketMock.instances[1].doc);
    unmount();
  });

  it("does not publish local collaboration records until initial sync finishes", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const block = document.blocks[0];
    const { unmount } = renderHook(() =>
      useDocumentCollaboration({
        document,
        onRemotePatches,
        workspaceId: "workspace-a",
      }),
    );
    const provider = websocketMock.instances[0];
    const blockContentMap = provider.doc.getMap("block-content") as {
      get: (key: string) => BlockContentRecord | undefined;
    };
    const documentStructureMap = provider.doc.getMap("document-structure") as {
      get: (key: string) => DocumentStructureRecord | undefined;
    };

    expect(blockContentMap.get(block.id)).toBeUndefined();
    expect(documentStructureMap.get(document.id)).toBeUndefined();

    act(() => {
      provider.emit("sync", true);
    });

    expect(blockContentMap.get(block.id)).toMatchObject({
      content: block.content,
      documentId: document.id,
      updatedAt: block.updatedAt,
    });
    expect(documentStructureMap.get(document.id)).toMatchObject({
      documentId: document.id,
      title: document.title,
      updatedAt: document.updatedAt,
    });
    unmount();
  });

  it("publishes only the selected document snapshot after switching documents", () => {
    const onRemotePatches = vi.fn();
    const workspace = createWorkspaceDocument(createDefaultWorkspace(1000), 2000, "第二个文档");
    const firstDocument = updateBlockContent(
      workspace.documents[0],
      workspace.documents[0].blocks[0].id,
      "第一个文档内容",
      3000,
    );
    const secondDocument = workspace.documents[1];
    const { rerender, unmount } = renderHook(
      ({ currentDocument }) =>
        useDocumentCollaboration({
          document: currentDocument,
          onRemotePatches,
          workspaceId: "workspace-a",
        }),
      {
        initialProps: {
          currentDocument: firstDocument,
        },
      },
    );
    const firstProvider = websocketMock.instances[0];

    act(() => {
      firstProvider.emit("sync", true);
    });

    rerender({
      currentDocument: secondDocument,
    });

    const secondProvider = websocketMock.instances[1];
    const secondBlockContentMap = secondProvider.doc.getMap("block-content") as {
      values: () => IterableIterator<BlockContentRecord>;
    };

    act(() => {
      secondProvider.emit("sync", true);
    });

    expect([...secondBlockContentMap.values()]).toEqual([
      {
        blockId: secondDocument.blocks[0].id,
        checked: secondDocument.blocks[0].checked,
        content: secondDocument.blocks[0].content,
        documentId: secondDocument.id,
        richText: secondDocument.blocks[0].richText,
        updatedAt: secondDocument.blocks[0].updatedAt,
      },
    ]);
    expect([...secondBlockContentMap.values()]).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "第一个文档内容",
          documentId: firstDocument.id,
        }),
      ]),
    );
    unmount();
  });

  it("publishes local awareness and returns active document peers", () => {
    const onRemotePatches = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];
    const { result, unmount } = renderHook(() =>
      useDocumentCollaboration({
        document,
        localUser: {
          color: "amber",
          name: "Me",
        },
        onRemotePatches,
        workspaceId: "workspace-a",
      }),
    );
    const provider = websocketMock.instances[0];

    expect(provider.awareness.localState).toMatchObject({
      document: {
        id: document.id,
        title: document.title,
      },
      user: {
        color: "amber",
        name: "Me",
      },
    });

    act(() => {
      provider.awareness.setRemoteState(2, {
        document: {
          id: document.id,
          title: document.title,
        },
        user: {
          color: "blue",
          name: "Remote teammate",
        },
      });
      provider.awareness.setRemoteState(3, {
        document: {
          id: "document-other",
          title: "Other document",
        },
        user: {
          color: "green",
          name: "Other document teammate",
        },
      });
    });

    expect(result.current.presence).toEqual([
      {
        clientId: 1,
        color: "amber",
        documentId: document.id,
        documentTitle: document.title,
        isLocal: true,
        name: "Me",
      },
      {
        clientId: 2,
        color: "blue",
        documentId: document.id,
        documentTitle: document.title,
        isLocal: false,
        name: "Remote teammate",
      },
    ]);

    unmount();

    expect(provider.awareness.localState).toBeNull();
  });

  it("publishes local document structure and reports newer remote snapshots", () => {
    const onRemotePatches = vi.fn();
    const onRemoteDocumentStructurePatch = vi.fn();
    const document = createDefaultWorkspace(1000).documents[0];

    renderHook(() =>
      useDocumentCollaboration({
        document,
        onRemoteDocumentStructurePatch,
        onRemotePatches,
        workspaceId: "workspace-a",
      }),
    );

    const provider = websocketMock.instances[0];
    const documentStructureMap = provider.doc.getMap("document-structure") as {
      get: (key: string) => DocumentStructureRecord | undefined;
      set: (key: string, value: DocumentStructureRecord) => void;
    };

    act(() => {
      provider.emit("sync", true);
    });

    expect(documentStructureMap.get(document.id)).toMatchObject({
      blocks: [
        {
          id: document.blocks[0].id,
        },
      ],
      documentId: document.id,
      title: document.title,
      updatedAt: document.updatedAt,
    });

    const renamedDocument = updateDocumentTitle(document, "Remote title", 2000);
    const remoteDocument = insertBlockAfter(renamedDocument, document.blocks[0].id, 3000, "block-remote");

    act(() => {
      documentStructureMap.set(document.id, {
        blocks: remoteDocument.blocks,
        documentId: remoteDocument.id,
        title: remoteDocument.title,
        updatedAt: remoteDocument.updatedAt,
      });
    });

    expect(onRemoteDocumentStructurePatch).toHaveBeenCalledWith({
      blocks: remoteDocument.blocks,
      documentId: remoteDocument.id,
      pinned: undefined,
      templateId: undefined,
      title: "Remote title",
      updatedAt: 3000,
    });
  });
});
