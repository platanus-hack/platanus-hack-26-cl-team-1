import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { SIMULATOR_PATH } from './Nav';
import './app.css';

// The simulator (three.js) is its own chunk: the main page doesn't download it.
const SimulatorPage = lazy(() => import('./simulator/SimulatorPage').then((m) => ({ default: m.SimulatorPage })));

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');
const onSimulator = location.pathname.replace(/\/$/, '') === SIMULATOR_PATH;
createRoot(root).render(
  <StrictMode>
    {onSimulator ? (
      <Suspense fallback={<main className="sim-page">Cargando simulador…</main>}>
        <SimulatorPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
