// Path routing without a dependency (owner: Anaís). The demo server serves real files only (D-015), so
// every page path also exists in the build as `<page>/index.html` (see vite.config.ts PAGES).

export type Route = 'supervisor' | 'root' | 'not_found';

export function route(pathname: string): Route {
  if (pathname === '/') return 'root';
  if (pathname.replace(/\/+$/, '') === '/supervisor') return 'supervisor';
  return 'not_found';
}
