import { NextResponse } from "next/server";
import type { AppUser } from "../../../server/postgresAuthStore";
import type { ObjectStorage } from "../../../server/objectStorage";
import { createObjectKey } from "../../../server/objectStorage";
import type { WorkspaceAccess } from "../../../server/postgresWorkspaceStore";
import { getSessionToken } from "../../../server/sessionCookie";

interface FileAuthStore {
  getUserBySessionToken: (token: string) => Promise<Pick<AppUser, "id"> | null>;
}

interface FileWorkspaceStore {
  getWorkspaceAccess: (userId: string) => Promise<WorkspaceAccess | null>;
}

interface FileRouteDependencies {
  authStore?: FileAuthStore;
  idFactory?: () => string;
  objectStorage: ObjectStorage;
  workspaceStore?: FileWorkspaceStore;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function createFileRouteHandlers({
  authStore,
  idFactory,
  objectStorage,
  workspaceStore,
}: FileRouteDependencies) {
  async function getScope(request: Request, requireWrite: boolean) {
    if (!authStore || !workspaceStore) {
      return { role: "owner" as const, workspaceId: "local" };
    }

    const user = await authStore.getUserBySessionToken(getSessionToken(request));
    if (!user) {
      return NextResponse.json({ error: "请先进入工作区" }, { status: 401 });
    }

    const access = await workspaceStore.getWorkspaceAccess(user.id);
    if (!access || (requireWrite && access.role === "viewer")) {
      return NextResponse.json(
        { error: requireWrite ? "没有上传文件的权限" : "没有读取文件的权限" },
        { status: 403 },
      );
    }

    return access;
  }

  return {
    async POST(request: Request) {
      const scope = await getScope(request, true);
      if (scope instanceof NextResponse) {
        return scope;
      }

      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return NextResponse.json({ error: "上传表单格式不正确" }, { status: 400 });
      }

      const file = formData.get("file");
      const kind = formData.get("kind");

      if (!(file instanceof File) || (kind !== "image" && kind !== "file")) {
        return NextResponse.json({ error: "请选择要上传的文件" }, { status: 400 });
      }
      if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: "文件大小必须在 20MB 以内" }, { status: 400 });
      }
      if (kind === "image" && !file.type.startsWith("image/")) {
        return NextResponse.json({ error: "图片块只能上传图片文件" }, { status: 400 });
      }

      const key = createObjectKey(scope.workspaceId, file.name, idFactory);
      const body = new Uint8Array(await file.arrayBuffer());
      const mimeType = file.type || "application/octet-stream";
      await objectStorage.putObject(key, body, mimeType);
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
      const scope = await getScope(request, false);
      if (scope instanceof NextResponse) {
        return scope;
      }
      if (!key.startsWith(`${scope.workspaceId}/`)) {
        return NextResponse.json({ error: "没有读取文件的权限" }, { status: 403 });
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
