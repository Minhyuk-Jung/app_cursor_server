export interface InboxSeedItem {
  id: string;
  title: string;
}

/** Maestro Git inbox 중복 prune 대상 id (첫 항목 유지) */
export function pickInboxGitDuplicateIds(
  items: InboxSeedItem[],
  title: string,
): string[] {
  const matches = items.filter((item) => item.title === title);
  return matches.slice(1).map((item) => item.id);
}

export function hasInboxGitEntry(items: Array<{ title: string }>, title: string): boolean {
  return items.some((item) => item.title === title);
}
