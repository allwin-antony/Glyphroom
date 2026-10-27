import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext.js';
import { AuthProvider } from './context/AuthContext.js';
import { PluginProvider } from './plugins/PluginProvider.js';
import { router } from './router.js';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <PluginProvider>
          <RouterProvider router={router} />
        </PluginProvider>
      </AuthProvider>
    </ThemeProvider>
  </React.StrictMode>
);
