import { createContext, useContext } from "react";
import type { MentionItem } from "./commands/useMentionSearch";

export type MentionSearchFn = (query: string) => MentionItem[];

const MentionSearchContext = createContext<MentionSearchFn>(() => []);

export const MentionSearchProvider = MentionSearchContext.Provider;

export function useMentionSearchContext(): MentionSearchFn {
  return useContext(MentionSearchContext);
}
