import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <p className="p-8 text-slate-300">CRM Analytics: фронтенд в разработке.</p>
  </StrictMode>,
);
