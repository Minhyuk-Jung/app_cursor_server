import type { AppSettings } from "../config.js";
import { fetchAttachmentBlob } from "../api/client.js";

const cache = new Map<string, Promise<Blob>>();

function cacheKey(projectId: string, ref: string): string {
  return `${projectId}:${ref}`;
}

export function getCachedAttachmentBlob(
  settings: AppSettings,
  projectId: string,
  ref: string,
): Promise<Blob> {
  const key = cacheKey(projectId, ref);
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchAttachmentBlob(settings, projectId, ref);
    cache.set(key, pending);
    void pending.catch(() => {
      cache.delete(key);
    });
  }
  return pending;
}

export function invalidateAttachmentBlobCache(
  projectId?: string,
  ref?: string,
): void {
  if (!projectId) {
    cache.clear();
    return;
  }
  if (ref) {
    cache.delete(cacheKey(projectId, ref));
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(`${projectId}:`)) cache.delete(key);
  }
}
