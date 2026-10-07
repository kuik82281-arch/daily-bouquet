import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import VasePage from './vase/VasePage';

// the online demo has no server: answer the vase's API in the browser
if (import.meta.env.VITE_DEMO) await import('./demo');

createRoot(document.getElementById('root')!).render(<StrictMode><VasePage /></StrictMode>);
