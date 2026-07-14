import { NextResponse } from "next/server";
import { AuthMailer, createAuthMailerFromEnvironment } from "../../../server/authMailer";

type AuthMailerResolution =
  | { mailer: AuthMailer; ok: true }
  | { ok: false; response: NextResponse };

export function resolveAuthMailer(
  factory: () => AuthMailer = createAuthMailerFromEnvironment,
): AuthMailerResolution {
  try {
    return { mailer: factory(), ok: true };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "邮件服务配置无效，请联系管理员检查 SMTP 配置" },
        { status: 503 },
      ),
    };
  }
}
