import { useCallback, useEffect, useState } from 'react';

export type AppRoute = '/' | '/controller' | '/dashboard' | '/docs';

function normalizePath(pathname: string): AppRoute {
  if (pathname === '/controller' || pathname.startsWith('/controller/')) return '/controller';
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return '/dashboard';
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return '/docs';
  return '/';
}

export function useRoute() {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/'
  );
  const [search, setSearch] = useState<string>(() =>
    typeof window !== 'undefined' ? window.location.search : ''
  );

  useEffect(() => {
    const onPopState = () => {
      setRoute(normalizePath(window.location.pathname));
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    const url = new URL(to, window.location.origin);
    window.history.pushState({}, '', `${url.pathname}${url.search}`);
    setRoute(normalizePath(url.pathname));
    setSearch(url.search);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  return { route, search, navigate };
}
