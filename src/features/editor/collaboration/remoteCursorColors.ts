export const CURSOR_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#f59e0b",
  "#6366f1",
  "#14b8a6",
  "#a855f7",
] as const;

function djb2Hash(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return hash;
}

export function getCursorColor(userId: string): string {
  const hash = djb2Hash(userId);
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}

export function getCursorColorName(userId: string): string {
  const colorMap: Record<string, string> = {
    "#3b82f6": "blue",
    "#8b5cf6": "violet",
    "#06b6d4": "cyan",
    "#ec4899": "pink",
    "#f59e0b": "amber",
    "#6366f1": "indigo",
    "#14b8a6": "teal",
    "#a855f7": "purple",
  };
  return colorMap[getCursorColor(userId)];
}
