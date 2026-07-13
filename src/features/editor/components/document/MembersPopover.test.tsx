import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MembersPopover } from "./MembersPopover";

const collaborators = [
  {
    activeDocumentTitle: "需求 PRD",
    activeTaskCount: 1,
    color: "green" as const,
    name: "林夏",
    openCommentCount: 1,
    role: "产品负责人",
    status: "online" as const,
  },
];

describe("MembersPopover database access", () => {
  it("renders persisted members and lets owners grant access", async () => {
    const user = userEvent.setup();
    const onInviteMember = vi.fn().mockResolvedValue(undefined);
    render(
      <MembersPopover
        collaborators={collaborators}
        onlineCount={1}
        openCommentCount={1}
        presence={[]}
        workspaceMembers={[
          { displayName: "林夏", email: "owner@example.com", id: "owner-1", role: "owner" },
        ]}
        workspaceRole="owner"
        onClose={() => undefined}
        onInviteMember={onInviteMember}
      />,
    );

    expect(screen.getByRole("region", { name: "数据库工作区成员" })).toHaveTextContent("所有者");
    const form = screen.getByRole("form", { name: "邀请工作区成员" });
    await user.type(within(form).getByLabelText("成员邮箱"), "editor@example.com");
    await user.selectOptions(within(form).getByLabelText("成员角色"), "editor");
    await user.click(within(form).getByRole("button", { name: "添加成员" }));

    expect(onInviteMember).toHaveBeenCalledWith("editor@example.com", "editor");
    expect(await within(form).findByRole("status")).toHaveTextContent("成员权限已更新");
  });

  it("does not expose member management to viewers", () => {
    render(
      <MembersPopover
        collaborators={collaborators}
        onlineCount={1}
        openCommentCount={1}
        presence={[]}
        workspaceMembers={[
          { displayName: "访客", email: "viewer@example.com", id: "viewer-1", role: "viewer" },
        ]}
        workspaceRole="viewer"
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByRole("form", { name: "邀请工作区成员" })).not.toBeInTheDocument();
  });
});
