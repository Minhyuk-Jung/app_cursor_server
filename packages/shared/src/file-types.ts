/** UR-02 / 11-file-service — web·mobile 공유 파일 API 타입 */
export interface TreeNode {
  name: string;
  path: string;
  type: "dir" | "file";
  children?: TreeNode[];
  size?: number;
}

export interface FileContent {
  path: string;
  language: string;
  encoding: "utf-8" | "binary";
  content?: string;
  truncated: boolean;
}

export interface SearchMatch {
  path: string;
  line: number;
  snippet: string;
}
