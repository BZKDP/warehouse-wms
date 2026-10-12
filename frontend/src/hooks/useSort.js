import { useState, useMemo } from 'react';

export function useSort(items, defaultKey = null, defaultDir = 'asc') {
  const [sort, setSort] = useState({ key: defaultKey, dir: defaultDir });

  const toggle = (key) => {
    setSort(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc',
    }));
  };

  const sorted = useMemo(() => {
    if (!sort.key || !items?.length) return items || [];
    return [...items].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'number' || !isNaN(Number(av))
        ? Number(av) - Number(bv)
        : String(av).localeCompare(String(bv), 'ru');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [items, sort.key, sort.dir]);

  return { sorted, sort, toggle };
}
