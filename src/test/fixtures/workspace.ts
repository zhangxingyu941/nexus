import type { EditorWorkspace } from "../../features/editor/model/block";
import { addBlockComment, createDocumentFromTemplate } from "../../features/editor/model/documentOperations";

function assignTask(
  document: ReturnType<typeof createDocumentFromTemplate>,
  content: string,
  assignee: string,
) {
  return {
    ...document,
    blocks: document.blocks.map((block) =>
      block.content === content ? { ...block, assignee } : block,
    ),
  };
}

export function createDemoWorkspaceFixture(now = Date.now()): EditorWorkspace {
  const prdWithAssignees = assignTask(
    assignTask(
      createDocumentFromTemplate("prd", now, `document-${now}-prd`),
      "确认核心场景",
      "林夏",
    ),
    "同步评审结论",
    "周宁",
  );
  const prd = addBlockComment(
    { ...prdWithAssignees, pinned: true },
    `block-${now}-1`,
    "林夏",
    "这里补一段目标用户和成功指标，评审会会先看这一块。",
    now + 1,
  );
  const plan = {
    ...assignTask(
      assignTask(
        createDocumentFromTemplate("plan", now - 1000, `document-${now}-plan`),
        "完成需求评审",
        "林夏",
      ),
      "确认上线窗口",
      "陈序",
    ),
    pinned: true,
  };
  const meeting = assignTask(
    createDocumentFromTemplate("meeting", now - 2000, `document-${now}-meeting`),
    "同步会议结论",
    "周宁",
  );
  const interview = assignTask(
    assignTask(
      createDocumentFromTemplate("interview", now - 3000, `document-${now}-interview`),
      "确认当前流程痛点",
      "林夏",
    ),
    "追问协作中的断点",
    "陈序",
  );

  return {
    documents: [prd, plan, meeting, interview],
    activeDocumentId: prd.id,
    updatedAt: now,
  };
}
