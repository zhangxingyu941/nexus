// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createRichTextFromPlainText } from "../shared/richText";
import type { EditorDocument } from "../features/editor/model/block";
import { createSharedDocumentSnapshot } from "./sharedDocumentSnapshot";

describe("createSharedDocumentSnapshot", () => {
  it("keeps public content while stripping private task and identity fields", () => {
    const document = documentFixture();
    const snapshot = createSharedDocumentSnapshot(document, {
      expiresAt: 100_000,
      signedAttachmentUrls: new Map([
        [
          "workspace-1/allowed.png",
          "/api/shared-files/share-1/key-token?expiresAt=5000&signature=sig",
        ],
      ]),
    });

    expect(snapshot).toEqual({
      document: {
        blocks: [
          {
            children: [],
            content: "公开正文",
            data: null,
            headingLevel: 1,
            id: "paragraph-1",
            parentId: null,
            richText: createRichTextFromPlainText(document.blocks[0].content),
            type: "paragraph",
          },
          {
            children: [],
            content: "设计稿",
            data: {
              kind: "image",
              mimeType: "image/png",
              name: "design.png",
              size: 128,
              url: "/api/shared-files/share-1/key-token?expiresAt=5000&signature=sig",
            },
            headingLevel: 1,
            id: "image-1",
            parentId: null,
            richText: null,
            type: "image",
          },
          {
            children: [],
            content: "伪造文件",
            data: null,
            headingLevel: 1,
            id: "file-1",
            parentId: null,
            richText: null,
            type: "file",
          },
          {
            children: [],
            content: "",
            data: {
              description: "公开描述",
              kind: "linkCard",
              title: "公开链接",
              url: "https://example.com/public",
            },
            headingLevel: 1,
            id: "link-1",
            parentId: null,
            richText: null,
            type: "linkCard",
          },
        ],
        title: "公开方案",
      },
      expiresAt: 100_000,
    });

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("document-internal-1");
    expect(serialized).not.toContain("评论正文");
    expect(serialized).not.toContain("负责人邮箱");
    expect(serialized).not.toContain("workspace-1/allowed.png");
    expect(serialized).not.toContain("/api/files/");
  });

  it("clones non-attachment block data", () => {
    const document = documentFixture();
    const snapshot = createSharedDocumentSnapshot(document, {
      expiresAt: 100_000,
      signedAttachmentUrls: new Map(),
    });
    const sharedLink = snapshot.document.blocks[3].data;

    expect(sharedLink).not.toBe(document.blocks[3].data);
  });

  it("keeps public formatting while degrading mention targets to text", () => {
    const document = documentFixture();
    document.blocks[0] = {
      ...document.blocks[0],
      content: "Owner: @Ada",
      richText: {
        content: [{
          content: [
            { marks: [{ type: "bold" }], text: "Owner: ", type: "text" },
            { attrs: { kind: "person", label: "Ada", targetId: "person-internal-1" }, type: "mention" },
          ],
          type: "paragraph",
        }],
        type: "doc",
      },
    };

    const snapshot = createSharedDocumentSnapshot(document, {
      expiresAt: 100_000,
      signedAttachmentUrls: new Map(),
    });

    expect(snapshot.document.blocks[0]).toMatchObject({
      content: "Owner: @Ada",
      richText: {
        content: [{
          content: [
            { marks: [{ type: "bold" }], text: "Owner: ", type: "text" },
            { text: "@Ada", type: "text" },
          ],
          type: "paragraph",
        }],
        type: "doc",
      },
    });
    const serializedRichText = JSON.stringify(snapshot.document.blocks[0].richText);
    expect(serializedRichText).not.toContain("person-internal-1");
    expect(serializedRichText).not.toContain('"targetId"');
    expect(serializedRichText).not.toContain('"kind"');
  });
});

function documentFixture(): EditorDocument {
  return {
    blocks: [
      block({
        assignee: "负责人邮箱",
        checked: true,
        comments: [{
          author: "内部成员",
          body: "评论正文",
          createdAt: 1000,
          id: "comment-1",
          resolved: false,
          time: "刚刚",
        }],
        content: "公开正文",
        dueDate: "2026-12-31",
        id: "paragraph-1",
        status: "in-progress",
        type: "paragraph",
      }),
      block({
        content: "设计稿",
        data: {
          key: "workspace-1/allowed.png",
          kind: "image",
          mimeType: "image/png",
          name: "design.png",
          size: 128,
          url: "/api/files/workspace-1/allowed.png",
        },
        id: "image-1",
        type: "image",
      }),
      block({
        content: "伪造文件",
        data: {
          key: "workspace-1/forged.pdf",
          kind: "file",
          mimeType: "application/pdf",
          name: "forged.pdf",
          size: 256,
          url: "/api/files/workspace-1/forged.pdf",
        },
        id: "file-1",
        type: "file",
      }),
      block({
        data: {
          description: "公开描述",
          kind: "linkCard",
          title: "公开链接",
          url: "https://example.com/public",
        },
        id: "link-1",
        type: "linkCard",
      }),
    ],
    id: "document-internal-1",
    title: "公开方案",
    updatedAt: 1000,
  };
}

function block(overrides: Partial<EditorDocument["blocks"][number]>) {
  return {
    assignee: "",
    checked: false,
    children: [],
    comments: [],
    content: "",
    createdAt: 1000,
    data: null,
    dueDate: "",
    headingLevel: 1 as const,
    id: "block-1",
    parentId: null,
    richText: null,
    status: "unset" as const,
    type: "paragraph" as const,
    updatedAt: 1000,
    ...overrides,
  } as EditorDocument["blocks"][number];
}
