import { videoEl, fileInput, downscaleEl, strideEl, wfIntensityEl, pauseScopesEl, wfAddHBtn, clearMarkersBtn, vectorscopeCanvas, rgbParadeCanvas, gamutEl, transferEl } from './elements.js';
import { sctx, sampleCanvas, vsMarkers, wfHMarkers } from './state.js';
import { drawVectorscope } from './vectorscope.js';
import { drawWaveform } from './waveform.js';
import { resizeCanvases } from './layout.js';
import { stopCamera } from './camera.js';

// Event wiring
fileInput?.addEventListener('change', () => {
  const file = fileInput.files?.[0]; if (!file) return; stopCamera();
  const url = URL.createObjectURL(file); videoEl.src = url; videoEl.play(); setTimeout(resizeCanvases, 0);
});

window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => { e.preventDefault(); const file = e.dataTransfer?.files?.[0]; if (!file) return; stopCamera(); const url = URL.createObjectURL(file); videoEl.src = url; videoEl.play(); setTimeout(resizeCanvases, 0); });

// Markers
wfAddHBtn?.addEventListener('click', () => { const res = prompt('Add horizontal marker (0..' + (rgbParadeCanvas.height - 1) + '):', '128'); if (res == null) return; const y = Math.max(0, Math.min(rgbParadeCanvas.height - 1, parseInt(res, 10) || 0)); wfHMarkers.push({ y }); });

vectorscopeCanvas.addEventListener('contextmenu', e => e.preventDefault());
vectorscopeCanvas.addEventListener('mousedown', e => { const rect = vectorscopeCanvas.getBoundingClientRect(); const x = (e.clientX - rect.left) * (vectorscopeCanvas.width / rect.width); const y = (e.clientY - rect.top) * (vectorscopeCanvas.height / rect.height); if (e.button === 2) { if (!vsMarkers.length) return; let bestI = -1, bestD = 1e9; for (let i = 0; i < vsMarkers.length; i++) { const m = vsMarkers[i]; const d = Math.hypot(m.x - x, m.y - y); if (d < bestD) { bestD = d; bestI = i; } } if (bestI >= 0) vsMarkers.splice(bestI, 1); } else if (e.button === 0) { vsMarkers.push({ x, y }); } });

rgbParadeCanvas.addEventListener('contextmenu', e => e.preventDefault());
rgbParadeCanvas.addEventListener('mousedown', e => { const rect = rgbParadeCanvas.getBoundingClientRect(); const toY = cY => (cY - rect.top) * (rgbParadeCanvas.height / rect.height); const y0 = toY(e.clientY); if (e.button === 2) { if (!wfHMarkers.length) return; let bestI = -1, bestD = 1e9; wfHMarkers.forEach((m, i) => { const d = Math.abs(m.y - y0); if (d < bestD) { bestD = d; bestI = i; } }); if (bestI >= 0) wfHMarkers.splice(bestI, 1); return; } let idx = -1, minD = 8; wfHMarkers.forEach((m, i) => { const d = Math.abs(m.y - y0); if (d < minD) { minD = d; idx = i; } }); if (idx === -1) { wfHMarkers.push({ y: Math.max(0, Math.min(rgbParadeCanvas.height - 1, y0)) }); idx = wfHMarkers.length - 1; } let dragging = true; const onMove = ev => { if (!dragging) return; wfHMarkers[idx].y = Math.max(0, Math.min(rgbParadeCanvas.height - 1, toY(ev.clientY))); }; const onUp = () => { dragging = false; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); }; window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp); });

clearMarkersBtn?.addEventListener('click', () => { vsMarkers.length = 0; wfHMarkers.length = 0; });

// Frame processing
function processFrame() {
  if (pauseScopesEl.checked || videoEl.paused || videoEl.ended) return;
  const d = parseInt(downscaleEl.value, 10) || 4; const sw = Math.max(2, Math.floor((videoEl.videoWidth || 0) / d)); const sh = Math.max(2, Math.floor((videoEl.videoHeight || 0) / d)); if (sw <= 0 || sh <= 0) return;
  sampleCanvas.width = sw; sampleCanvas.height = sh; sctx.drawImage(videoEl, 0, 0, sw, sh); const frame = sctx.getImageData(0, 0, sw, sh);
  const stride = parseInt(strideEl?.value || '1', 10); const intensity = Math.max(0.2, Math.min(3, parseFloat(wfIntensityEl?.value || '1.4')));
  drawVectorscope(frame, stride, intensity, (gamutEl?.value || 'bt709'));
  drawWaveform(frame, stride, intensity, (transferEl?.value || 'sdr'));
}

function tick() { processFrame(); rafId = requestAnimationFrame(tick); }
let rafId = null;

export function startRunner() {
  const hasRVFC = typeof videoEl.requestVideoFrameCallback === 'function';
  if (hasRVFC) {
    const onFrame = () => { if (!pauseScopesEl.checked && !videoEl.paused && !videoEl.ended) { processFrame(); } videoEl.requestVideoFrameCallback(onFrame); };
    videoEl.addEventListener('play', () => { videoEl.requestVideoFrameCallback(onFrame); setTimeout(resizeCanvases, 0); });
  } else {
    videoEl.addEventListener('play', () => { cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick); setTimeout(resizeCanvases, 0); });
    videoEl.addEventListener('pause', () => cancelAnimationFrame(rafId));
    videoEl.addEventListener('ended', () => cancelAnimationFrame(rafId));
  }
}
