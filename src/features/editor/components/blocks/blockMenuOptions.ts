import { EDITOR_COMMANDS } from "../../commands/editorCommands";
import type { BlockStatus } from "../../model/block";

export const SLASH_COMMANDS = EDITOR_COMMANDS;

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
