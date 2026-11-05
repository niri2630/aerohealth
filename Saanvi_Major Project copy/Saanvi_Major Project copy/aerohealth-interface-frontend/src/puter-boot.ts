// Bootstrap Puter SDK from npm package and expose as window.puter
import Puter from '@heyputer/puter.js';

// Attach diagnostic helpers to window so the app can introspect startup state
if (typeof window !== 'undefined') {
  window.puterReady = false;

  try {
    window.puter = Puter;
    window.puterReady = true;
    window.puterInitializedAt = Date.now();
    console.debug('Puter bootstrap: attached window.puter', { ready: window.puterReady });
  } catch (e) {
    window.puterInitError = String(e ?? 'unknown');
    window.puterInitializedAt = Date.now();
    console.error('Puter bootstrap error', e);
  }
}

export default typeof window === 'undefined' ? undefined : window.puter;
