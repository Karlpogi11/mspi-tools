import { useCallback, useEffect, useState } from 'react';

const cache = new Map<string, unknown>();

export function invalidateQuery(key: string) {
  cache.delete(key);
}

export function useCachedQuery<T>(key: string, loader: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => cache.get(key) as T | undefined);
  const [loading, setLoading] = useState(data === undefined);
  const [error, setError] = useState<unknown>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await loader();
      cache.set(key, next);
      setData(next);
      setError(null);
      return next;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [key, loader]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return { data, loading, error, refresh };
}
