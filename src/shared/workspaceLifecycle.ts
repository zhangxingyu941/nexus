export interface WorkspaceDeletionSummary {
  id: string;
  name: string;
  documentCount: number;
  memberCount: number;
  fileCount: number;
}

export interface DeletedWorkspaceSummary {
  id: string;
  name: string;
  deletedAt: number;
  deletedBy: { id: string; displayName: string } | null;
  purgeAfter: number;
}
