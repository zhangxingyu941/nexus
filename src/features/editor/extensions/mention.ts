import { Node } from "@tiptap/core";

export interface MentionAttrs {
  kind: "person" | "document" | "task" | "date";
  targetId: string;
  label: string;
}

const Mention = Node.create({
  name: "mention",

  group: "inline",

  inline: true,

  atom: true,

  addAttributes() {
    return {
      kind: {
        default: "person",
        parseHTML(element) {
          return element.getAttribute("data-kind") || "person";
        },
        renderHTML(attributes) {
          return { "data-kind": attributes.kind };
        },
      },
      targetId: {
        default: "",
        parseHTML(element) {
          return element.getAttribute("data-target-id") || "";
        },
        renderHTML(attributes) {
          return { "data-target-id": attributes.targetId };
        },
      },
      label: {
        default: "",
        parseHTML(element) {
          return element.getAttribute("data-label") || "";
        },
        renderHTML(attributes) {
          return { "data-label": attributes.label };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[class="mention"]',
        getAttrs(element) {
          if (typeof element === "string") return false;

          return {
            kind: element.getAttribute("data-kind") || "person",
            targetId: element.getAttribute("data-target-id") || "",
            label: element.getAttribute("data-label") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      {
        ...HTMLAttributes,
        class: "mention",
      },
      `@${HTMLAttributes.label}`,
    ];
  },
});

export default Mention;
