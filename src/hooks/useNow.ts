import { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` so room colours and alerts stay current. */
export const useNow = (intervalMs = 30_000): Date => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
};
