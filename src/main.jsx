import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { apiBaseUrl, isApiConfigured } from './api.ts';
import './index.css';

/*
 * The magic link lands on the web app, but the session cookie is minted by
 * the API: the browser has to visit the API's path once, so the cookie is
 * written on the API's origin and the API sends the student back here.
 *
 * Without an API there is nothing to forward to: the demo mode keeps the
 * route as it is.
 */
const MAGIC_LINK_PATH = /^\/auth\/magic-link\/[^/]+\/?$/;

if (isApiConfigured() && MAGIC_LINK_PATH.test(window.location.pathname)) {
  window.location.replace(`${apiBaseUrl()}${window.location.pathname}${window.location.search}`);
} else {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
