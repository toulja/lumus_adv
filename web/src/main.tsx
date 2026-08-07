import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import './styles.css';

const wurzel = document.getElementById('app');
if (!wurzel) throw new Error('Wurzelelement #app fehlt.');

createRoot(wurzel).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
