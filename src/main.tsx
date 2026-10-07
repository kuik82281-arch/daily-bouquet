import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import VasePage from './vase/VasePage';

createRoot(document.getElementById('root')!).render(<StrictMode><VasePage /></StrictMode>);
