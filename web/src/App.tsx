// Picks the page from the URL (owner: Anaís). `/` goes to the supervisor, keeping `?server=`.
import { lazy, Suspense } from 'react';
import { SupervisorPage } from './pages/SupervisorPage';
import { route } from './router';

// The simulator (three.js) is its own chunk: the supervisor page doesn't download it.
const SimulatorPage = lazy(() => import('./simulator/SimulatorPage').then((m) => ({ default: m.SimulatorPage })));

export function App() {
  const page = route(location.pathname);
  if (page === 'root') history.replaceState(null, '', `/supervisor${location.search}`);
  if (page === 'not_found') {
    return (
      <main>
        <p>Esta página no existe.</p>
        <a href={`/supervisor${location.search}`}>Ir al supervisor</a>
      </main>
    );
  }
  if (page === 'simulator') {
    return (
      <Suspense fallback={<main className="sim-page">Cargando simulador…</main>}>
        <SimulatorPage />
      </Suspense>
    );
  }
  return <SupervisorPage />;
}
