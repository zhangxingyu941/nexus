import { Check, Lock, Users } from "lucide-react";
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
import type { DatabaseWorkspaceMember } from "../../session/sessionTypes";
import {
  createDocumentRepository,
  type DocumentPolicySnapshot,
} from "../../persistence/documentRepository";

const ACCESS_MODE_OPTIONS = [
  { icon: Lock, label: "仅自己与获授权成员可查看", value: "private" as const },
  { icon: Users, label: "团队可查看", value: "workspace" as const },
];

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
  const [snapshot, setSnapshot] = useState<DocumentPolicySnapshot | null>(null);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    setSnapshot(null);
    setError("");
    setStatus("");

    repository.loadPolicy(documentPublicId)
      .then((next) => {
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) setError("仅工作区所有者可以管理访问权限");
      });

    return () => {
      cancelled = true;
    };
  }, [documentPublicId, repository]);

  const savePolicy = async (policy: DocumentPolicy) => {
    if (!snapshot?.access.canManage || isSaving) {
      return;
    }

    setIsSaving(true);
    setError("");
    setStatus("");
    try {
      const updated = await repository.updatePolicy(documentPublicId, policy);
      setSnapshot(updated);
      setStatus("访问权限已更新");
    } catch {
      setError("访问权限更新失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}/documents/${encodeURIComponent(documentPublicId)}`;
    void navigator.clipboard?.writeText(link)?.catch(() => undefined);
    setStatus("链接已复制");
  };

  const policy = snapshot?.policy;
  const canManage = snapshot?.access.canManage === true;
  const managementMessage = error || (snapshot && !canManage
    ? "仅工作区所有者可以管理访问权限"
    : "");
  const permissionsByUser = new Map(policy?.permissions.map((permission) => [permission.userId, permission]));

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分享文档</DialogTitle>
          <DialogDescription>设置谁可以访问当前文档。</DialogDescription>
        </DialogHeader>

        {!snapshot && !managementMessage ? <p className="text-sm text-muted-foreground" role="status">正在读取访问权限</p> : null}
        {managementMessage ? <p className="text-sm text-muted-foreground" role="status">{managementMessage}</p> : null}

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
                    {policy.accessMode === option.value ? <Check aria-hidden="true" className="size-4" /> : null}
                  </label>
                );
              })}
            </div>

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

        <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/50 p-2">
          <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">{`${window.location.origin}/documents/${documentPublicId}`}</span>
          <Button className="h-8 shrink-0" onClick={handleCopyLink} size="sm" type="button">复制链接</Button>
        </div>
        {status ? <Badge aria-live="polite" variant="success">{status}</Badge> : null}
      </DialogContent>
    </Dialog>
  );
}
