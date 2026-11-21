// Page links (owner: Anaís). Plain links that keep the query string, so `?server=` survives navigation.
export function Nav({ current }: { current: 'supervisor' | 'simulator' }) {
  const q = location.search;
  return (
    <nav className="nav">
      <a href={`/supervisor${q}`} aria-current={current === 'supervisor' ? 'page' : undefined}>
        Supervisor
      </a>
      <a href={`/simulador${q}`} aria-current={current === 'simulator' ? 'page' : undefined}>
        Simulador
      </a>
    </nav>
  );
}
