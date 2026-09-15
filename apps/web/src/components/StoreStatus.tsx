import { useEffect, useState } from 'react';

type Status = { open: boolean; message: string };

export default function StoreStatus({ apiBaseUrl }: { apiBaseUrl: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBaseUrl}/store-status`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((value: Status) => setStatus(value))
      .catch(() => setStatus(null));
    return () => controller.abort();
  }, [apiBaseUrl]);
  return (
    <div className={`live-status ${status?.open ? 'open' : ''}`} role="status" aria-live="polite">
      <span />
      {status ? status.message : 'Jueves a domingo · 6:00 pm a 11:55 pm'}
    </div>
  );
}
