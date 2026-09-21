import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('未找到挂载节点 #root');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
