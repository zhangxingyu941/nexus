import {
  Code2,
  Columns3,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  ImageIcon,
  Link2,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Sigma,
  Table2,
  Type,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BlockType, HeadingLevel } from "../model/block";

export type EditorCommandCategory = "text" | "list" | "media" | "data";

export interface EditorCommandDefinition {
  aliases: string[];
  category: EditorCommandCategory;
  description: string;
  headingLevel?: HeadingLevel;
  icon: LucideIcon;
  id: string;
  label: string;
  markdown?: string;
  type: BlockType;
}

export const EDITOR_COMMANDS: EditorCommandDefinition[] = [
  {
    aliases: ["paragraph", "正文", "段落"],
    category: "text",
    description: "纯文本",
    icon: Type,
    id: "text",
    label: "Text",
    type: "paragraph",
  },
  {
    aliases: ["title", "一级标题"],
    category: "text",
    description: "一级标题",
    headingLevel: 1,
    icon: Heading1,
    id: "heading-1",
    label: "H1",
    markdown: "#",
    type: "heading",
  },
  {
    aliases: ["subtitle", "二级标题"],
    category: "text",
    description: "二级标题",
    headingLevel: 2,
    icon: Heading2,
    id: "heading-2",
    label: "H2",
    markdown: "##",
    type: "heading",
  },
  {
    aliases: ["三级标题"],
    category: "text",
    description: "三级标题",
    headingLevel: 3,
    icon: Heading3,
    id: "heading-3",
    label: "H3",
    markdown: "###",
    type: "heading",
  },
  {
    aliases: ["四级标题"],
    category: "text",
    description: "四级标题",
    headingLevel: 4,
    icon: Heading4,
    id: "heading-4",
    label: "H4",
    markdown: "####",
    type: "heading",
  },
  {
    aliases: ["五级标题"],
    category: "text",
    description: "五级标题",
    headingLevel: 5,
    icon: Heading5,
    id: "heading-5",
    label: "H5",
    markdown: "#####",
    type: "heading",
  },
  {
    aliases: ["六级标题"],
    category: "text",
    description: "六级标题",
    headingLevel: 6,
    icon: Heading6,
    id: "heading-6",
    label: "H6",
    markdown: "######",
    type: "heading",
  },
  {
    aliases: ["引用"],
    category: "text",
    description: "引用文本",
    icon: Quote,
    id: "quote",
    label: "Quote",
    markdown: ">",
    type: "quote",
  },
  {
    aliases: ["task", "待办"],
    category: "list",
    description: "待办任务",
    icon: ListTodo,
    id: "todo",
    label: "Todo",
    markdown: "[]",
    type: "todo",
  },
  {
    aliases: ["图片"],
    category: "media",
    description: "上传图片",
    icon: ImageIcon,
    id: "image",
    label: "Image",
    type: "image",
  },
  {
    aliases: ["文件"],
    category: "media",
    description: "附件文件",
    icon: FileText,
    id: "file",
    label: "File",
    type: "file",
  },
  {
    aliases: ["代码"],
    category: "data",
    description: "代码块",
    icon: Code2,
    id: "code",
    label: "Code",
    markdown: "```",
    type: "code",
  },
  {
    aliases: ["表格"],
    category: "data",
    description: "结构化表格",
    icon: Table2,
    id: "table",
    label: "Table",
    type: "table",
  },
  {
    aliases: ["kanban", "看板"],
    category: "data",
    description: "按状态分组的看板",
    icon: Columns3,
    id: "board",
    label: "Board",
    type: "kanban",
  },
  {
    aliases: ["divider", "分割线", "分隔"],
    category: "data",
    description: "水平分割线",
    icon: Minus,
    id: "divider",
    label: "Divider",
    markdown: "---",
    type: "divider",
  },
  {
    aliases: ["bulleted", "无序列表", "圆点列表"],
    category: "list",
    description: "无序列表",
    icon: List,
    id: "bulleted-list",
    label: "Bulleted List",
    markdown: "-",
    type: "bulletedList",
  },
  {
    aliases: ["numbered", "有序列表", "数字列表"],
    category: "list",
    description: "有序列表",
    icon: ListOrdered,
    id: "numbered-list",
    label: "Numbered List",
    markdown: "1.",
    type: "numberedList",
  },
  {
    aliases: ["toggle", "折叠", "折叠块"],
    category: "data",
    description: "可折叠内容块",
    icon: ListTodo,
    id: "toggle",
    label: "Toggle",
    type: "toggle",
  },
  {
    aliases: ["formula", "公式", "数学"],
    category: "data",
    description: "行内/块级公式",
    icon: Sigma,
    id: "formula",
    label: "Formula",
    type: "formula",
  },
  {
    aliases: ["link", "链接卡片", "卡片"],
    category: "media",
    description: "链接预览卡片",
    icon: Link2,
    id: "link-card",
    label: "Link Card",
    type: "linkCard",
  },
];

export function getEditorCommand(id: string) {
  return EDITOR_COMMANDS.find((command) => command.id === id) ?? null;
}

export function getEditorCommandsByCategory(category: EditorCommandCategory) {
  return EDITOR_COMMANDS.filter((command) => command.category === category);
}

export function getBlockCommandLabel(type: BlockType, headingLevel: HeadingLevel = 1) {
  return (
    EDITOR_COMMANDS.find((command) =>
      command.type === type && (type !== "heading" || command.headingLevel === headingLevel),
    )?.label ?? type
  );
}

export function searchEditorCommands(query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");

  if (!normalizedQuery) {
    return EDITOR_COMMANDS;
  }

  return EDITOR_COMMANDS.filter((command) =>
    [command.label, command.description, command.markdown ?? "", ...command.aliases]
      .join(" ")
      .toLocaleLowerCase("zh-CN")
      .includes(normalizedQuery),
  );
}
