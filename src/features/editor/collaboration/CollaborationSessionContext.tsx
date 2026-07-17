import { createContext, useContext } from "react";
import type { WebsocketProvider } from "y-websocket";

export interface CollaborationSession {
  provider: WebsocketProvider | null;
}

const CollaborationSessionContext = createContext<CollaborationSession>({ provider: null });

export const CollaborationSessionProvider = CollaborationSessionContext.Provider;

export function useCollaborationSession(): CollaborationSession {
  return useContext(CollaborationSessionContext);
}
