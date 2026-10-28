import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// No StrictMode: its double-mounted layout effects leave drei's Html screens empty.
createRoot(document.getElementById('root')!).render(<App />)
