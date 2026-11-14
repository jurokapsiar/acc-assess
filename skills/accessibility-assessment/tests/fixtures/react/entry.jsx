import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

const variant = new URLSearchParams(location.search).get('v') || 'before';
createRoot(document.getElementById('root')).render(<App variant={variant} />);
