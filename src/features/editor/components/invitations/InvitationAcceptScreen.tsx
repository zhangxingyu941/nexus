"use client";

import { CheckCircle2, LoaderCircle, Mail, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthScreen } from "@/app/AuthScreen";
import { BrandMark } from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ReceivedWorkspaceInvite } from "@/shared/workspaceInvites";

type ScreenState = "resolving" | "anonymous" | "ready" | "submitting" | "terminal" | "error";

export function InvitationAcceptScreen() {
  const router = useRouter();
  const [state, setState] = useState<ScreenState>("resolving");
  const [invite, setInvite] = useState<ReceivedWorkspaceInvite | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const parameters = new URLSearchParams(window.location.hash.slice(1));
    const token = parameters.get("token") ?? "";
    if (window.location.hash) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    void resolveInvite(token);
  }, []);

  async function resolveInvite(token: string) {
    try {
      const response = await fetch("/api/workspace-invites/resolve", {
        body: JSON.stringify(token ? { token } : {}),
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json() as { code?: string; error?: string; invite?: ReceivedWorkspaceInvite };
      if (!response.ok || !payload.invite) throw new Error(payload.error || "Unable to resolve invitation");
      setInvite(payload.invite);

      const session = await fetch("/api/auth/session", { headers: { Accept: "application/json" } });
      setState(session.ok ? "ready" : "anonymous");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to resolve invitation");
      setState("error");
    }
  }

  async function transition(action: "accept" | "decline") {
    setState("submitting");
    try {
      const response = await fetch(`/api/workspace-invites/${action}`, {
        headers: { Accept: "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const payload = await response.json() as { code?: string; error?: string };
        if (payload.code === "invite_expired") {
          setMessage("邀请已过期");
          setState("terminal");
          return;
        }
        throw new Error(payload.error || "Invitation request failed");
      }
      if (action === "accept") {
        router.push("/");
        return;
      }
      setMessage("已拒绝邀请");
      setState("terminal");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invitation request failed");
      setState("error");
    }
  }

  if (state === "anonymous") {
    return <AuthScreen oauthReturnTo="/invitations/accept" onAuthenticated={() => setState("ready")} />;
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-10">
      <section className="grid w-full max-w-lg gap-6 border-y bg-card py-8 sm:border sm:p-8">
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <strong className="text-sm">Nexus</strong>
        </div>
        {state === "resolving" ? <Status icon={LoaderCircle} title="正在解析邀请" spin /> : null}
        {state === "terminal" ? <Status icon={CheckCircle2} title={message} /> : null}
        {state === "error" ? <Status icon={XCircle} title={message || "邀请无法处理"} /> : null}
        {(state === "ready" || state === "submitting") && invite ? (
          <div className="grid gap-5">
            <div className="grid gap-2">
              <Badge className="w-fit" variant="outline"><Mail className="size-3.5" />工作区邀请</Badge>
              <h1 className="text-2xl font-semibold">{invite.workspaceName}</h1>
              <p className="text-sm leading-6 text-muted-foreground">
                {invite.invitedBy.displayName} 邀请你以 {invite.role} 身份加入。
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button disabled={state === "submitting"} onClick={() => void transition("decline")} variant="outline">拒绝邀请</Button>
              <Button disabled={state === "submitting"} onClick={() => void transition("accept")}>接受并进入</Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Status({ icon: Icon, spin = false, title }: { icon: typeof Mail; spin?: boolean; title: string }) {
  return (
    <div className="grid justify-items-center gap-3 py-10 text-center">
      <Icon className={spin ? "size-7 animate-spin text-primary" : "size-7 text-primary"} />
      <h1 className="text-xl font-semibold">{title}</h1>
    </div>
  );
}
