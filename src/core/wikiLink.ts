export function basenameWithoutExt(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.md$/u, "");
}

export function wikiLinkToPath(path: string, blockId?: string): string {
  const target = basenameWithoutExt(path);
  return blockId ? `[[${target}#^${stripCaret(blockId)}]]` : `[[${target}]]`;
}

export function wikiLinkToName(name: string, blockId?: string): string {
  return blockId ? `[[${name}#^${stripCaret(blockId)}]]` : `[[${name}]]`;
}

function stripCaret(blockId: string): string {
  return blockId.startsWith("^") ? blockId.slice(1) : blockId;
}
