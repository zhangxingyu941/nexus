"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { createLocalWorkspaceRepository } from "../persistence/localWorkspaceRepository";
import { createRemoteWorkspaceRepository } from "../persistence/remoteWorkspaceRepository";
import type { EditorSessionUser } from "../session/sessionTypes";
import { useWorkspaceSession } from "../session/useWorkspaceSession";
import { EditorPage } from "./EditorPage";
import { WorkspaceManagerDialog } from "./sidebar/WorkspaceManagerDialog";

interface WorkspaceShellProps {
  mode: "database" | "local";
  sessionUser: EditorSessionUser | null;
  onSignOut?: () => void;
}

export function WorkspaceShell({ mode, sessionUser, onSignOut }: WorkspaceShellProps) {
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const openedWorkspaceId = useRef("");
  const repository = useMemo(
    () => mode === "database" ? createRemoteWorkspaceRepository() : createLocalWorkspaceRepository(),
    [mode],
  );
  const session = useWorkspaceSession(repository);

  useEffect(() => {
    if (isManagerOpen && openedWorkspaceId.current
      && openedWorkspaceId.current !== session.snapshot?.summary.id) {
      openedWorkspaceId.current = session.snapshot?.summary.id ?? "";
      setIsManagerOpen(false);
    }
  }, [isManagerOpen, session.snapshot?.summary.id]);

  if (session.isLoading) {
    return <main aria-label="正在加载工作区" className="grid min-h-dvh place-items-center" role="status">正在加载工作区</main>;
  }
  if (!session.snapshot) {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <section className="grid gap-3 text-center">
          <p role="alert">{session.error || "工作区加载失败"}</p>
          <Button onClick={() => void session.reload()} type="button">重新加载</Button>
        </section>
      </main>
    );
  }

  const openManager = () => {
    openedWorkspaceId.current = session.snapshot!.summary.id;
    setIsManagerOpen(true);
  };

  return (
    <>
      <EditorPage
        key={session.snapshot.summary.id}
        membersEnabled={mode === "database"}
        onManageWorkspaces={openManager}
        onSignOut={onSignOut}
        onWorkspaceChange={session.updateContent}
        saveStatus={session.saveStatus}
        sessionUser={sessionUser}
        workspace={session.snapshot.content}
        workspaceId={session.snapshot.summary.id}
        workspaceSummary={session.snapshot.summary}
      />
      <WorkspaceManagerDialog
        catalog={session.catalog!}
        error={session.error}
        isTransitioning={session.isTransitioning}
        onClose={() => setIsManagerOpen(false)}
        onCreate={session.createWorkspace}
        onRename={session.renameWorkspace}
        onSwitch={session.switchWorkspace}
        open={isManagerOpen}
      />
    </>
  );
}
