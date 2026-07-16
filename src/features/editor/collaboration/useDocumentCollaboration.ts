import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import type { EditorDocument } from "../model/block";
import type { RemoteBlockContentPatch, RemoteDocumentStructurePatch } from "../model/workspaceOperations";
import type {
  BlockContentRecord,
  CollaborationConnectionState,
  CollaborationLocalUser,
  CollaborationPresence,
  CollaborationPresenceColor,
  DocumentStructureRecord,
} from "./collaborationTypes";
import {
  createBlockContentRecords,
  createDocumentStructureRecord,
  createRemoteDocumentStructurePatch,
  createRemotePatchesFromRecords,
  getCollaborationRoomName,
} from "./yjsWorkspaceMapping";

const DEFAULT_COLLABORATION_URL = "ws://localhost:1234";
const DEFAULT_COLLABORATION_PORT = "1234";
const BLOCK_CONTENT_MAP = "block-content";
const DOCUMENT_STRUCTURE_MAP = "document-structure";
const DEFAULT_LOCAL_USER: CollaborationLocalUser = {
  color: "amber",
  name: "我",
};
const PRESENCE_COLORS: CollaborationPresenceColor[] = ["amber", "blue", "green", "red"];

interface UseDocumentCollaborationInput {
  document: EditorDocument | null;
  enabled?: boolean;
  localUser?: CollaborationLocalUser;
  onRemoteDocumentStructurePatch?: (patch: RemoteDocumentStructurePatch) => void;
  onRemotePatches: (patches: RemoteBlockContentPatch[]) => void;
  serverUrl?: string;
  workspaceId: string;
}

interface CollaborationStatusEvent {
  status: "connected" | "connecting" | "disconnected";
}

interface AwarenessState {
  document?: {
    id?: unknown;
    title?: unknown;
  };
  user?: {
    color?: unknown;
    name?: unknown;
  };
}

interface AwarenessLike {
  clientID: number;
  getStates: () => Map<number, AwarenessState>;
  off: (eventName: "change", handler: () => void) => void;
  on: (eventName: "change", handler: () => void) => void;
  setLocalState: (state: AwarenessState | null) => void;
}

interface CollaborationLocation {
  hostname: string;
  protocol: string;
}

