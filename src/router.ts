import { useEffect, useState } from 'react';

/** Returns the current pathname; updates on navigation. */
export function usePathname(): string {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    window.addEventListener('app-navigate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('app-navigate', onPop);
    };
  }, []);
  return path;
}

export function navigate(path: string) {
  if (window.location.pathname !== path) {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new Event('app-navigate'));
  }
}

export function searchParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** Updates one query parameter in place, without adding a history entry. */
export function replaceSearchParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value == null) url.searchParams.delete(name);
  else url.searchParams.set(name, value);
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}
