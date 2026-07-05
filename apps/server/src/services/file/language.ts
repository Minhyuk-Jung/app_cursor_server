const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  csv: "csv",
  tsv: "csv",
  json: "json",
  html: "html",
  css: "css",
  scss: "scss",
  yaml: "yaml",
  yml: "yaml",
  xml: "xml",
  sql: "sql",
  sh: "shell",
  bash: "shell",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  ico: "image",
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

export function inferLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return EXT_MAP[ext] ?? "binary";
}

export function isImageLanguage(language: string): boolean {
  return language === "image";
}

export function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (IMAGE_EXTS.has(ext)) return false;
  return !(ext in EXT_MAP) || EXT_MAP[ext] === "binary";
}

export function isTextLanguage(language: string): boolean {
  return language !== "binary" && language !== "image";
}
