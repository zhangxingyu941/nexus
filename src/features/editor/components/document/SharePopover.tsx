import {
  Check,
  Copy,
  Link2,
  Lock,
  RefreshCw,
  Unlink,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DocumentPolicy, DocumentPermissionRole } from "@/shared/documentAccess";
import {
  DEFAULT_DOCUMENT_SHARE_TTL_MS,
  DOCUMENT_SHARE_PRESETS,
  MAX_DOCUMENT_SHARE_TTL_MS,
  resolveDocumentShareExpiresAt,
  type DocumentShareSummary,
} from "@/shared/documentShare";
import type { DatabaseWorkspaceMember } from "../../session/sessionTypes";
import {
  createDocumentRepository,
  type DocumentPolicySnapshot,
} from "../../persistence/documentRepository";
import { createDocumentShareRepository } from "../../persistence/documentShareRepository";

const ACCESS_MODE_OPTIONS = [
  { icon: Lock, label: "仅自己与获授权成员可查看", value: "private" as const },
  { icon: Users, label: "团队可查看", value: "workspace" as const },
  { icon: Link2, label: "拥有链接的人可查看", value: "link" as const },
];
const DEFAULT_EXPIRATION_PRESET = String(DEFAULT_DOCUMENT_SHARE_TTL_MS);

interface SharePopoverProps {
  documentPublicId: string;
  onClose: () => void;
  workspaceMembers: DatabaseWorkspaceMember[];
}

