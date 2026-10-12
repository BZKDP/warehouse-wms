import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';
import { appBasePath } from './utils/appBasePath';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={appBasePath || undefined}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
