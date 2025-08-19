import { vectorscopeCanvas, rgbParadeCanvas, splitterEl, scopesSplitterEl, maxVideoBtn, maxVSBtn, maxWFBtn } from './elements.js';

export function resizeCanvases() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const fit = (canvas) => {
    const panel = canvas.parentElement; if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const cssW = Math.max(2, Math.floor(rect.width));
    const cssH = Math.max(2, Math.floor(rect.height - 22));
    const w = cssW * dpr, h = cssH * dpr;
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w; canvas.height = h;
    }
  };
  fit(vectorscopeCanvas); fit(rgbParadeCanvas);
}

export function wireSplitters() {
  if (splitterEl) {
    let dragging = false;
    splitterEl.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); });
    window.addEventListener('mousemove', e => {
      if (!dragging) return; const main = document.querySelector('main'); const rect = main.getBoundingClientRect();
      const rel = (e.clientX - rect.left) / rect.width; const left = Math.max(0.15, Math.min(0.85, rel));
      main.style.gridTemplateColumns = `${left * 100}% 8px ${100 - left * 100}%`; resizeCanvases();
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }
  if (scopesSplitterEl) {
    let draggingH = false;
    scopesSplitterEl.addEventListener('mousedown', e => { draggingH = true; e.preventDefault(); });
    window.addEventListener('mousemove', e => {
      if (!draggingH) return; const scopes = document.querySelector('.scopes'); const rect = scopes.getBoundingClientRect();
      const rel = (e.clientY - rect.top) / rect.height; const top = Math.max(0.15, Math.min(0.85, rel));
      scopes.style.gridTemplateRows = `${top * 100}% 8px ${100 - top * 100}%`; resizeCanvases();
    });
    window.addEventListener('mouseup', () => { draggingH = false; });
  }
}

export function wireMaximize() {
  maxVideoBtn?.addEventListener('click', () => {
    const b = document.body; const on = b.classList.toggle('max-video');
    b.classList.remove('max-scopes'); b.classList.remove('max-vs'); b.classList.remove('max-wf');
    if (!on) b.classList.remove('max-video'); setTimeout(resizeCanvases, 0);
  });
  maxVSBtn?.addEventListener('click', () => {
    const b = document.body; const on = b.classList.toggle('max-vs');
    b.classList.remove('max-wf'); b.classList.remove('max-video'); if (!on) b.classList.remove('max-vs'); setTimeout(resizeCanvases, 0);
  });
  maxWFBtn?.addEventListener('click', () => {
    const b = document.body; const on = b.classList.toggle('max-wf');
    b.classList.remove('max-vs'); b.classList.remove('max-video'); if (!on) b.classList.remove('max-wf'); setTimeout(resizeCanvases, 0);
  });
}

export function initResizes() {
  window.addEventListener('resize', resizeCanvases);
  window.addEventListener('load', resizeCanvases);
}
