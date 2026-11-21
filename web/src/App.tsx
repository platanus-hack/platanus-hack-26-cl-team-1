// Picks the page from the URL (owner: Anaís). `/` goes to the supervisor, keeping `?server=`.
import { SupervisorPage } from './pages/SupervisorPage';
import { route } from './router';

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
  return <SupervisorPage />;
}
