import type { Block, EditorDocument, EditorWorkspace } from "./block";
import type {
  WorkspaceActivity,
  WorkspaceCollaborator,
  WorkspaceSearchResult,
  WorkspaceSearchResultKind,
  WorkspaceTask,
  WorkspaceTaskGroup,
} from "./workspaceTypes";

export function getSortedWorkspaceDocuments(documents: EditorDocument[]): EditorDocument[] {
  return [...documents].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }

    return right.updatedAt - left.updatedAt;
  });
}

export function getWorkspaceTasks(workspace: EditorWorkspace): WorkspaceTask[] {
  return workspace.documents
    .flatMap((document) =>
      document.blocks
        .filter((block) => block.assignee || block.dueDate || block.status !== "unset")
        .map((block) => ({
          id: `${document.id}-${block.id}`,
          blockId: block.id,
          documentId: document.id,
          documentTitle: document.title.trim() || "未命名文档",
          content: block.content.trim() || "空白任务",
          assignee: block.assignee || "未分配",
          dueDate: block.dueDate || "未设截止",
          status: block.status,
          updatedAt: block.updatedAt,
        })),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

function getSearchResultKind(block: Block): WorkspaceSearchResultKind {
  if (block.type === "heading") {
    return "heading";
  }

  if (block.type === "todo" || block.assignee || block.dueDate || block.status !== "unset") {
    return "task";
  }

  return "block";
}

function getSearchResultKindLabel(kind: WorkspaceSearchResultKind) {
  const labels = {
    block: "正文",
    comment: "评论",
    document: "文档",
    heading: "标题",
    task: "任务",
  } as const;

  return labels[kind];
}

export function getWorkspaceSearchResults(
  workspace: EditorWorkspace,
  query: string,
): WorkspaceSearchResult[] {
  const normalizedQuery = query.trim().toLowerCase();
  const sortedDocuments = getSortedWorkspaceDocuments(workspace.documents);

  if (!normalizedQuery) {
    return sortedDocuments.slice(0, 8).map((document) => {
      const documentTitle = document.title.trim() || "未命名文档";

      return {
        id: `${document.id}-document`,
        kind: "document",
        documentId: document.id,
        documentTitle,
        title: documentTitle,
        subtitle: `${document.blocks.length} 个内容块`,
        updatedAt: document.updatedAt,
      };
    });
  }

  const results = sortedDocuments.flatMap((document) => {
    const documentTitle = document.title.trim() || "未命名文档";
    const documentResults: WorkspaceSearchResult[] = documentTitle.toLowerCase().includes(normalizedQuery)
      ? [
          {
            id: `${document.id}-document`,
            kind: "document",
            documentId: document.id,
            documentTitle,
            title: documentTitle,
            subtitle: `${document.blocks.length} 个内容块`,
            updatedAt: document.updatedAt,
          },
        ]
      : [];

    const blockResults = document.blocks.flatMap((block) => {
      const blockTitle = block.content.trim();
      const kind = getSearchResultKind(block);
      const resultsForBlock: WorkspaceSearchResult[] =
        blockTitle && blockTitle.toLowerCase().includes(normalizedQuery)
          ? [
              {
                id: `${document.id}-${block.id}`,
                kind,
                blockId: block.id,
                documentId: document.id,
                documentTitle,
                title: blockTitle,
                subtitle: `${getSearchResultKindLabel(kind)} · ${documentTitle}`,
                updatedAt: block.updatedAt,
              },
            ]
          : [];

      const commentResults = block.comments
        .filter((comment) => comment.body.toLowerCase().includes(normalizedQuery))
        .map((comment) => ({
          id: `${document.id}-${block.id}-${comment.id}`,
          kind: "comment" as const,
          blockId: block.id,
          documentId: document.id,
          documentTitle,
          title: comment.body,
          subtitle: `评论 · ${comment.author} · ${blockTitle || "空白块"}`,
          updatedAt: comment.createdAt,
        }));

      return [...resultsForBlock, ...commentResults];
    });

    return [...documentResults, ...blockResults];
  });

  return results
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      return left.title.localeCompare(right.title, "zh-Hans-CN");
    })
    .slice(0, 12);
}

function getTaskDueDateGroupId(dueDate: string): WorkspaceTaskGroup["id"] {
  if (dueDate === "今天") {
    return "today";
  }

  if (dueDate === "明天") {
    return "tomorrow";
  }

  if (dueDate.includes("本周") || dueDate.includes("周")) {
    return "week";
  }

  return "unset";
}

