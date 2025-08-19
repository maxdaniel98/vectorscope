import { rgbParadeCanvas, wfDisplayEl, wfGraticuleEl, wfMirrorEl } from './elements.js';
import { toWaveY, clamp } from './color.js';
import { wfHMarkers } from './state.js';

const pctx = rgbParadeCanvas.getContext('2d');
pctx.imageSmoothingEnabled = false;

export function drawWaveform(imageData, stride, intensity, transfer) {
  const w = rgbParadeCanvas.width, h = rgbParadeCanvas.height;
  const display = wfDisplayEl.value;
  const mirror = wfMirrorEl.checked;
  const graticule = wfGraticuleEl.value;

  pctx.globalCompositeOperation = 'source-over';
  pctx.globalAlpha = 1.0; pctx.fillStyle = '#000'; pctx.fillRect(0,0,w,h);

  const data = imageData.data; const sampleW = imageData.width; const sampleH = imageData.height;
  const sections = display === 'parade' ? 3 : 1; const sectionW = Math.floor(w / sections);
  const yScale = display === 'stack' ? (h / 3) : h;

  const effW = Math.ceil(sampleW / stride);
  const xMap = new Int16Array(effW);
  for (let i = 0, sx = 0; sx < sampleW; sx += stride, i++) xMap[i] = Math.floor((sx * sectionW) / sampleW);

  const out = pctx.createImageData(w, h);
  const outData = out.data; for (let i = 3; i < outData.length; i += 4) outData[i] = 0;

  const incBase = Math.max(1, Math.floor(12 + 12 * intensity));
  const weights = [ [1.0, 0.314, 0.314], [0.314, 1.0, 0.314], [0.314, 0.627, 1.0] ];

  for (let sy = 0; sy < sampleH; sy += stride) {
    const rowOff = sy * sampleW * 4;
    for (let iMap = 0, sx = 0; sx < sampleW; sx += stride, iMap++) {
      const i = rowOff + sx * 4; const r = data[i], g = data[i+1], b = data[i+2];
      const xLocal = xMap[iMap];
      // R
      {
        const yVal = toWaveY(r, transfer, yScale);
        const yCanvas = (display === 'stack' ? 0 : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 0 * sectionW : 0; const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx] = Math.min(255, outData[idx] + Math.floor(incBase * weights[0][0]));
        outData[idx+1] = Math.min(255, outData[idx+1] + Math.floor(incBase * weights[0][1]));
        outData[idx+2] = Math.min(255, outData[idx+2] + Math.floor(incBase * weights[0][2]));
        outData[idx+3] = 255;
      }
      // G
      {
        const yVal = toWaveY(g, transfer, yScale);
        const yCanvas = (display === 'stack' ? Math.floor(h/3) : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 1 * sectionW : 0; const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx] = Math.min(255, outData[idx] + Math.floor(incBase * weights[1][0]));
        outData[idx+1] = Math.min(255, outData[idx+1] + Math.floor(incBase * weights[1][1]));
        outData[idx+2] = Math.min(255, outData[idx+2] + Math.floor(incBase * weights[1][2]));
        outData[idx+3] = 255;
      }
      // B
      {
        const yVal = toWaveY(b, transfer, yScale);
        const yCanvas = (display === 'stack' ? Math.floor(2*h/3) : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 2 * sectionW : 0; const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx] = Math.min(255, outData[idx] + Math.floor(incBase * weights[2][0]));
        outData[idx+1] = Math.min(255, outData[idx+1] + Math.floor(incBase * weights[2][1]));
        outData[idx+2] = Math.min(255, outData[idx+2] + Math.floor(incBase * weights[2][2]));
        outData[idx+3] = 255;
      }
    }
  }

  pctx.putImageData(out, 0, 0);
  drawWaveformGraticule(pctx, w, h, display, graticule, mirror);
  drawWaveformMarkers(pctx, w, h);
}

export function drawWaveformGraticule(ctx, w, h, display, mode, mirror) {
  if (mode === 'none') return;
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
  const markers = [];
  if (mode === 'digital') {
    markers.push({ v: 16, label: '16' }, { v: 128, label: '128' }, { v: 235, label: '235' });
  } else if (mode === 'ire') {
    markers.push({ v: 16, label: '0 IRE' }, { v: 71, label: '25' }, { v: 128, label: '50' }, { v: 184, label: '75' }, { v: 235, label: '100 IRE' });
  } else if (mode === 'mv') {
    markers.push({ v: 16, label: '0 mV' }, { v: 71, label: '175' }, { v: 128, label: '350' }, { v: 184, label: '525' }, { v: 235, label: '700 mV' });
  }
  const toY = v => { const y = Math.round((v / 255) * (h - 1)); return mirror ? y : (h - 1 - y); };
  ctx.font = '12px system-ui, Segoe UI, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
  markers.forEach(m => { const y = toY(m.v); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); const textY = Math.max(10, Math.min(h - 4, y - 2)); ctx.fillText(m.label, 6, textY); });
  if (display === 'parade') { ctx.beginPath(); ctx.moveTo(w/3,0); ctx.lineTo(w/3,h); ctx.moveTo((2*w)/3,0); ctx.lineTo((2*w)/3,h); ctx.stroke(); }
  ctx.restore();
}

export function drawWaveformMarkers(ctx, w, h) {
  if (!wfHMarkers.length) return; ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,180,60,0.95)'; ctx.setLineDash([6,6]);
  wfHMarkers.forEach(m => {
    const y = clamp(Math.round(m.y), 0, h - 1); ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
    ctx.setLineDash([]); ctx.font = '11px system-ui, Segoe UI, sans-serif'; ctx.fillStyle = 'rgba(255,200,60,0.95)';
    const v8 = Math.round((h - 1 - y) / (h - 1) * 255);
    ctx.fillText(`${v8}`, 8, y - 6);
    ctx.setLineDash([6,6]);
  });
  ctx.restore();
}
