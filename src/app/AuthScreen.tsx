"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Github,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EditorSessionUser } from "../features/editor/session/sessionTypes";
import { AuthRequestError, requestAuth, requestEncryptedAuth } from "./authClient";

type AuthMode = "forgot" | "login" | "register" | "register-code" | "reset-code";

export function AuthScreen({
  oauthReturnTo,
  onAuthenticated,
}: {
  oauthReturnTo?: string;
  onAuthenticated: (user: EditorSessionUser) => void;
}) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [githubEnabled, setGithubEnabled] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/oauth/config", { headers: { Accept: "application/json" } })
      .then(async (response) => response.ok ? response.json() as Promise<{ github: boolean }> : { github: false })
      .then((configuration) => {
        if (!cancelled) {
          setGithubEnabled(configuration.github === true);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (resendAvailableAt <= 0) {
      return;
    }

    const updateRemainingSeconds = () => {
      const remaining = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
      setResendSeconds(remaining);
      if (remaining === 0) {
        setResendAvailableAt(0);
      }
    };
    updateRemainingSeconds();
    const timer = window.setInterval(updateRemainingSeconds, 250);
    return () => window.clearInterval(timer);
  }, [resendAvailableAt]);

  const startResendCooldown = (seconds = 60) => {
    const normalizedSeconds = Number.isFinite(seconds)
      ? Math.max(0, Math.ceil(seconds))
      : 60;
    setResendSeconds(normalizedSeconds);
    setResendAvailableAt(normalizedSeconds > 0 ? Date.now() + normalizedSeconds * 1000 : 0);
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setNotice("");
    setCode("");
    setResendAvailableAt(0);
    setResendSeconds(0);
    if (nextMode === "forgot" || nextMode === "login") {
      setPassword("");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);

    try {
      if (mode === "login") {
        const payload = await requestEncryptedAuth({
          body: {},
          email,
          purpose: "login",
          secrets: { password },
        });
        if (!payload.user) {
          throw new Error("认证响应无效");
        }
        onAuthenticated(payload.user);
      } else if (mode === "register") {
        const payload = await requestEncryptedAuth({
          body: { displayName },
          email,
          purpose: "register",
          secrets: { password },
        });
        setMode("register-code");
        startResendCooldown(payload.retryAfterSeconds);
        setNotice(`验证码已发送至 ${email.trim().toLowerCase()}`);
      } else if (mode === "register-code") {
        const payload = await requestEncryptedAuth({
          body: {},
          email,
          purpose: "verify-email",
          secrets: { code },
        });
        if (!payload.user) {
          throw new Error("认证响应无效");
        }
        onAuthenticated(payload.user);
      } else if (mode === "forgot") {
        const payload = await requestAuth("/api/auth/password/forgot", { email });
        setMode("reset-code");
        startResendCooldown(payload.retryAfterSeconds);
        setNotice(`验证码已发送至 ${email.trim().toLowerCase()}`);
      } else {
        const payload = await requestEncryptedAuth({
          body: {},
          email,
          purpose: "reset-password",
          secrets: { code, password },
        });
        if (!payload.user) {
          throw new Error("认证响应无效");
        }
        onAuthenticated(payload.user);
      }
    } catch (submitError) {
      if (submitError instanceof AuthRequestError && submitError.retryAfterSeconds) {
        if (submitError.codeAvailable && mode === "register") {
          setMode("register-code");
        } else if (submitError.codeAvailable && mode === "forgot") {
          setMode("reset-code");
        }
        startResendCooldown(submitError.retryAfterSeconds);
      }
      setError(submitError instanceof Error ? submitError.message : "认证请求失败");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setIsSubmitting(true);
    try {
      if (mode === "register-code") {
        const payload = await requestEncryptedAuth({
          body: { displayName },
          email,
          purpose: "register",
          secrets: { password },
        });
        startResendCooldown(payload.retryAfterSeconds);
        setNotice(`新验证码已发送至 ${email.trim().toLowerCase()}`);
      } else if (mode === "reset-code") {
        const payload = await requestAuth("/api/auth/password/forgot", { email });
        startResendCooldown(payload.retryAfterSeconds);
        setNotice(`新验证码已发送至 ${email.trim().toLowerCase()}`);
      }
    } catch (resendError) {
      if (resendError instanceof AuthRequestError && resendError.retryAfterSeconds) {
        startResendCooldown(resendError.retryAfterSeconds);
      }
      setError(resendError instanceof Error ? resendError.message : "无法重新发送验证码");
    } finally {
      setIsSubmitting(false);
    }
  };

  const isCodeMode = mode === "register-code" || mode === "reset-code";
  const showEmailField = mode === "forgot" || mode === "login" || mode === "register";
  const showPasswordField = mode === "login" || mode === "register" || mode === "reset-code";

  return (
    <main className="relative grid min-h-dvh overflow-hidden bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(440px,0.9fr)]">
      <BrandPanel />
      <section className="grid min-h-dvh place-items-center px-5 py-10 sm:px-10">
        <form aria-label="Nexus 身份认证" className="grid w-full max-w-[420px] gap-6" onSubmit={handleSubmit}>
          <div className="flex items-center gap-3 lg:hidden">
            <BrandMark className="size-9" />
            <strong className="text-sm text-foreground">Nexus</strong>
          </div>

          <div className="grid gap-2">
            <p className="text-xs font-semibold text-primary">团队知识库</p>
            <h1 className="text-3xl font-semibold text-foreground sm:text-4xl">Nexus 工作区</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              {mode === "register-code"
                ? "输入邮件中的 6 位验证码完成注册。"
                : mode === "forgot" || mode === "reset-code"
                  ? "使用邮箱验证码恢复访问。"
                  : "登录后继续处理文档与任务。"}
            </p>
          </div>

          {mode === "login" || mode === "register" ? (
            <Tabs onValueChange={(value) => changeMode(value as AuthMode)} value={mode}>
              <TabsList className="grid w-full grid-cols-2 rounded-md" aria-label="认证方式">
                <TabsTrigger disabled={isSubmitting} value="login">登录</TabsTrigger>
                <TabsTrigger disabled={isSubmitting} value="register">注册</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : (
            <Button
              className="w-fit px-0"
              disabled={isSubmitting}
              onClick={() => changeMode(mode === "register-code" ? "register" : mode === "reset-code" ? "forgot" : "login")}
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              {mode === "register-code" ? "返回注册" : mode === "reset-code" ? "返回找回密码" : "返回登录"}
            </Button>
          )}

          <div className="grid gap-4">
            {mode === "register" ? (
              <AuthField label="姓名">
                <Input
                  aria-label="姓名"
                  autoComplete="name"
                  className="h-11 bg-card"
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="你的姓名"
                  required
                  value={displayName}
                />
              </AuthField>
            ) : null}
            {showEmailField ? (
              <AuthField label="邮箱">
                <Input
                  aria-label="邮箱"
                  autoComplete="email"
                  className="h-11 bg-card"
                  maxLength={254}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@company.com"
                  required
                  type="email"
                  value={email}
                />
              </AuthField>
            ) : (
              <div className="grid gap-1 rounded-md border bg-zinc-50 px-3 py-2 text-sm">
                <span className="text-xs text-muted-foreground">邮箱</span>
                <strong className="font-medium text-foreground">{email}</strong>
              </div>
            )}
            {isCodeMode ? (
              <AuthField label="邮箱验证码">
                <Input
                  aria-label="邮箱验证码"
                  autoComplete="one-time-code"
                  className="h-11 bg-card text-center font-mono text-lg tracking-[0.35em]"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  pattern="\d{6}"
                  placeholder="000000"
                  required
                  value={code}
                />
              </AuthField>
            ) : null}
            {showPasswordField ? (
              <AuthField label={mode === "reset-code" ? "新密码" : "密码"}>
                <div className="relative">
                  <Input
                    aria-label={mode === "reset-code" ? "新密码" : "密码"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    className="h-11 bg-card pr-11"
                    maxLength={128}
                    minLength={12}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPassword((visible) => !visible)}
                    type="button"
                  >
                    {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
                  </button>
                </div>
              </AuthField>
            ) : null}
          </div>

          {mode === "login" ? (
            <Button className="w-fit justify-self-end px-0 text-xs" disabled={isSubmitting} onClick={() => changeMode("forgot")} type="button" variant="ghost">
              忘记密码
            </Button>
          ) : null}

          {error ? <Message tone="error">{error}</Message> : null}
          {notice ? <Message tone="success">{notice}</Message> : null}

          <Button className="h-11 justify-between px-4" disabled={isSubmitting} type="submit">
            <span>{isSubmitting ? "正在处理" : getSubmitLabel(mode)}</span>
            {isSubmitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
          </Button>

          {isCodeMode ? (
            <Button className="h-9" disabled={isSubmitting || resendSeconds > 0} onClick={handleResend} type="button" variant="ghost">
              {resendSeconds > 0 ? `重新发送（${resendSeconds}s）` : "重新发送验证码"}
            </Button>
          ) : null}

          {githubEnabled && (mode === "login" || mode === "register") ? (
            <>
              <div className="flex items-center gap-3 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                或
              </div>
              <Button asChild className="h-11" variant="outline">
                <a href={oauthReturnTo
                  ? `/api/auth/oauth/github?returnTo=${encodeURIComponent(oauthReturnTo)}`
                  : "/api/auth/oauth/github"}>
                  <Github aria-hidden="true" className="size-4" />
                  使用 GitHub 登录
                </a>
              </Button>
            </>
          ) : null}
        </form>
      </section>
    </main>
  );
}

function AuthField({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Message({ children, tone }: { children: React.ReactNode; tone: "error" | "success" }) {
  return (
    <p
      className={tone === "error"
        ? "rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        : "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"}
      role={tone === "error" ? "alert" : "status"}
    >
      {children}
    </p>
  );
}

function getSubmitLabel(mode: AuthMode) {
  if (mode === "register") {
    return "创建账号";
  }
  if (mode === "register-code") {
    return "验证并进入工作区";
  }
  if (mode === "forgot") {
    return "发送验证码";
  }
  if (mode === "reset-code") {
    return "重置密码并进入工作区";
  }
  return "登录";
}

function BrandPanel() {
  return (
    <section className="relative hidden min-h-dvh overflow-hidden border-r bg-zinc-50 p-10 lg:flex lg:flex-col lg:justify-between xl:p-14">
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(to_right,rgba(24,24,27,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(24,24,27,0.045)_1px,transparent_1px)] bg-[size:34px_34px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
      <div className="relative flex items-center gap-3">
        <BrandMark className="size-10 shadow-sm" />
        <div>
          <strong className="block text-sm font-semibold text-foreground">Nexus</strong>
          <span className="block text-xs text-muted-foreground">团队内容工作台</span>
        </div>
      </div>
      <div className="relative max-w-xl pb-10">
        <Badge className="mb-6 bg-white/80" variant="outline">
          <ShieldCheck aria-hidden="true" className="size-3.5 text-primary" />
          团队知识空间
        </Badge>
        <p className="max-w-lg text-[clamp(2.4rem,4.6vw,4.9rem)] font-semibold leading-[1.02] text-foreground">
          协作有序，<span className="text-zinc-500">想法落地。</span>
        </p>
        <p className="mt-6 max-w-md text-base leading-7 text-muted-foreground">把文档、任务和协作放在同一条工作流里。</p>
        <div className="mt-10 grid max-w-md gap-2 sm:grid-cols-3">
          {[
            { icon: FileText, label: "结构化文档" },
            { icon: ListChecks, label: "任务追踪" },
            { icon: MessageSquareText, label: "上下文评论" },
          ].map(({ icon: Icon, label }) => (
            <span className="flex items-center gap-2 border-t border-foreground/10 py-3 text-xs font-medium text-foreground" key={label}>
              <Icon aria-hidden="true" className="size-4 text-primary" />
              {label}
            </span>
          ))}
        </div>
      </div>
      <p className="relative flex items-center gap-2 text-xs text-muted-foreground">
        <CheckCircle2 aria-hidden="true" className="size-4 text-primary" />
        内容自动保存，并在团队成员之间同步
      </p>
    </section>
  );
}
