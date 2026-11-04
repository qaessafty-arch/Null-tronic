import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { registerAllTools } from './engineering-tools/tools';
import { installGlobalCommands } from './input-system/commands';
import { store } from './state/store';
import { getAdapter } from './input-system/input';
import './styles.css';

registerAllTools();
installGlobalCommands();

// Test / automation hook: exposes the store read-only state and command dispatch (used by e2e tests).
(window as unknown as { __ntcs: unknown }).__ntcs = { store, getAdapter };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
