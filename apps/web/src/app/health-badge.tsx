'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

type Report = {
  status: string;
  components: { database: string; redis: string };
};

export function HealthBadge() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/internal/healthz`)
      .then((r) => r.json())
      .then(setReport)
      .catch(() => setError(true));
  }, []);

  if (error) return <span className="text-red-600">API unreachable ({API_URL})</span>;
  if (!report) return <span className="text-neutral-500">checking API…</span>;

  return (
    <span>
      API <strong>{report.status}</strong> · db {report.components.database} · redis{' '}
      {report.components.redis}
    </span>
  );
}
