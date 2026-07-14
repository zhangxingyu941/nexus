import { Columns3, Code2, FileText, Heading1, ImageIcon, ListTodo, Quote, Table2, Type } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BlockStatus, BlockType } from "../../model/block";

export const SLASH_COMMANDS: Array<{
  icon: LucideIcon;
  label: string;
  type: BlockType;
}> = [
  { icon: Type, label: "段落", type: "paragraph" },
  { icon: Heading1, label: "标题", type: "heading" },
  { icon: ListTodo, label: "待办", type: "todo" },
  { icon: Quote, label: "引用", type: "quote" },
  { icon: Code2, label: "代码", type: "code" },
  { icon: ImageIcon, label: "图片", type: "image" },
  { icon: FileText, label: "文件", type: "file" },
  { icon: Table2, label: "表格", type: "table" },
  { icon: Columns3, label: "看板", type: "kanban" },
];

export const STATUS_OPTIONS: Array<{ label: string; value: BlockStatus }> = [
  { label: "未设置", value: "unset" },
  { label: "待处理", value: "todo" },
  { label: "进行中", value: "in-progress" },
  { label: "待评审", value: "review" },
  { label: "已完成", value: "done" },
];

export const DUE_DATE_OPTIONS = ["今天", "明天", "本周五", "下周一"];

export function getStatusLabel(status: BlockStatus) {
  return STATUS_OPTIONS.find((option) => option.value === status)?.label ?? "未设置";
}
