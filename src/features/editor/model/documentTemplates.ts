import type { BlockStatus, BlockType, EditorDocument } from "./block";
import { createBlock } from "./documentBlockOperations";

export const DEFAULT_DOCUMENT_ID = "local-document";

export type DocumentTemplateId = "blank" | "meeting" | "plan" | "prd" | "interview" | "weekly";

interface TemplateBlock {
  type: BlockType;
  content: string;
  checked?: boolean;
  assignee?: string;
  dueDate?: string;
  status?: BlockStatus;
}

export const DOCUMENT_TEMPLATES: Array<{
  id: DocumentTemplateId;
  title: string;
  description: string;
  blocks: TemplateBlock[];
}> = [
  {
    id: "blank",
    title: "未命名文档",
    description: "从空白页面开始，自由组织内容和协作状态。",
    blocks: [{ type: "paragraph", content: "" }],
  },
  {
    id: "meeting",
    title: "会议纪要",
    description: "记录议题、结论和行动项，适合周会或评审会。",
    blocks: [
      { type: "heading", content: "会议目标" },
      { type: "paragraph", content: "说明本次会议要解决的问题。" },
      { type: "heading", content: "讨论记录" },
      { type: "paragraph", content: "按议题记录关键观点和分歧。" },
      { type: "heading", content: "行动项" },
      { type: "todo", content: "同步会议结论", dueDate: "今天", status: "todo" },
    ],
  },
  {
    id: "plan",
    title: "项目计划",
    description: "拆解里程碑、负责人和风险，适合项目启动。",
    blocks: [
      { type: "heading", content: "目标" },
      { type: "paragraph", content: "描述项目要达成的业务结果。" },
      { type: "heading", content: "里程碑" },
      { type: "todo", content: "完成需求评审", dueDate: "今天", status: "in-progress" },
      { type: "todo", content: "确认上线窗口", dueDate: "本周五", status: "todo" },
      { type: "heading", content: "风险" },
      { type: "quote", content: "把不确定项提前暴露出来，评审时逐条确认。" },
    ],
  },
  {
    id: "prd",
    title: "需求 PRD",
    description: "沉淀背景、范围和验收标准，适合产品需求评审。",
    blocks: [
      { type: "heading", content: "背景与目标" },
      { type: "paragraph", content: "说明业务背景、目标用户和本次迭代希望达成的结果。" },
      { type: "heading", content: "范围" },
      { type: "todo", content: "确认核心场景", dueDate: "今天", status: "in-progress" },
      { type: "todo", content: "同步评审结论", dueDate: "明天", status: "review" },
      { type: "heading", content: "验收标准" },
      { type: "paragraph", content: "列出上线前必须满足的检查项。" },
    ],
  },
  {
    id: "interview",
    title: "客户访谈",
    description: "整理访谈对象、问题清单和洞察结论。",
    blocks: [
      { type: "heading", content: "访谈对象" },
      { type: "paragraph", content: "记录客户背景、角色和使用场景。" },
      { type: "heading", content: "问题清单" },
      { type: "todo", content: "确认当前流程痛点", dueDate: "今天", status: "todo" },
      { type: "todo", content: "追问协作中的断点", dueDate: "明天", status: "todo" },
      { type: "heading", content: "关键洞察" },
      { type: "paragraph", content: "访谈结束后整理可行动的产品机会。" },
    ],
  },
  {
    id: "weekly",
    title: "周报",
    description: "同步本周进展、下周计划和需要协助的事项。",
    blocks: [
      { type: "heading", content: "本周进展" },
      { type: "paragraph", content: "记录已完成的重要事项。" },
      { type: "heading", content: "下周计划" },
      { type: "todo", content: "准备评审材料", dueDate: "下周一", status: "todo" },
      { type: "heading", content: "需要协助" },
      { type: "quote", content: "把阻塞点写清楚，方便团队快速响应。" },
    ],
  },
];

function getTemplate(templateId: DocumentTemplateId) {
  return DOCUMENT_TEMPLATES.find((template) => template.id === templateId) ?? DOCUMENT_TEMPLATES[0];
}

function createBlockFromTemplate(templateBlock: TemplateBlock, now: number, index: number) {
  return {
    ...createBlock(templateBlock.type, now, templateBlock.content, `block-${now}-${index}`),
    checked: templateBlock.checked ?? false,
    assignee: templateBlock.assignee ?? "",
    dueDate: templateBlock.dueDate ?? "",
    status: templateBlock.status ?? "unset",
  };
}

export function createDefaultDocument(now = Date.now(), documentId = DEFAULT_DOCUMENT_ID): EditorDocument {
  return {
    id: documentId,
    title: "未命名文档",
    blocks: [createBlock("paragraph", now)],
    updatedAt: now,
  };
}

export function createDocumentFromTemplate(
  templateId: DocumentTemplateId,
  now = Date.now(),
  documentId = DEFAULT_DOCUMENT_ID,
): EditorDocument {
  const template = getTemplate(templateId);

  return {
    id: documentId,
    title: template.title,
    templateId: template.id,
    blocks: template.blocks.map((block, index) => createBlockFromTemplate(block, now, index)),
    updatedAt: now,
  };
}
