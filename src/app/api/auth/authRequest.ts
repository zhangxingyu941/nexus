import { NextResponse } from "next/server";

const MAX_AUTH_BODY_BYTES = 8 * 1024;

export async function parseAuthJson(request: Request): Promise<Record<string, unknown> | NextResponse> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "仅支持 JSON 请求" }, { status: 415 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_AUTH_BODY_BYTES) {
    return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
  }

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_AUTH_BODY_BYTES) {
      return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    }
    const payload = JSON.parse(text) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("invalid payload");
    }
    return payload as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "请求 JSON 格式不正确" }, { status: 400 });
  }
}
