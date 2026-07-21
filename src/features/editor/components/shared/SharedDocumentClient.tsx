"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  AttachmentBlockData,
  Block,
  BlockData,
} from "../../model/block";
import type {
  SharedBlock,
  SharedDocumentSnapshot,
} from "@/shared/documentShare";
import { BlockList } from "../BlockList";

interface SharedDocumentClientProps {
  token: string;
}

type SharedDocumentState =
  | { status: "loading" }
  | { message: string; status: "unavailable" }
  | { status: "failed" }
  | { snapshot: SharedDocumentSnapshot; status: "ready" };

const NOOP = () => undefined;

export function SharedDocumentClient({ token }: SharedDocumentClientProps) {
  const [state, setState] = useState<SharedDocumentState>({ status: "loading" });
  const loadSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setState({ status: "loading" });

    try {
      const response = await fetch(
        `/api/shared-documents/${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      if (sequence !== loadSequence.current) return;
      if (response.status === 404 || response.status === 410) {
        setState({
          message: response.status === 410 ? "分享链接已失效" : "分享链接不存在",
          status: "unavailable",
        });
        return;
      }
      if (!response.ok) {
        throw new Error("shared document request failed");
      }
      const snapshot = await response.json() as SharedDocumentSnapshot;
      if (sequence === loadSequence.current) {
        setState({ snapshot, status: "ready" });
      }
    } catch {
      if (sequence === loadSequence.current) {
        setState({ status: "failed" });
      }
    }
  }, [token]);

  useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  if (state.status === "loading") {
    return <SharedPageState message="正在加载分享文档" role="status" />;
  }
  if (state.status === "unavailable") {
    return <SharedPageState message={state.message} role="alert" />;
  }
  if (state.status === "failed") {
    return (
      <SharedPageState message="分享文档加载失败" role="alert">
        <Button onClick={() => void load()} type="button" variant="outline">
          <RefreshCw aria-hidden="true" className="size-4" />
          重新加载
        </Button>
      </SharedPageState>
    );
  }

  return <SharedDocumentView snapshot={state.snapshot} />;
}

function SharedDocumentView({
  snapshot,
}: {
  snapshot: SharedDocumentSnapshot;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(
    () => snapshot.document.blocks.map(toEditorBlock),
    [snapshot.document.blocks],
  );
  const expiresAt = new Date(snapshot.expiresAt);

  return (
    <TooltipProvider delayDuration={350}>
      <main
        aria-label="共享文档"
        className="grid min-h-dvh grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground"
      >
      <header className="flex min-h-14 items-center justify-between gap-4 border-b px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground text-sm font-semibold text-background"
          >
            N
          </span>
          <strong className="truncate text-sm font-semibold">Nexus</strong>
        </div>
        <time
          className="shrink-0 text-xs text-muted-foreground"
          dateTime={expiresAt.toISOString()}
        >
          有效至 {formatExpiration(expiresAt)}
        </time>
      </header>

      <div className="min-h-0 overflow-auto" ref={scrollRef}>
        <article aria-label="分享文档正文" className="document pb-20 pt-12 sm:pt-16">
          <h1 className="break-words text-4xl font-semibold leading-tight sm:text-5xl">
            {snapshot.document.title || "未命名文档"}
          </h1>
          <div className="mt-8">
            <BlockList
              blocks={blocks}
              collaborationDocument={null}
              documentId="shared-document"
              focusBlockId={null}
              isReadOnly
              onAddAfter={NOOP}
              onAddBlockComment={NOOP}
              onChangeBlockAssignee={NOOP}
              onChangeBlockData={NOOP}
              onChangeBlockDueDate={NOOP}
              onChangeBlockStatus={NOOP}
              onChangeContent={NOOP}
              onChangeType={NOOP}
              onDelete={NOOP}
              onFocusedBlock={NOOP}
              onIndent={NOOP}
              onMove={NOOP}
              onOutdent={NOOP}
              onReorder={NOOP}
              onResolveBlockComment={NOOP}
              onToggleTodo={NOOP}
              scrollElementRef={scrollRef}
              sessionUser={null}
              workspaceId="shared"
            />
          </div>
        </article>
      </div>
      </main>
    </TooltipProvider>
  );
}

function SharedPageState({
  children,
  message,
  role,
}: {
  children?: React.ReactNode;
  message: string;
  role: "alert" | "status";
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      <section className="grid justify-items-center gap-4 text-center">
        <span
          aria-hidden="true"
          className="grid size-10 place-items-center rounded-md bg-foreground font-semibold text-background"
        >
          N
        </span>
        <p className="text-sm text-muted-foreground" role={role}>{message}</p>
        {children}
      </section>
    </main>
  );
}

function toEditorBlock(block: SharedBlock): Block {
  return {
    assignee: "",
    checked: false,
    children: [...block.children],
    comments: [],
    content: block.content,
    createdAt: 0,
    data: toEditorBlockData(block.data),
    dueDate: "",
    headingLevel: block.headingLevel,
    id: block.id,
    parentId: block.parentId,
    status: "unset",
    type: block.type,
    updatedAt: 0,
  };
}

function toEditorBlockData(data: SharedBlock["data"]): BlockData | null {
  if (data?.kind === "image" || data?.kind === "file") {
    return { ...data, key: "" } as AttachmentBlockData;
  }
  return data as BlockData | null;
}

function formatExpiration(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(value);
}
