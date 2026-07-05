import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../config.js";
import {
  createProjectDir,
  createProjectFile,
  deleteProjectFile,
  getProjectFile,
  getProjectTree,
  renameProjectFile,
  saveProjectFile,
  searchProject,
  ApiError,
  type FileContent,
  type SearchMatch,
  type TreeNode,
} from "../api/client.js";
import {
  formatJson,
  jsonToTree,
  parseCsv,
  renderMarkdown,
} from "./file-view-helpers.js";

interface FileExplorerProps {
  settings: AppSettings;
  projectId: string | null;
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
  refreshKey?: number;
  onTreeChanged?: () => void;
}

function TreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);

  if (node.type === "file") {
    return (
      <button
        type="button"
        className={`tree-file ${selectedPath === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelect(node.path)}
      >
        {node.name}
      </button>
    );
  }

  return (
    <div className="tree-dir">
      <button
        type="button"
        className="tree-dir-label"
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "▾" : "▸"} {node.name || "/"}
      </button>
      {open &&
        node.children?.map((child) => (
          <TreeItem
            key={child.path || child.name}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}

export function FileTreePanel({
  settings,
  projectId,
  selectedPath,
  onSelectFile,
  refreshKey = 0,
  onTreeChanged,
}: FileExplorerProps) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setTree(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const t = await getProjectTree(settings, projectId);
      setTree(t);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId, settings]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !searchQuery.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const matches = await searchProject(settings, projectId, searchQuery.trim());
      setSearchResults(matches);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleCreateFile = async () => {
    if (!projectId) return;
    const name = prompt("새 파일 경로 (예: notes.txt)")?.trim();
    if (!name) return;
    try {
      await createProjectFile(settings, projectId, name);
      await load();
      onTreeChanged?.();
      onSelectFile(name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleCreateDir = async () => {
    if (!projectId) return;
    const name = prompt("새 폴더 경로 (예: docs)")?.trim();
    if (!name) return;
    try {
      await createProjectDir(settings, projectId, name);
      await load();
      onTreeChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleDelete = async () => {
    if (!projectId || !selectedPath) return;
    if (!confirm(`"${selectedPath}" 삭제? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteProjectFile(settings, projectId, selectedPath);
      await load();
      onTreeChanged?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const handleRename = async () => {
    if (!projectId || !selectedPath) return;
    const to = prompt("새 경로", selectedPath)?.trim();
    if (!to || to === selectedPath) return;
    try {
      await renameProjectFile(settings, projectId, selectedPath, to);
      await load();
      onTreeChanged?.();
      onSelectFile(to);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <aside className="file-tree-panel">
      <header className="panel-header">
        <h2>파일</h2>
        <div className="file-toolbar">
          <button type="button" className="btn-sm" title="새 파일" onClick={() => void handleCreateFile()}>
            +
          </button>
          <button type="button" className="btn-sm" title="새 폴더" onClick={() => void handleCreateDir()}>
            📁
          </button>
          <button
            type="button"
            className="btn-sm"
            title="이름 변경"
            disabled={!selectedPath}
            onClick={() => void handleRename()}
          >
            ✎
          </button>
          <button
            type="button"
            className="btn-sm btn-danger-text"
            title="삭제"
            disabled={!selectedPath}
            onClick={() => void handleDelete()}
          >
            ×
          </button>
          <button type="button" className="btn-sm" onClick={() => void load()}>
            ↻
          </button>
        </div>
      </header>

      <form className="file-search-form" onSubmit={(e) => void handleSearch(e)}>
        <input
          type="search"
          placeholder="검색…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button type="submit" className="btn-sm" disabled={searching}>
          {searching ? "…" : "🔍"}
        </button>
      </form>

      {loading && <p className="muted empty-hint">로딩…</p>}
      {error && <p className="error-text">{error}</p>}

      {searchResults.length > 0 && (
        <ul className="search-results">
          {searchResults.map((m, i) => (
            <li key={`${m.path}-${m.line}-${i}`}>
              <button
                type="button"
                className="search-hit"
                onClick={() => {
                  onSelectFile(m.path);
                  setSearchResults([]);
                }}
              >
                <span className="search-path">{m.path}</span>
                {m.line > 0 && <span className="muted">:{m.line}</span>}
                <span className="search-snippet">{m.snippet}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tree && (
        <div className="tree-root">
          {tree.children?.map((child) => (
            <TreeItem
              key={child.path || child.name}
              node={child}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelectFile}
            />
          ))}
          {!tree.children?.length && (
            <p className="muted empty-hint">파일 없음</p>
          )}
        </div>
      )}
    </aside>
  );
}

interface FileViewerProps {
  settings: AppSettings;
  projectId: string | null;
  filePath: string | null;
  refreshKey?: number;
  onSaved?: () => void;
}

export function FileViewerPanel({
  settings,
  projectId,
  filePath,
  refreshKey = 0,
  onSaved,
}: FileViewerProps) {
  const [file, setFile] = useState<FileContent | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markdownPreview, setMarkdownPreview] = useState(false);
  const [jsonView, setJsonView] = useState<"edit" | "tree">("edit");

  useEffect(() => {
    if (!projectId || !filePath) {
      setFile(null);
      setDraft("");
      setDirty(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void getProjectFile(settings, projectId, filePath)
      .then((f) => {
        if (cancelled) return;
        setFile(f);
        setDraft(f.content ?? "");
        setDirty(false);
        setMarkdownPreview(false);
        setJsonView("edit");
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof ApiError ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId, filePath, settings, refreshKey]);

  const handleSave = async () => {
    if (!projectId || !filePath || !file) return;
    setSaving(true);
    setError(null);
    try {
      await saveProjectFile(settings, projectId, filePath, draft);
      setDirty(false);
      onSaved?.();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleFormatJson = () => {
    setDraft(formatJson(draft));
    setDirty(true);
  };

  if (!filePath) {
    return (
      <section className="file-viewer-panel">
        <p className="muted empty-hint">파일을 선택하세요.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="file-viewer-panel">
        <p className="muted empty-hint">파일 로딩…</p>
      </section>
    );
  }

  if (!file) {
    return (
      <section className="file-viewer-panel">
        {error && <p className="error-text">{error}</p>}
      </section>
    );
  }

  const csvRows = file.language === "csv" ? parseCsv(draft) : null;
  let jsonTree: string | null = null;
  if (file.language === "json" && jsonView === "tree") {
    try {
      jsonTree = jsonToTree(JSON.parse(draft));
    } catch {
      jsonTree = "유효하지 않은 JSON";
    }
  }

  return (
    <section className="file-viewer-panel">
      <header className="panel-header file-viewer-header">
        <h2 title={file.path}>{file.path}</h2>
        <span className="muted">{file.language}</span>
        {file.truncated && <span className="badge-warn">truncated</span>}
        {file.encoding === "utf-8" && file.language !== "binary" && (
          <>
            {file.language === "markdown" && (
              <button
                type="button"
                className="btn-sm"
                onClick={() => setMarkdownPreview((v) => !v)}
              >
                {markdownPreview ? "원문" : "미리보기"}
              </button>
            )}
            {file.language === "json" && (
              <>
                <button type="button" className="btn-sm" onClick={handleFormatJson}>
                  포맷
                </button>
                <button
                  type="button"
                  className="btn-sm"
                  onClick={() =>
                    setJsonView((v) => (v === "edit" ? "tree" : "edit"))
                  }
                >
                  {jsonView === "edit" ? "트리" : "편집"}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn-primary btn-sm"
              disabled={!dirty || saving}
              onClick={() => void handleSave()}
            >
              {saving ? "저장…" : "저장"}
            </button>
          </>
        )}
      </header>

      {error && <p className="error-text">{error}</p>}

      {file.language === "image" && file.content && (
        <img
          className="file-image-preview"
          src={`data:image/*;base64,${file.content}`}
          alt={file.path}
        />
      )}

      {file.language === "binary" && (
        <p className="muted empty-hint">바이너리 파일 — 미리보기 불가</p>
      )}

      {file.language === "csv" && csvRows && csvRows.length > 0 && (
        <div className="csv-table-wrap">
          <table className="csv-table">
            <tbody>
              {csvRows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {file.encoding === "utf-8" &&
        file.language !== "image" &&
        file.language !== "binary" &&
        file.language !== "csv" &&
        (file.language === "markdown" && markdownPreview ? (
          <div
            className="markdown-preview"
            data-testid="markdown-preview"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }}
          />
        ) : file.language === "json" && jsonView === "tree" ? (
          <pre className="json-tree">{jsonTree}</pre>
        ) : (
          <textarea
            className={`file-editor ${file.language === "json" ? "file-editor-json" : ""}`}
            value={draft}
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setDirty(true);
            }}
          />
        ))}

      {file.language === "csv" && (
        <textarea
          className="file-editor file-editor-csv"
          value={draft}
          spellCheck={false}
          onChange={(e) => {
            setDraft(e.target.value);
            setDirty(true);
          }}
        />
      )}
    </section>
  );
}
