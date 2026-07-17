import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
  it("renders persisted members without a direct-add form for owners", () => {
    render(
      <MembersPopover
        collaborators={collaborators}
        onlineCount={1}
        openCommentCount={1}
        presence={[]}
        workspaceMembers={[
          { displayName: "林夏", email: "owner@example.com", id: "owner-1", role: "owner" },
        ]}
        onClose={() => undefined}
      />,
    );

    expect(screen.getByRole("region", { name: "数据库工作区成员" })).toHaveTextContent("所有者");
    expect(screen.queryByRole("form", { name: "邀请工作区成员" })).not.toBeInTheDocument();
    expect(screen.queryByText("添加已有身份")).not.toBeInTheDocument();
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
        onClose={() => undefined}
      />,
    );

    expect(screen.queryByRole("form", { name: "邀请工作区成员" })).not.toBeInTheDocument();
  });
});
