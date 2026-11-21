// Page links (owner: Anaís). Plain links that keep the query string, so `?server=` survives navigation.
export const SIMULATOR_PATH = '/simulador';

export function Nav({ current }: { current: 'home' | 'simulator' }) {
  const q = location.search;
  return (
    <nav className="nav">
      <a href={`/${q}`} aria-current={current === 'home' ? 'page' : undefined}>
        Supervisor
      </a>
      <a href={`${SIMULATOR_PATH}/${q}`} aria-current={current === 'simulator' ? 'page' : undefined}>
        Simulador
      </a>
    </nav>
  );
}
