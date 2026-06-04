import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css'; // CSS variables + components ported verbatim from master.html

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