export function groupWorkspaceTasksByDueDate(tasks: WorkspaceTask[]): WorkspaceTaskGroup[] {
  const groupMeta: Array<Pick<WorkspaceTaskGroup, "id" | "label">> = [
    { id: "today", label: "今天" },
    { id: "tomorrow", label: "明天" },
    { id: "week", label: "本周" },
    { id: "unset", label: "未设置" },
  ];

  return groupMeta
    .map((group) => ({
      ...group,
      tasks: tasks.filter((task) => getTaskDueDateGroupId(task.dueDate) === group.id),
    }))
    .filter((group) => group.tasks.length > 0);
}

function getCollaboratorColor(name: string): WorkspaceCollaborator["color"] {
  const colors: WorkspaceCollaborator["color"][] = ["green", "blue", "red", "amber"];
  const index = [...name].reduce((total, character) => total + (character.codePointAt(0) ?? 0), 0);
  return colors[index % colors.length];
}

export function getWorkspaceCollaborators(workspace: EditorWorkspace): WorkspaceCollaborator[] {
  const names = new Set<string>();

  workspace.documents.forEach((document) => {
    document.blocks.forEach((block) => {
      if (block.assignee) {
        names.add(block.assignee);
      }

      block.comments.forEach((comment) => {
        names.add(comment.author);
      });
    });
  });

  const sortedNames = [...names].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  return sortedNames.map((name) => {
    const activeDocument = workspace.documents.find((document) =>
      document.blocks.some(
        (block) => block.assignee === name || block.comments.some((comment) => comment.author === name),
      ),
    );
    const activeTaskCount = workspace.documents.reduce(
      (count, document) =>
        count +
        document.blocks.filter(
          (block) => block.assignee === name && (block.status === "in-progress" || block.status === "review"),
        ).length,
      0,
    );
    const openCommentCount = workspace.documents.reduce(
      (count, document) =>
        count +
        document.blocks.flatMap((block) => block.comments).filter(
          (comment) => comment.author === name && !comment.resolved,
        ).length,
      0,
    );

    return {
      name,
      role: "内容参与者",
      status: "unknown",
      activeDocumentTitle: activeDocument?.title.trim() || "未进入文档",
      activeTaskCount,
      openCommentCount,
      color: getCollaboratorColor(name),
    };
  });
}

function getDocumentPrimaryActor(document: EditorDocument) {
  const comments = document.blocks.flatMap((block) => block.comments);
  const commentAuthor = comments[comments.length - 1]?.author;

  return commentAuthor || "我";
}

function getBlockActor(block: Block) {
  const commentAuthor = block.comments[block.comments.length - 1]?.author;

  return block.assignee || commentAuthor || "我";
}

function getActivityTime(updatedAt: number, workspaceUpdatedAt: number) {
  if (workspaceUpdatedAt - updatedAt < 60_000) {
    return "刚刚";
  }

  return "最近";
}

export function getWorkspaceActivities(workspace: EditorWorkspace): WorkspaceActivity[] {
  type ActivityWithSort = WorkspaceActivity & {
    sortGroup: number;
    sortIndex: number;
  };

  const activities = workspace.documents.flatMap((document) => {
    const documentTitle = document.title.trim() || "未命名文档";
    const documentActivity: ActivityWithSort = {
      id: `${document.id}-document`,
      documentId: document.id,
      documentTitle,
      title: documentTitle,
      action: "更新了文档",
      actor: getDocumentPrimaryActor(document),
      time: getActivityTime(document.updatedAt, workspace.updatedAt),
      updatedAt: document.updatedAt,
      sortGroup: 1,
      sortIndex: -1,
    };

    const blockActivities = document.blocks
      .filter(
        (block) =>
          block.content.trim() &&
          (block.type === "todo" || block.assignee || block.dueDate || block.status !== "unset"),
      )
      .map((block, index) => ({
        id: `${document.id}-${block.id}`,
        blockId: block.id,
        documentId: document.id,
        documentTitle,
        title: block.content.trim(),
        action: block.type === "todo" || block.status !== "unset" ? "更新了任务" : "编辑了内容",
        actor: getBlockActor(block),
        time: getActivityTime(block.updatedAt, workspace.updatedAt),
        updatedAt: block.updatedAt,
        sortGroup: 0,
        sortIndex: index,
      }));

    return [documentActivity, ...blockActivities];
  });

  // 同一时间戳下先展示文档更新，再展示靠后的协作块，贴近活动流的阅读顺序。
  return activities
    .sort((left, right) => {
      if (right.updatedAt !== left.updatedAt) {
        return right.updatedAt - left.updatedAt;
      }

      if (right.sortGroup !== left.sortGroup) {
        return right.sortGroup - left.sortGroup;
      }

      return right.sortIndex - left.sortIndex;
    })
    .map(({ sortGroup, sortIndex, ...activity }) => activity)
    .slice(0, 12);
}
