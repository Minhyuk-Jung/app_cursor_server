/** 09 §6.3: 방해금지 종료까지 남은 ms (없으면 0) */
export function msUntilQuietHoursEnd(
  start: number,
  end: number,
  now = new Date(),
): number {
  const hour = now.getHours();

  if (start <= end) {
    if (hour < start || hour >= end) return 0;
    const endDate = new Date(now);
    endDate.setHours(end, 0, 0, 0);
    return Math.max(0, endDate.getTime() - now.getTime());
  }

  // overnight e.g. 22–8
  if (hour >= start) {
    const endDate = new Date(now);
    endDate.setDate(endDate.getDate() + 1);
    endDate.setHours(end, 0, 0, 0);
    return Math.max(0, endDate.getTime() - now.getTime());
  }
  if (hour < end) {
    const endDate = new Date(now);
    endDate.setHours(end, 0, 0, 0);
    return Math.max(0, endDate.getTime() - now.getTime());
  }
  return 0;
}
