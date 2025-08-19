import { vectorscopeCanvas } from './elements.js';
import { rgbToYuv, clamp } from './color.js';
import { vsMarkers } from './state.js';

const vctx = vectorscopeCanvas.getContext('2d');
const vbufCanvas = document.createElement('canvas');
const vbufCtx = vbufCanvas.getContext('2d', { willReadFrequently: true });
[vctx, vbufCtx].forEach(c => c.imageSmoothingEnabled = false);

export function drawVectorscope(imageData, stride, intensity, gamut) {
  const w = vectorscopeCanvas.width;
  const h = vectorscopeCanvas.height;
  vctx.fillStyle = 'rgba(0,0,0,0.10)';
  vctx.fillRect(0, 0, w, h);

  const data = imageData.data;
  const cx = w / 2, cy = h / 2;
  const radius = Math.min(cx, cy) * 0.95;

  if (vbufCanvas.width !== w || vbufCanvas.height !== h) {
    vbufCanvas.width = w; vbufCanvas.height = h;
  }
  const out = vbufCtx.createImageData(w, h);
  const outData = out.data;
  for (let i = 3; i < outData.length; i += 4) outData[i] = 0;

  const vsIntensity = Math.max(0.2, Math.min(3, intensity));
  const incBase = Math.floor(16 * vsIntensity);
  const maxC = gamut === 'bt2020' ? 0.5 : 0.62;

  for (let y = 0; y < imageData.height; y += stride) {
    const rowOff = y * imageData.width * 4;
    for (let x = 0; x < imageData.width; x += stride) {
      const i = rowOff + x * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a === 0) continue;
      const { Y, U, V } = rgbToYuv(r, g, b, gamut);
      const px = (cx + (U / maxC) * radius) | 0;
      const py = (cy - (V / maxC) * radius) | 0;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = (py * w + px) * 4;
      const inten = clamp(Math.pow(0.25 + Y * 0.9, 0.9), 0.2, 1.2);
      const incR = (incBase * 0.10 * inten) | 0;
      const incG = (incBase * 0.78 * inten) | 0;
      const incB = (incBase * 1.00 * inten) | 0;
      outData[idx] = Math.min(255, outData[idx] + incR);
      outData[idx+1] = Math.min(255, outData[idx+1] + incG);
      outData[idx+2] = Math.min(255, outData[idx+2] + incB);
      outData[idx+3] = 255;
    }
  }
  vbufCtx.putImageData(out, 0, 0);
  vctx.globalCompositeOperation = 'source-over';
  vctx.drawImage(vbufCanvas, 0, 0);

  drawVectorscopeGraticule(vctx, w, h);
  drawVectorscopeMarkers(vctx, w, h);
}

export function drawVectorscopeGraticule(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.25;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(cx, cy) * 0.95;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r*0.75, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r*0.5, 0, Math.PI*2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();
  const targets = [
    { name: 'R', angle: 13.5 }, { name: 'Mg', angle: 73.5 }, { name: 'B', angle: 133.5 },
    { name: 'Cy', angle: 193.5 }, { name: 'G', angle: 253.5 }, { name: 'Ye', angle: 313.5 },
  ];
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px system-ui, Segoe UI, sans-serif';
  targets.forEach(t => {
    const ang = (t.angle - 90) * Math.PI / 180;
    const tr = r * 0.78; const x = cx + Math.cos(ang) * tr; const y = cy + Math.sin(ang) * tr;
    const s = 8; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.strokeRect(x - s/2, y - s/2, s, s);
    ctx.fillText(t.name, x + 6, y - 6);
  });
  ctx.restore();
}

export function drawVectorscopeMarkers(ctx, w, h) {
  if (!vsMarkers.length) return;
  const cx = w / 2, cy = h / 2; const rMax = Math.min(cx, cy) * 0.95;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,200,60,0.95)'; ctx.fillStyle = 'rgba(255,200,60,0.95)';
  ctx.lineWidth = 1; ctx.setLineDash([5,5]);
  vsMarkers.forEach(m => {
    const dx = m.x - cx, dy = m.y - cy; const angle = Math.atan2(dy, dx);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle)*rMax, cy + Math.sin(angle)*rMax); ctx.stroke();
    ctx.setLineDash([]); ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, Math.PI*2); ctx.fill();
    const angCW = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const pct = Math.min(100, Math.max(0, Math.hypot(dx, dy) / rMax * 100));
    ctx.fillStyle = 'rgba(255,200,60,0.95)'; ctx.font = '11px system-ui, Segoe UI, sans-serif';
    ctx.fillText(`${angCW.toFixed(1)}°  ${pct.toFixed(1)}%`, m.x + 6, m.y - 6);
    ctx.setLineDash([5,5]);
  });
  ctx.restore();
}
