"use client";

import {
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Button } from "@/components/ui/button";
import { WorkspaceShell } from "../features/editor/components/WorkspaceShell";
import type { EditorSessionUser } from "../features/editor/session/sessionTypes";
import { AuthScreen } from "./AuthScreen";

type SessionState =
  | { status: "loading" }
  | { status: "local" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: EditorSessionUser }
  | { message: string; status: "error" };

export function EditorApp() {
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadSession() {
      try {
        const response = await fetch("/api/auth/session", {
          headers: { Accept: "application/json" },
          method: "GET",
        });

        if (cancelled) {
          return;
        }

        if (response.status === 401) {
          setSession({ status: "anonymous" });
          return;
        }
        if (!response.ok) {
          throw new Error("身份服务暂时不可用");
        }

        const payload = await response.json() as {
          mode?: "database" | "local";
          user?: EditorSessionUser | null;
        };
        if (payload.mode === "local") {
          setSession({ status: "local" });
        } else if (payload.user) {
          setSession({ status: "authenticated", user: payload.user });
        } else {
          setSession({ status: "anonymous" });
        }
      } catch (error) {
        if (!cancelled) {
          setSession({
            message: error instanceof Error ? error.message : "身份服务暂时不可用",
            status: "error",
          });
        }
      }
    }

    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSignOut = async () => {
    await fetch("/api/auth/session", {
      headers: { Accept: "application/json" },
      method: "DELETE",
    }).catch(() => undefined);
    setSession({ status: "anonymous" });
  };

  if (session.status === "loading") {
    return (
      <main className="grid min-h-dvh place-items-center bg-background" role="status" aria-label="正在加载工作区">
        <div className="grid justify-items-center gap-3 text-sm text-muted-foreground">
          <BrandMark className="size-10 shadow-sm" />
          <span className="inline-flex items-center gap-2">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
            正在加载工作区
          </span>
        </div>
      </main>
    );
  }

  if (session.status === "anonymous") {
    return <AuthScreen onAuthenticated={(user) => setSession({ status: "authenticated", user })} />;
  }

  if (session.status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center bg-[linear-gradient(to_right,color-mix(in_oklab,var(--border)_45%,transparent)_1px,transparent_1px),linear-gradient(to_bottom,color-mix(in_oklab,var(--border)_45%,transparent)_1px,transparent_1px)] bg-[size:32px_32px] px-5">
        <section className="grid w-full max-w-md gap-5 rounded-lg border bg-card p-7 shadow-xl shadow-foreground/5">
          <BrandMark className="size-10" />
          <div className="grid gap-2">
            <h1 className="text-2xl font-semibold text-foreground">连接失败</h1>
            <p className="text-sm leading-6 text-muted-foreground" role="alert">{session.message}</p>
          </div>
          <Button onClick={() => window.location.reload()} type="button">
            <RefreshCw aria-hidden="true" className="size-4" />
            重新连接
          </Button>
        </section>
      </main>
    );
  }

  if (session.status === "local") {
    return <WorkspaceShell mode="local" sessionUser={null} />;
  }

  return (
    <WorkspaceShell
      mode="database"
      onSignOut={handleSignOut}
      sessionUser={session.user}
    />
  );
}
