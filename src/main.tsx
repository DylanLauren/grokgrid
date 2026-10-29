import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary'

const Crashed = () => (
  <div className="crash">
    <span>Something broke on this page.</span>
    <button onClick={() => location.reload()}>Reload</button>
  </div>
)

// No StrictMode: its double-mounted layout effects leave drei's Html screens empty.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary fallback={<Crashed />}>
    <App />
  </ErrorBoundary>,
)
