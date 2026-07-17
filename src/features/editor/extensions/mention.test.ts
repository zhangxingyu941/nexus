import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Mention from "./mention";

describe("Mention extension", () => {
  it("has the correct node name", () => {
    expect(Mention.name).toBe("mention");
  });

  it("creates an editor with mention node in schema", () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, Mention],
      content: "",
    });
    const schema = editor.schema;
    expect(schema.nodes.mention).toBeDefined();
    editor.destroy();
  });

  it("parses mention spans from HTML", () => {
    const editor = new Editor({
      extensions: [Document, Paragraph, Text, Mention],
      content:
        '<p><span class="mention" data-kind="person" data-target-id="user-1" data-label="Alice">@Alice</span></p>',
    });
    const json = editor.getJSON();
    const mentionNode = json.content?.[0]?.content?.[0];
    expect(mentionNode?.type).toBe("mention");
    expect(mentionNode?.attrs).toMatchObject({
      kind: "person",
      targetId: "user-1",
      label: "Alice",
    });
    editor.destroy();
  });
});
