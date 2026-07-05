import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../config.js";
import { getUsage, type UsageSummary } from "../api/client.js";

interface UsagePanelProps {
  settings: AppSettings;
  open: boolean;
  onClose: () => void;
}

export function UsagePanel({ settings, open, onClose }: UsagePanelProps) {
  const [day, setDay] = useState<UsageSummary | null>(null);
  const [month, setMonth] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, m] = await Promise.all([
        getUsage(settings, "day"),
        getUsage(settings, "month"),
      ]);
      setDay(d);
      setMonth(m);
    } finally {
      setLoading(false);
    }
  }, [settings]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="drawer-overlay" onClick={onClose} role="presentation">
      <aside
        className="drawer usage-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="사용량"
      >
        <header className="drawer-header">
          <h2>사용량</h2>
          <button type="button" className="btn-sm" onClick={onClose}>
            닫기
          </button>
        </header>

        {loading && <p className="muted">불러오는 중…</p>}

        {day && (
          <section className="usage-section">
            <h3>오늘</h3>
            {day.warning && (
              <p className="usage-warning">
                일일 한도에 근접했습니다 ({day.total}/{day.limit})
              </p>
            )}
            <p>
              총 <strong>{day.total}</strong>
              {day.limit !== undefined && (
                <> / {day.limit} (남음 {day.remaining})</>
              )}
              회
            </p>
            <ul className="usage-kind-list">
              {Object.entries(day.byKind).map(([kind, count]) => (
                <li key={kind}>
                  {kind}: {count}
                </li>
              ))}
            </ul>
          </section>
        )}

        {month && (
          <section className="usage-section">
            <h3>이번 달</h3>
            <p>
              총 <strong>{month.total}</strong>회
            </p>
            <ul className="usage-kind-list">
              {Object.entries(month.byKind).map(([kind, count]) => (
                <li key={kind}>
                  {kind}: {count}
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}
