// Path routing without a dependency (owner: Anaís). The demo server serves real files only (D-015), so
// every page path also exists in the build as `<page>/index.html` (see vite.config.ts PAGES).

export type Route = 'supervisor' | 'simulator' | 'root' | 'not_found';

export function route(pathname: string): Route {
  if (pathname === '/') return 'root';
  const path = pathname.replace(/\/+$/, '');
  if (path === '/supervisor') return 'supervisor';
  if (path === '/simulador') return 'simulator';
  return 'not_found';
}
