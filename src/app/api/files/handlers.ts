import { NextResponse } from "next/server";
import type { AppUser } from "../../../server/postgresAuthStore";
import type { DocumentAuthorizationService } from "../../../server/documentAuthorization";
import type { ObjectStorage } from "../../../server/objectStorage";
import { createObjectKey } from "../../../server/objectStorage";
import type { PostgresAttachmentStore } from "../../../server/postgresAttachmentStore";
import { getSessionToken } from "../../../server/sessionCookie";

interface FileAuthStore {
  getUserBySessionToken: (token: string) => Promise<Pick<AppUser, "id"> | null>;
}

interface FileRouteDependencies {
  attachmentStore?: Pick<PostgresAttachmentStore, "createAttachment" | "findAttachment">;
  authStore?: FileAuthStore;
  documentAuthorization?: Pick<DocumentAuthorizationService, "requireWorkspaceDocumentAction">;
  idFactory?: () => string;
  objectStorage: ObjectStorage;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function createFileRouteHandlers({
  attachmentStore,
  authStore,
  documentAuthorization,
  idFactory,
  objectStorage,
}: FileRouteDependencies) {
  async function getScope(
    request: Request,
    workspaceId: string,
    documentId: string,
    action: "read" | "write",
  ) {
    if (!authStore) {
      return { workspaceId };
    }
    if (!documentAuthorization || !attachmentStore) {
      throw new Error("Document file services are not configured");
    }

    const user = await authStore.getUserBySessionToken(getSessionToken(request));
    if (!user) {
      return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
    }

    try {
      const access = await documentAuthorization.requireWorkspaceDocumentAction(
        user.id,
        workspaceId,
        documentId,
        action,
      );
      if (access.workspaceId !== workspaceId) {
        return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
      }
      return access;
    } catch {
      return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
    }
  }

  return {
    async POST(request: Request) {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return NextResponse.json({ error: "上传表单格式不正确" }, { status: 400 });
      }

      const file = formData.get("file");
      const kind = formData.get("kind");
      const documentId = formData.get("documentId");
      const workspaceId = formData.get("workspaceId");
      const requestedDocumentId = typeof documentId === "string" ? documentId : null;

      if (typeof workspaceId !== "string" || !WORKSPACE_ID_PATTERN.test(workspaceId)) {
        return NextResponse.json({ error: "工作区标识不正确" }, { status: 400 });
      }
      if (authStore && (!requestedDocumentId || !DOCUMENT_ID_PATTERN.test(requestedDocumentId))) {
        return NextResponse.json({ error: "文档标识不正确" }, { status: 400 });
      }
      if (!(file instanceof File) || (kind !== "image" && kind !== "file")) {
        return NextResponse.json({ error: "请选择要上传的文件" }, { status: 400 });
      }
      if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "文件大小必须在 20MB 以内" }, { status: 400 });
      }
      if (kind === "image" && !file.type.startsWith("image/")) {
        return NextResponse.json({ error: "图片块只能上传图片文件" }, { status: 400 });
      }

      const scope = await getScope(request, workspaceId, requestedDocumentId ?? "", "write");
      if (scope instanceof NextResponse) {
        return scope;
      }

      const key = createObjectKey(workspaceId, file.name, idFactory);
      const body = new Uint8Array(await file.arrayBuffer());
      const mimeType = file.type || "application/octet-stream";
      await objectStorage.putObject(key, body, mimeType);
      if (authStore && requestedDocumentId && attachmentStore) {
        await attachmentStore.createAttachment({ documentId: requestedDocumentId, key, workspaceId });
      }
      const url = `/api/files/${key.split("/").map(encodeURIComponent).join("/")}`;

      return NextResponse.json({
        attachment: {
          key,
          kind,
          mimeType,
          name: file.name,
          size: file.size,
          url,
        },
      }, { status: 201 });
    },

    async GET(request: Request, key: string) {
      const workspaceId = key.split("/", 1)[0];
      if (!WORKSPACE_ID_PATTERN.test(workspaceId) || !key.startsWith(`${workspaceId}/`)) {
        return NextResponse.json({ error: "文件标识不正确" }, { status: 400 });
      }

      if (authStore && !attachmentStore) {
        throw new Error("Document file services are not configured");
      }
      const attachment = authStore ? await attachmentStore!.findAttachment(key) : null;
      if (authStore && (!attachment || attachment.workspaceId !== workspaceId)) {
        return NextResponse.json({ error: "文档不存在或无权访问" }, { status: 404 });
      }
      const scope = await getScope(
        request,
        workspaceId,
        attachment?.documentId ?? "",
        "read",
      );
      if (scope instanceof NextResponse) {
        return scope;
      }

      try {
        const object = await objectStorage.getObject(key);
        const body = Uint8Array.from(object.body).buffer;
        return new Response(body, {
          headers: {
            "Cache-Control": "private, max-age=3600",
            "Content-Length": String(object.size),
            "Content-Type": object.contentType,
          },
        });
      } catch {
        return NextResponse.json({ error: "文件不存在" }, { status: 404 });
      }
    },
  };
}
