"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReceivedWorkspaceInvite } from "@/shared/workspaceInvites";
import { createLocalWorkspaceRepository } from "../persistence/localWorkspaceRepository";
import { createDocumentRepository } from "../persistence/documentRepository";
import { createRemoteWorkspaceRepository } from "../persistence/remoteWorkspaceRepository";
import { workspaceInviteRepository } from "../persistence/workspaceInviteRepository";
import type { EditorSessionUser } from "../session/sessionTypes";
import { useWorkspaceSession } from "../session/useWorkspaceSession";
import { EditorPage } from "./EditorPage";
import { WorkspaceInvitationCenter } from "./invitations/WorkspaceInvitationCenter";
import { WorkspaceManagerDialog } from "./sidebar/WorkspaceManagerDialog";

interface WorkspaceShellProps {
  mode: "database" | "local";
  sessionUser: EditorSessionUser | null;
  onSignOut?: () => void;
}

export function WorkspaceShell({ mode, sessionUser, onSignOut }: WorkspaceShellProps) {
  const [invites, setInvites] = useState<ReceivedWorkspaceInvite[]>([]);
  const [isInvitationsOpen, setIsInvitationsOpen] = useState(false);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const inviteLoadSequence = useRef(0);
  const openedWorkspaceId = useRef("");
  const repository = useMemo(
    () => mode === "database" ? createRemoteWorkspaceRepository() : createLocalWorkspaceRepository(),
    [mode],
  );
  const documentRepository = useMemo(
    () => mode === "database" ? createDocumentRepository() : undefined,
    [mode],
  );
  const session = useWorkspaceSession(repository, documentRepository);

  const refreshInvites = useCallback(async () => {
    const sequence = ++inviteLoadSequence.current;
    if (mode !== "database") {
      setInvites((current) => current.length > 0 ? [] : current);
      return;
    }

    try {
      const received = await workspaceInviteRepository.listReceived();
      if (inviteLoadSequence.current === sequence) {
        setInvites(received);
      }
    } catch {
      if (inviteLoadSequence.current === sequence) {
        setInvites([]);
      }
    }
  }, [mode]);

  useEffect(() => {
    void refreshInvites();
    return () => {
      inviteLoadSequence.current += 1;
    };
  }, [refreshInvites]);

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

  const acceptInvite = async (inviteId: string) => {
    let accepted = false;
    await session.runServerTransition(async () => {
      const transition = await workspaceInviteRepository.acceptReceived(inviteId);
      accepted = true;
      return transition;
    });
    await refreshInvites();
    if (accepted) {
      setIsInvitationsOpen(false);
    }
  };

  const declineInvite = async (inviteId: string) => {
    await workspaceInviteRepository.declineReceived(inviteId);
    await refreshInvites();
  };

  return (
    <>
      <EditorPage
        inviteCount={invites.length}
        key={session.snapshot.summary.id}
        membersEnabled={mode === "database"}
        onCreateDocument={mode === "database" ? session.createDocument : undefined}
        onDeleteDocument={mode === "database" ? session.deleteDocument : undefined}
        onDuplicateDocument={mode === "database" ? session.duplicateDocument : undefined}
        onManageWorkspaces={openManager}
        onOpenInvites={mode === "database" ? () => setIsInvitationsOpen(true) : undefined}
        onSignOut={onSignOut}
        onWorkspaceChange={session.updateContent}
        documentPublicId={session.snapshot.documentPublicIds?.[session.snapshot.content.activeDocumentId]}
        documentCanWrite={session.activeDocumentCanWrite}
        saveStatus={session.saveStatus}
        sessionUser={sessionUser}
        workspace={session.snapshot.content}
        workspaceId={session.snapshot.summary.id}
        workspaceSummary={session.snapshot.summary}
      />
      {mode === "database" ? (
        <WorkspaceInvitationCenter
          invites={invites}
          onAccept={acceptInvite}
          onDecline={declineInvite}
          onOpenChange={setIsInvitationsOpen}
          open={isInvitationsOpen}
        />
      ) : null}
      <WorkspaceManagerDialog
        catalog={session.catalog!}
        currentUserId={sessionUser?.id}
        error={session.error}
        isTransitioning={session.isTransitioning}
        lifecycleEnabled={mode === "database"}
        onClose={() => setIsManagerOpen(false)}
        onCreate={session.createWorkspace}
        onMemberChanged={() => void session.reload()}
        onRename={session.renameWorkspace}
        onSwitch={session.switchWorkspace}
        open={isManagerOpen}
        session={session}
      />
    </>
  );
}