export function getDefaultCollaborationUrl(
  location: CollaborationLocation | null = typeof window === "undefined" ? null : window.location,
) {
  if (process.env.NEXT_PUBLIC_COLLABORATION_URL) {
    return process.env.NEXT_PUBLIC_COLLABORATION_URL;
  }

  if (!location?.hostname) {
    return DEFAULT_COLLABORATION_URL;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const port = process.env.NEXT_PUBLIC_COLLABORATION_PORT || DEFAULT_COLLABORATION_PORT;

  return `${protocol}//${location.hostname}:${port}`;
}

function toConnectionState(status: CollaborationStatusEvent["status"]): CollaborationConnectionState {
  if (status === "connected") {
    return "connected";
  }

  if (status === "connecting") {
    return "connecting";
  }

  return "offline";
}

function writeRecordsToMap(map: Y.Map<BlockContentRecord>, records: BlockContentRecord[]) {
  records.forEach((record) => {
    const current = map.get(record.blockId);

    if (
      current?.content === record.content &&
      current.documentId === record.documentId &&
      current.updatedAt === record.updatedAt
    ) {
      return;
    }

    if (current && current.updatedAt >= record.updatedAt) {
      return;
    }

    map.set(record.blockId, record);
  });
}

type DocumentStructureBlock = DocumentStructureRecord["blocks"][number];
type DocumentStructureComment = DocumentStructureBlock["comments"][number];

function areStringArraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function areCommentsEqual(left: DocumentStructureComment[], right: DocumentStructureComment[]) {
  return (
    left.length === right.length &&
    left.every((comment, index) => {
      const other = right[index];

      return (
        other &&
        comment.author === other.author &&
        comment.body === other.body &&
        comment.createdAt === other.createdAt &&
        comment.id === other.id &&
        comment.resolved === other.resolved
      );
    })
  );
}

function hasSameBlockStructure(left: DocumentStructureBlock, right: DocumentStructureBlock) {
  return (
    left.assignee === right.assignee &&
    left.createdAt === right.createdAt &&
    JSON.stringify(left.data) === JSON.stringify(right.data) &&
    left.dueDate === right.dueDate &&
    left.id === right.id &&
    left.parentId === right.parentId &&
    left.status === right.status &&
    left.type === right.type &&
    areStringArraysEqual(left.children, right.children) &&
    areCommentsEqual(left.comments, right.comments)
  );
}

function hasSameDocumentStructure(left: DocumentStructureRecord, right: DocumentStructureRecord) {
  return (
    left.pinned === right.pinned &&
    left.templateId === right.templateId &&
    left.title === right.title &&
    left.blocks.length === right.blocks.length &&
    left.blocks.every((block, index) => hasSameBlockStructure(block, right.blocks[index]))
  );
}

function writeDocumentStructureToMap(map: Y.Map<DocumentStructureRecord>, record: DocumentStructureRecord) {
  const current = map.get(record.documentId);

  if (current && hasSameDocumentStructure(current, record)) {
    return;
  }

  if (current && current.updatedAt >= record.updatedAt) {
    return;
  }

  map.set(record.documentId, record);
}

function writeLocalDocumentSnapshot(
  ydoc: Y.Doc,
  document: EditorDocument,
  isApplyingLocalRecords: { current: boolean },
) {
  const blockContentMap = ydoc.getMap<BlockContentRecord>(BLOCK_CONTENT_MAP);
  const documentStructureMap = ydoc.getMap<DocumentStructureRecord>(DOCUMENT_STRUCTURE_MAP);

  isApplyingLocalRecords.current = true;

  try {
    writeRecordsToMap(blockContentMap, createBlockContentRecords(document));
    writeDocumentStructureToMap(documentStructureMap, createDocumentStructureRecord(document));
  } finally {
    isApplyingLocalRecords.current = false;
  }
}

function isPresenceColor(color: unknown): color is CollaborationPresenceColor {
  return typeof color === "string" && PRESENCE_COLORS.includes(color as CollaborationPresenceColor);
}

function getPresenceFromAwareness(awareness: AwarenessLike, document: EditorDocument): CollaborationPresence[] {
  return [...awareness.getStates()]
    .flatMap(([clientId, state]) => {
      if (state.document?.id !== document.id || typeof state.user?.name !== "string") {
        return [];
      }

      return [
        {
          clientId,
          color: isPresenceColor(state.user.color) ? state.user.color : "green",
          documentId: document.id,
          documentTitle: typeof state.document.title === "string" ? state.document.title : document.title,
          isLocal: clientId === awareness.clientID,
          name: state.user.name,
        },
      ];
    })
    .sort((left, right) => {
      if (left.isLocal !== right.isLocal) {
        return left.isLocal ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "zh-Hans-CN");
    });
}

export function useDocumentCollaboration({
  document,
  enabled = true,
  localUser = DEFAULT_LOCAL_USER,
  onRemoteDocumentStructurePatch,
  onRemotePatches,
  serverUrl = getDefaultCollaborationUrl(),
  workspaceId,
}: UseDocumentCollaborationInput) {
  const localUserColor = localUser.color;
  const localUserName = localUser.name;
  const [connectionState, setConnectionState] = useState<CollaborationConnectionState>(
    enabled ? "connecting" : "disabled",
  );
  const [presence, setPresence] = useState<CollaborationPresence[]>([]);
  const [syncedYdoc, setSyncedYdoc] = useState<{ roomName: string; ydoc: Y.Doc } | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const syncedYdocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebsocketProvider | null>(null);
  const documentRef = useRef<EditorDocument | null>(document);
  const isApplyingLocalRecords = useRef(false);
  const roomName = useMemo(
    () => (document ? getCollaborationRoomName(workspaceId, document.id) : null),
    [document?.id, workspaceId],
  );

  documentRef.current = document;

  useEffect(() => {
    if (!enabled || !document || !roomName) {
      setConnectionState("disabled");
      setPresence([]);
      setSyncedYdoc(null);
      syncedYdocRef.current = null;
      return;
    }

    setConnectionState("connecting");
    setSyncedYdoc(null);
    syncedYdocRef.current = null;
    const ydoc = new Y.Doc();
    const provider = new WebsocketProvider(serverUrl, roomName, ydoc);
    const blockContentMap = ydoc.getMap<BlockContentRecord>(BLOCK_CONTENT_MAP);
    const documentStructureMap = ydoc.getMap<DocumentStructureRecord>(DOCUMENT_STRUCTURE_MAP);

    ydocRef.current = ydoc;
    providerRef.current = provider;

    const handleStatus = (event: CollaborationStatusEvent) => {
      setConnectionState(toConnectionState(event.status));
    };

    const handleConnectionError = () => setConnectionState("offline");
    const handleAwarenessChange = () => {
      setPresence(getPresenceFromAwareness(provider.awareness as AwarenessLike, document));
    };

    const handleMapChange = () => {
      if (isApplyingLocalRecords.current) {
        return;
      }

      const currentDocument = documentRef.current;

      if (!currentDocument) {
        return;
      }

      const patches = createRemotePatchesFromRecords(currentDocument, [...blockContentMap.values()]);

      if (patches.length > 0) {
        onRemotePatches(patches);
      }
    };
    const handleDocumentStructureChange = () => {
      if (isApplyingLocalRecords.current) {
        return;
      }

      const currentDocument = documentRef.current;

      if (!currentDocument) {
        return;
      }

      const patch = createRemoteDocumentStructurePatch(
        currentDocument,
        documentStructureMap.get(currentDocument.id),
      );

      if (patch) {
        onRemoteDocumentStructurePatch?.(patch);
      }
    };
    const handleInitialSync = (isSynced: boolean) => {
      if (!isSynced || ydocRef.current !== ydoc || syncedYdocRef.current === ydoc) {
        return;
      }

      const currentDocument = documentRef.current;

      if (!currentDocument || currentDocument.id !== document.id) {
        return;
      }

      syncedYdocRef.current = ydoc;
      writeLocalDocumentSnapshot(ydoc, currentDocument, isApplyingLocalRecords);
      setSyncedYdoc({ roomName, ydoc });
    };

    provider.on("status", handleStatus);
    provider.on("connection-error", handleConnectionError);
    provider.on("sync", handleInitialSync);
    provider.on("synced", handleInitialSync);
    provider.awareness.on("change", handleAwarenessChange);
    blockContentMap.observe(handleMapChange);
    documentStructureMap.observe(handleDocumentStructureChange);
    provider.awareness.setLocalState({
      document: {
        id: document.id,
        title: document.title,
      },
      user: {
        color: localUserColor,
        name: localUserName,
      },
    });
    handleAwarenessChange();

    if (provider.synced) {
      handleInitialSync(true);
    }

    return () => {
      blockContentMap.unobserve(handleMapChange);
      documentStructureMap.unobserve(handleDocumentStructureChange);
      provider.awareness.off("change", handleAwarenessChange);
      provider.awareness.setLocalState(null);
      provider.off("status", handleStatus);
      provider.off("connection-error", handleConnectionError);
      provider.off("sync", handleInitialSync);
      provider.off("synced", handleInitialSync);
      provider.destroy();
      ydoc.destroy();
      providerRef.current = null;
      ydocRef.current = null;
      syncedYdocRef.current = null;
      setPresence([]);
      setSyncedYdoc(null);
    };
  }, [
    document?.id,
    enabled,
    localUserColor,
    localUserName,
    onRemoteDocumentStructurePatch,
    onRemotePatches,
    roomName,
    serverUrl,
  ]);

  useEffect(() => {
    if (!enabled || !document || !providerRef.current) {
      return;
    }

    const awareness = providerRef.current.awareness as AwarenessLike;

    awareness.setLocalState({
      document: {
        id: document.id,
        title: document.title,
      },
      user: {
        color: localUserColor,
        name: localUserName,
      },
    });
    setPresence(getPresenceFromAwareness(awareness, document));
  }, [document?.id, document?.title, enabled, localUserColor, localUserName]);

  useEffect(() => {
    if (!enabled || !document || !ydocRef.current || syncedYdocRef.current !== ydocRef.current) {
      return;
    }

    writeLocalDocumentSnapshot(ydocRef.current, document, isApplyingLocalRecords);
  }, [document, enabled]);

  const activeYdoc = syncedYdoc?.roomName === roomName ? syncedYdoc.ydoc : null;

  return {
    connectionState,
    presence,
    roomName,
    ydoc: activeYdoc,
  };
}
