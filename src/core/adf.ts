// Atlassian Document Format(ADF) → Markdown 근사 변환.
//
// Jira Cloud REST v3 의 description 은 ADF JSON 트리로 온다. 목표는 완전한
// 왕복 변환이 아니라 "사람이 읽고 grep 할 수 있는 본문" — 모르는 노드는
// 자식 텍스트를 이어붙여 내용 유실을 막는다 (관용적 degradation).

interface AdfNode {
  type?: unknown;
  text?: unknown;
  content?: unknown;
  attrs?: { level?: unknown; language?: unknown; url?: unknown; text?: unknown; shortName?: unknown };
  marks?: Array<{ type?: unknown; attrs?: { href?: unknown } }>;
}

export function adfToMarkdown(root: unknown): string {
  if (root == null) return "";
  if (typeof root === "string") return root;
  const md = blocks(childrenOf(root), 0).join("\n\n");
  return md.replace(/\n{3,}/gu, "\n\n").trim();
}

function childrenOf(node: unknown): AdfNode[] {
  const content = (node as AdfNode | null)?.content;
  return Array.isArray(content) ? (content as AdfNode[]) : [];
}

function blocks(nodes: AdfNode[], depth: number): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    const rendered = block(node, depth);
    if (rendered.trim().length > 0) out.push(rendered);
  }
  return out;
}

function block(node: AdfNode, depth: number): string {
  const type = typeof node.type === "string" ? node.type : "";
  switch (type) {
    case "paragraph":
      return inline(childrenOf(node));
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 1;
      return `${"#".repeat(Math.min(Math.max(level, 1), 6))} ${inline(childrenOf(node))}`;
    }
    case "bulletList":
      return childrenOf(node)
        .map((li) => listItem(li, depth, "- "))
        .join("\n");
    case "orderedList":
      return childrenOf(node)
        .map((li, i) => listItem(li, depth, `${i + 1}. `))
        .join("\n");
    case "codeBlock": {
      const lang = typeof node.attrs?.language === "string" ? node.attrs.language : "";
      return `\`\`\`${lang}\n${inline(childrenOf(node))}\n\`\`\``;
    }
    case "blockquote":
      return blocks(childrenOf(node), depth)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "rule":
      return "---";
    case "table":
      return childrenOf(node)
        .map((row) => `| ${childrenOf(row).map((cell) => blocks(childrenOf(cell), depth).join(" ")).join(" | ")} |`)
        .join("\n");
    case "mediaSingle":
    case "mediaGroup":
      return "[첨부]";
    default:
      // panel, expand, doc 하위의 알 수 없는 컨테이너 등 — 내용만 살린다.
      if (childrenOf(node).length > 0) return blocks(childrenOf(node), depth).join("\n\n");
      return inline([node]);
  }
}

function listItem(li: AdfNode, depth: number, marker: string): string {
  const indent = "  ".repeat(depth);
  const parts = childrenOf(li).map((child) => {
    const type = typeof child.type === "string" ? child.type : "";
    if (type === "bulletList" || type === "orderedList") return block(child, depth + 1);
    return `${indent}${marker}${block(child, depth)}`;
  });
  return parts.join("\n");
}

function inline(nodes: AdfNode[]): string {
  return nodes.map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  const type = typeof node.type === "string" ? node.type : "";
  if (type === "text") {
    let text = typeof node.text === "string" ? node.text : "";
    for (const mark of node.marks ?? []) {
      const markType = typeof mark.type === "string" ? mark.type : "";
      if (markType === "strong") text = `**${text}**`;
      else if (markType === "em") text = `*${text}*`;
      else if (markType === "code") text = `\`${text}\``;
      else if (markType === "strike") text = `~~${text}~~`;
      else if (markType === "link" && typeof mark.attrs?.href === "string") {
        text = `[${text}](${mark.attrs.href})`;
      }
    }
    return text;
  }
  if (type === "hardBreak") return "\n";
  if (type === "mention") {
    return typeof node.attrs?.text === "string" ? node.attrs.text : "@?";
  }
  if (type === "emoji") {
    return typeof node.attrs?.shortName === "string" ? node.attrs.shortName : "";
  }
  if (type === "inlineCard") {
    return typeof node.attrs?.url === "string" ? node.attrs.url : "";
  }
  if (childrenOf(node).length > 0) return inline(childrenOf(node));
  return "";
}