export function SharePopover({
  documentPublicId,
  onClose,
  workspaceMembers,
}: SharePopoverProps) {
  const repository = useMemo(() => createDocumentRepository(), []);
  const shareRepository = useMemo(() => createDocumentShareRepository(), []);
  const [snapshot, setSnapshot] = useState<DocumentPolicySnapshot | null>(null);
  const [shareLink, setShareLink] = useState<DocumentShareSummary | null>(null);
  const [createdUrl, setCreatedUrl] = useState("");
  const [expirationPreset, setExpirationPreset] = useState(DEFAULT_EXPIRATION_PRESET);
  const [customExpiresAt, setCustomExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setShareLink(null);
    setCreatedUrl("");
    setError("");
    setStatus("");

    repository.loadPolicy(documentPublicId)
      .then(async (next) => {
        if (cancelled) return;
        setSnapshot(next);
        if (next.access.canManage) {
          const managedLink = await shareRepository.load(documentPublicId);
          if (!cancelled) setShareLink(managedLink);
        }
      })
      .catch(() => {
        if (!cancelled) setError("仅工作区所有者可以管理访问权限");
      });

    return () => {
      cancelled = true;
    };
  }, [documentPublicId, repository, shareRepository]);

  const savePolicy = async (policy: DocumentPolicy) => {
    if (!snapshot?.access.canManage || isSaving) return;

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const updated = await repository.updatePolicy(documentPublicId, policy);
      setSnapshot(updated);
      if (policy.accessMode !== "link") {
        setShareLink(null);
        setCreatedUrl("");
      }
      setStatus("访问权限已更新");
    } catch {
      setError("访问权限更新失败");
    } finally {
      setIsSaving(false);
    }
  };

  const createShareLink = async () => {
    if (isSaving) return;

    const now = Date.now();
    let expiresAt: number;
    try {
      expiresAt = expirationPreset === "custom"
        ? resolveDocumentShareExpiresAt(new Date(customExpiresAt).getTime(), now)
        : resolveDocumentShareExpiresAt(now + Number(expirationPreset), now);
    } catch (validationError) {
      setError(validationError instanceof Error
        ? validationError.message
        : "分享过期时间不正确");
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const created = await shareRepository.create(documentPublicId, expiresAt);
      const regenerated = Boolean(shareLink);
      setShareLink(created);
      setCreatedUrl(created.url);
      setStatus(regenerated ? "分享链接已重新生成" : "分享链接已创建");
    } catch {
      setError("分享链接创建失败");
    } finally {
      setIsSaving(false);
    }
  };

  const revokeShareLink = async () => {
    if (!shareLink || isSaving) return;

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      await shareRepository.revoke(documentPublicId);
      setShareLink(null);
      setCreatedUrl("");
      setStatus("分享链接已关闭");
    } catch {
      setError("分享链接关闭失败");
    } finally {
      setIsSaving(false);
    }
  };

  const copyShareLink = async () => {
    if (!createdUrl) return;
    try {
      await navigator.clipboard?.writeText(createdUrl);
      setStatus("分享链接已复制");
    } catch {
      setError("复制分享链接失败");
    }
  };

  const policy = snapshot?.policy;
  const canManage = snapshot?.access.canManage === true;
  const managementMessage = error || (snapshot && !canManage
    ? "仅工作区所有者可以管理访问权限"
    : "");
  const permissionsByUser = new Map(
    policy?.permissions.map((permission) => [permission.userId, permission]),
  );

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享文档</DialogTitle>
          <DialogDescription>设置谁可以访问当前文档。</DialogDescription>
        </DialogHeader>

        {!snapshot && !managementMessage ? (
          <p className="text-sm text-muted-foreground" role="status">正在读取访问权限</p>
        ) : null}
        {managementMessage ? (
          <p className="text-sm text-muted-foreground" role="status">{managementMessage}</p>
        ) : null}

        {policy && canManage ? (
          <>
            <div className="grid gap-2">
              {ACCESS_MODE_OPTIONS.map((option) => {
                const Icon = option.icon;

                return (
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted has-[:checked]:border-foreground/30 has-[:checked]:bg-muted" key={option.value}>
                    <input
                      aria-label={option.label}
                      checked={policy.accessMode === option.value}
                      className="size-4 accent-zinc-900"
                      disabled={isSaving}
                      name="share-permission"
                      onChange={() => void savePolicy({ ...policy, accessMode: option.value })}
                      type="radio"
                    />
                    <span aria-hidden="true" className="grid size-8 place-items-center rounded-md bg-background text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="flex-1">{option.label}</span>
                    {policy.accessMode === option.value ? (
                      <Check aria-hidden="true" className="size-4" />
                    ) : null}
                  </label>
                );
              })}
            </div>

            {policy.accessMode === "link" ? (
              <section aria-label="匿名分享链接" className="grid gap-3 border-t pt-3">
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor="document-share-expiration">
                    链接有效期
                  </label>
                  <select
                    aria-label="链接有效期"
                    className="h-9 rounded-md border bg-background px-3 text-sm"
                    disabled={isSaving}
                    id="document-share-expiration"
                    onChange={(event) => setExpirationPreset(event.target.value)}
                    value={expirationPreset}
                  >
                    {DOCUMENT_SHARE_PRESETS.map((preset) => (
                      <option key={preset.milliseconds} value={preset.milliseconds}>
                        {preset.label}
                      </option>
                    ))}
                    <option value="custom">自定义</option>
                  </select>
                  {expirationPreset === "custom" ? (
                    <input
                      aria-label="自定义过期时间"
                      className="h-9 rounded-md border bg-background px-3 text-sm"
                      disabled={isSaving}
                      max={toDateTimeLocalValue(new Date(Date.now() + MAX_DOCUMENT_SHARE_TTL_MS))}
                      min={toDateTimeLocalValue(new Date(Date.now() + 60_000))}
                      onChange={(event) => setCustomExpiresAt(event.target.value)}
                      type="datetime-local"
                      value={customExpiresAt}
                    />
                  ) : null}
                </div>

                {shareLink ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={shareLink.status === "active" ? "success" : "secondary"}>
                      {shareLink.status === "active" ? "链接有效" : "链接已过期"}
                    </Badge>
                    <time dateTime={new Date(shareLink.expiresAt).toISOString()}>
                      有效至 {formatExpiration(shareLink.expiresAt)}
                    </time>
                  </div>
                ) : null}

                {createdUrl ? (
                  <input
                    aria-label="分享链接"
                    className="h-9 min-w-0 rounded-md border bg-muted/40 px-3 text-xs"
                    readOnly
                    value={createdUrl}
                  />
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button
                    aria-label={shareLink ? "重新生成分享链接" : "创建分享链接"}
                    disabled={isSaving}
                    onClick={() => void createShareLink()}
                    size="sm"
                    type="button"
                  >
                    {shareLink ? <RefreshCw aria-hidden="true" className="size-4" /> : <Link2 aria-hidden="true" className="size-4" />}
                    {shareLink ? "重新生成" : "创建链接"}
                  </Button>
                  <Button
                    aria-label="复制分享链接"
                    disabled={!createdUrl || isSaving}
                    onClick={() => void copyShareLink()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Copy aria-hidden="true" className="size-4" />
                    复制
                  </Button>
                  {shareLink ? (
                    <Button
                      aria-label="关闭分享链接"
                      disabled={isSaving}
                      onClick={() => void revokeShareLink()}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Unlink aria-hidden="true" className="size-4" />
                      关闭
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}

            <section className="grid gap-2 border-t pt-3">
              <h3 className="text-sm font-medium">指定成员</h3>
              {workspaceMembers.filter((member) => member.role !== "owner").map((member) => {
                const permission = permissionsByUser.get(member.id);
                return (
                  <div className="flex min-h-9 items-center gap-2 text-sm" key={member.id}>
                    <input
                      aria-label={`授权 ${member.displayName}`}
                      checked={Boolean(permission)}
                      disabled={isSaving}
                      onChange={(event) => void savePolicy({
                        ...policy,
                        permissions: event.target.checked
                          ? [...policy.permissions, { role: "viewer", userId: member.id }]
                          : policy.permissions.filter((item) => item.userId !== member.id),
                      })}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                    <select
                      aria-label={`${member.displayName} 权限`}
                      disabled={!permission || isSaving}
                      onChange={(event) => void savePolicy({
                        ...policy,
                        permissions: policy.permissions.map((item) => item.userId === member.id
                          ? { ...item, role: event.target.value as DocumentPermissionRole }
                          : item),
                      })}
                      value={permission?.role ?? "viewer"}
                    >
                      <option value="viewer">可查看</option>
                      <option value="editor">可编辑</option>
                    </select>
                  </div>
                );
              })}
              {workspaceMembers.every((member) => member.role === "owner") ? (
                <p className="text-xs text-muted-foreground">当前没有可单独授权的工作区成员。</p>
              ) : null}
            </section>
          </>
        ) : null}

        {status ? <Badge aria-live="polite" variant="success">{status}</Badge> : null}
      </DialogContent>
    </Dialog>
  );
}

function formatExpiration(expiresAt: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(expiresAt);
}

function toDateTimeLocalValue(value: Date) {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}
