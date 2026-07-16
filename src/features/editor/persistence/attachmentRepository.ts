import type { AttachmentBlockData } from "../model/block";

export async function uploadAttachment(
  workspaceId: string,
  file: File,
  kind: "image" | "file",
) {
  const formData = new FormData();
  formData.set("workspaceId", workspaceId);
  formData.set("file", file);
  formData.set("kind", kind);
  const response = await fetch("/api/files", {
    body: formData,
    headers: { Accept: "application/json" },
    method: "POST",
  });
  const payload = await response.json() as { attachment?: AttachmentBlockData; error?: string };

  if (!response.ok || !payload.attachment) {
    throw new Error(payload.error || "文件上传失败");
  }

  return payload.attachment;
}
