// Real-time vectorscope and RGB parade for an HTML5 <video>
// Approach
// - Draw video frames to an offscreen canvas
// - Read pixel data (ImageData)
// - Build two visualizations:
//   1) Vectorscope: convert sRGB -> YUV (BT.601) and plot U vs V in polar space
//   2) RGB Parade: three vertical histograms representing R, G, B luminance per x position

const videoEl = document.getElementById('video');
const fileInput = document.getElementById('fileInput');
const vectorscopeCanvas = document.getElementById('vectorscope');
const rgbParadeCanvas = document.getElementById('rgbParade');
// Waveform controls
const wfDisplayEl = document.getElementById('wfDisplay'); // overlay|stack|parade
const wfGraticuleEl = document.getElementById('wfGraticule'); // none|digital|ire|mv
const wfIntensityEl = document.getElementById('wfIntensity');
const gamutEl = document.getElementById('colorGamut'); // bt601|bt709|bt2020
const transferEl = document.getElementById('transfer'); // sdr|pq|hlg
const wfMirrorEl = document.getElementById('wfMirror');
const wfEnvelopeEl = document.getElementById('wfEnvelope'); // none|instant
const downscaleEl = document.getElementById('downscale');
// FPS control removed; drive rendering at source FPS when possible
const pauseScopesEl = document.getElementById('pauseScopes');
const strideEl = document.getElementById('stride');
// Combined intensity control (affects both vectorscope and waveform)
const intensityEl = document.getElementById('wfIntensity');
// Marker controls
const wfAddHBtn = document.getElementById('wfAddH');
const clearMarkersBtn = document.getElementById('clearMarkers');
// Camera controls
const startCamBtn = document.getElementById('startCam');
// Stop button removed; we'll toggle camera with a single button
const stopCamBtn = null;
// Split/Max controls
const splitterEl = document.getElementById('splitter');
const scopesSplitterEl = document.getElementById('scopesSplitter');
const maxVideoBtn = document.getElementById('maxVideo');
const maxVSBtn = document.getElementById('maxVS');
const maxWFBtn = document.getElementById('maxWF');

const vctx = vectorscopeCanvas.getContext('2d');
const pctx = rgbParadeCanvas.getContext('2d');

// Offscreen buffer to sample frames
const sampleCanvas = document.createElement('canvas');
const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });

// Disable smoothing for faster pixel ops and crisper plots
vctx.imageSmoothingEnabled = false;
pctx.imageSmoothingEnabled = false;
sctx.imageSmoothingEnabled = false;

// Offscreen buffer for efficient vectorscope plotting
const vbufCanvas = document.createElement('canvas');
const vbufCtx = vbufCanvas.getContext('2d', { willReadFrequently: true });
vbufCtx.imageSmoothingEnabled = false;

let rafId = null;
let lastTick = 0;
let camStream = null;

// Marker state
/** @type {{x:number,y:number}[]} */
const vsMarkers = []; // exact canvas positions on vectorscope
/** @type {{y:number}[]} */
const wfHMarkers = []; // horizontal markers on waveform (0..h-1)

// Resize canvases to fill their panels (account for device pixel ratio)
function resizeCanvases() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const fit = (canvas) => {
    if (!canvas) return;
    // Measure the panel container to fill available space
    const panel = canvas.parentElement;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const cssW = Math.max(2, Math.floor(rect.width));
    const cssH = Math.max(2, Math.floor(rect.height - 22)); // leave room for caption
    const w = cssW * dpr;
    const h = cssH * dpr;
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  fit(vectorscopeCanvas);
  fit(rgbParadeCanvas);
}

fileInput?.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  stopCamera();
  const url = URL.createObjectURL(file);
  videoEl.src = url;
  videoEl.play();
});

function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }

// BT.601 full-range conversion from RGB (0..255) to YUV (Y 0..1 for visualization, U/V -0.5..0.5-ish)
// Source constants adapted from standard 601 matrix
function rgbToYuv(r, g, b, gamut) {
  const R = r / 255, G = g / 255, B = b / 255;
  // Choose matrix based on gamut (BT.601/709/2020 non-constant luminance, non-linear R'G'B')
  // Coefficients for Y' from ITU standards (approx)
  const coeffs = gamut === 'bt2020'
    ? { kr: 0.2627, kg: 0.6780, kb: 0.0593 }
    : gamut === 'bt709'
    ? { kr: 0.2126, kg: 0.7152, kb: 0.0722 }
    : { kr: 0.299,  kg: 0.587,  kb: 0.114 };
  const { kr, kg, kb } = coeffs;
  const Y = kr * R + kg * G + kb * B;
  // Y'CbCr-like mapping (Cb,Cr in -0.5..0.5 when normalized)
  const Cb = (B - Y) / (2 * (1 - kb));
  const Cr = (R - Y) / (2 * (1 - kr));
  const U = Cb;
  const V = Cr;
  return { Y, U, V };
}

function drawVectorscope(imageData) {
  const w = vectorscopeCanvas.width;
  const h = vectorscopeCanvas.height;

  // Fade previous frame for persistence
  vctx.fillStyle = 'rgba(0,0,0,0.10)';
  vctx.fillRect(0, 0, w, h);

  const data = imageData.data;
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(cx, cy) * 0.95; // inner padding

  // Prepare offscreen buffer
  if (vbufCanvas.width !== w || vbufCanvas.height !== h) {
    vbufCanvas.width = w;
    vbufCanvas.height = h;
  }
  const out = vbufCtx.createImageData(w, h);
  const outData = out.data;
  // alpha defaults to 0; ensure it's cleared
  for (let i = 3; i < outData.length; i += 4) outData[i] = 0;

  // Plot into buffer (additive-like by saturating RGB)
  const stride = parseInt(strideEl?.value || '1', 10);
  const vsIntensity = Math.max(0.2, Math.min(3, parseFloat(intensityEl?.value || '1.4')));
  const incBase = Math.floor(16 * vsIntensity); // base increment per hit, scaled by control
  for (let y = 0; y < imageData.height; y += stride) {
    const rowOff = y * imageData.width * 4;
    for (let x = 0; x < imageData.width; x += stride) {
      const i = rowOff + x * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a === 0) continue;
  const { Y, U, V } = rgbToYuv(r, g, b, gamutEl?.value || 'bt709');
  // Conservative chroma limit so 100% bars fit target boxes in SDR
  const maxC = (gamutEl?.value || 'bt709') === 'bt2020' ? 0.5 : 0.62;
  const px = (cx + (U / maxC) * radius) | 0;
      const py = (cy - (V / maxC) * radius) | 0;
      if (px < 0 || px >= w || py < 0 || py >= h) continue;
      const idx = (py * w + px) * 4;
  // cyan-ish weights with Y-based intensity and a gentle gamma to emphasize mid/high
  const inten = clamp(Math.pow(0.25 + Y * 0.9, 0.9), 0.2, 1.2);
      const incR = (incBase * 0.10 * inten) | 0;
      const incG = (incBase * 0.78 * inten) | 0;
      const incB = (incBase * 1.00 * inten) | 0;
      outData[idx]     = Math.min(255, outData[idx]     + incR);
      outData[idx + 1] = Math.min(255, outData[idx + 1] + incG);
      outData[idx + 2] = Math.min(255, outData[idx + 2] + incB);
      outData[idx + 3] = 255;
    }
  }

  // Composite the buffer additively for glow effect
  vbufCtx.putImageData(out, 0, 0);
  // Sharper: draw 1:1 without glow/composite
  vctx.globalCompositeOperation = 'source-over';
  vctx.drawImage(vbufCanvas, 0, 0);

  // Draw graticule on top
  drawVectorscopeGraticule(vctx, w, h);

  // Draw custom vectorscope markers
  drawVectorscopeMarkers(vctx, w, h);
}

function drawVectorscopeGraticule(ctx, w, h) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.25;
  const cx = w / 2, cy = h / 2;
  const r = Math.min(cx, cy) * 0.95;

  // Outer circle and inner rings
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.75, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshairs
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
  ctx.stroke();

  // 6 primary/secondary target boxes (approx angles for 601)
  const targets = [
    { name: 'R',   angle:  13.5 },
    { name: 'Mg',  angle:  73.5 },
    { name: 'B',   angle: 133.5 },
    { name: 'Cy',  angle: 193.5 },
    { name: 'G',   angle: 253.5 },
    { name: 'Ye',  angle: 313.5 },
  ];
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = '10px system-ui, Segoe UI, sans-serif';

  targets.forEach(t => {
    const ang = (t.angle - 90) * Math.PI / 180; // rotate so 0° is rightward
    const tr = r * 0.78; // 100% box radius
    const x = cx + Math.cos(ang) * tr;
    const y = cy + Math.sin(ang) * tr;
    // small square box
    const s = 8;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x - s / 2, y - s / 2, s, s);
    ctx.fillText(t.name, x + 6, y - 6);
  });
  ctx.restore();
}

function drawVectorscopeMarkers(ctx, w, h) {
  if (!vsMarkers.length) return;
  const cx = w / 2, cy = h / 2;
  const rMax = Math.min(cx, cy) * 0.95;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,200,60,0.95)'; // amber
  ctx.fillStyle = 'rgba(255,200,60,0.95)';
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  vsMarkers.forEach(m => {
    const dx = m.x - cx;
    const dy = m.y - cy;
    const angle = Math.atan2(dy, dx); // canvas radians
    // radial line through center to edge
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * rMax, cy + Math.sin(angle) * rMax);
    ctx.stroke();
    // small handle at exact clicked point
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    ctx.fill();
    // label: angle(clockwise from top) and % radius
    const angCW = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
    const pct = Math.min(100, Math.max(0, Math.hypot(dx, dy) / rMax * 100));
    ctx.fillStyle = 'rgba(255,200,60,0.95)';
    ctx.font = '11px system-ui, Segoe UI, sans-serif';
    const label = `${angCW.toFixed(1)}°  ${pct.toFixed(1)}%`;
    ctx.fillText(label, m.x + 6, m.y - 6);
    ctx.setLineDash([5,5]);
  });
  ctx.restore();
}

// FFmpeg waveform-inspired renderer
function drawWaveform(imageData) {
  const w = rgbParadeCanvas.width;
  const h = rgbParadeCanvas.height;
  const display = wfDisplayEl.value; // overlay|stack|parade
  const transfer = transferEl?.value || 'sdr';
  const mirror = wfMirrorEl.checked;
  // Combined intensity (0.2..3). Map to a plotting gain.
  const intensity = Math.max(0.2, Math.min(3, parseFloat(intensityEl?.value || wfIntensityEl.value || '1.4')));
  const envelope = wfEnvelopeEl.value; // none|instant
  const graticule = wfGraticuleEl.value; // none|digital|ire|mv

  // Clear completely each frame
  pctx.globalCompositeOperation = 'source-over';
  pctx.globalAlpha = 1.0;
  pctx.fillStyle = '#000';
  pctx.fillRect(0, 0, w, h);

  // (Background now drawn after waveform via destination-over)

  const data = imageData.data;
  const sampleW = imageData.width;
  const sampleH = imageData.height;
  const stride = parseInt(strideEl?.value || '1', 10);

  // Destination layout
  const sections = display === 'parade' ? 3 : 1;
  const sectionW = Math.floor(w / sections);
  const scaleX = sectionW / sampleW;
  const yScale = display === 'stack' ? (h / 3) : h;

  // Precompute column mapping to reduce Math.floor calls
  const effW = Math.ceil(sampleW / stride);
  const xMap = new Int16Array(effW);
  for (let i = 0, sx = 0; sx < sampleW; sx += stride, i++) xMap[i] = Math.floor(sx * scaleX);

  // Envelope tracking (instant): mark top/bottom per source x
  const env = envelope === 'instant'
    ? [0,1,2].map(() => ({ top: new Int16Array(effW).fill(32767), bot: new Int16Array(effW).fill(-32768) }))
    : null;

  // Create an output buffer and perform additive plotting per pixel (fast)
  const out = pctx.createImageData(w, h);
  const outData = out.data;
  // Ensure alpha starts at 0
  for (let i = 3; i < outData.length; i += 4) outData[i] = 0;

  // Color weights roughly matching previous RGBA colors
  const incBase = Math.max(1, Math.floor(12 + 12 * intensity)); // 14..48 roughly
  const weights = [
    // R channel color (255,80,80)
    [1.0, 0.314, 0.314],
    // G channel color (80,255,80)
    [0.314, 1.0, 0.314],
    // B channel color (80,160,255)
    [0.314, 0.627, 1.0],
  ];

  // Single pass over source pixels
  for (let sy = 0; sy < sampleH; sy += stride) {
    const rowOff = sy * sampleW * 4;
    for (let iMap = 0, sx = 0; sx < sampleW; sx += stride, iMap++) {
      const i = rowOff + sx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      // Precompute x positions per section
  const xLocal = xMap[iMap];

      // For each channel, compute y and plot
      // R
      {
        const yVal = toWaveY(r, transfer, yScale);
        const yOffset = display === 'stack' ? 0 : 0;
        const yCanvas = (display === 'stack' ? 0 : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 0 * sectionW : 0;
        const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx]     = Math.min(255, outData[idx]     + Math.floor(incBase * weights[0][0]));
        outData[idx + 1] = Math.min(255, outData[idx + 1] + Math.floor(incBase * weights[0][1]));
        outData[idx + 2] = Math.min(255, outData[idx + 2] + Math.floor(incBase * weights[0][2]));
  outData[idx + 3] = 255;
        if (env) {
          if (yVal < env[0].top[iMap]) env[0].top[iMap] = yVal;
          if (yVal > env[0].bot[iMap]) env[0].bot[iMap] = yVal;
        }
      }
      // G
      {
        const yVal = toWaveY(g, transfer, yScale);
        const yCanvas = (display === 'stack' ? Math.floor(h / 3) : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 1 * sectionW : 0;
        const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx]     = Math.min(255, outData[idx]     + Math.floor(incBase * weights[1][0]));
        outData[idx + 1] = Math.min(255, outData[idx + 1] + Math.floor(incBase * weights[1][1]));
        outData[idx + 2] = Math.min(255, outData[idx + 2] + Math.floor(incBase * weights[1][2]));
  outData[idx + 3] = 255;
        if (env) {
          if (yVal < env[1].top[iMap]) env[1].top[iMap] = yVal;
          if (yVal > env[1].bot[iMap]) env[1].bot[iMap] = yVal;
        }
      }
      // B
      {
        const yVal = toWaveY(b, transfer, yScale);
        const yCanvas = (display === 'stack' ? Math.floor(2 * h / 3) : 0) + (mirror ? yVal : (yScale - 1 - yVal));
        const baseX = display === 'parade' ? 2 * sectionW : 0;
        const xCanvas = baseX + xLocal;
        const idx = (yCanvas * w + xCanvas) * 4;
        outData[idx]     = Math.min(255, outData[idx]     + Math.floor(incBase * weights[2][0]));
        outData[idx + 1] = Math.min(255, outData[idx + 1] + Math.floor(incBase * weights[2][1]));
        outData[idx + 2] = Math.min(255, outData[idx + 2] + Math.floor(incBase * weights[2][2]));
  outData[idx + 3] = 255;
        if (env) {
          if (yVal < env[2].top[iMap]) env[2].top[iMap] = yVal;
          if (yVal > env[2].bot[iMap]) env[2].bot[iMap] = yVal;
        }
      }
    }
  }

  // Paint waveform pixels
  pctx.putImageData(out, 0, 0);

  // Draw parade background panels behind the waveform (destination-over)
  if (display === 'parade') {
    pctx.save();
    pctx.globalCompositeOperation = 'destination-over';
    const third = Math.floor(w / 3);
    pctx.globalAlpha = 0.18;
    pctx.fillStyle = 'rgb(60,0,0)';
    pctx.fillRect(0, 0, third, h);
    pctx.fillStyle = 'rgb(0,60,0)';
    pctx.fillRect(third, 0, third, h);
    pctx.fillStyle = 'rgb(0,0,80)';
    pctx.fillRect(2 * third, 0, w - 2 * third, h);
    // Fill any remaining transparent areas with black
    pctx.globalAlpha = 1.0;
    pctx.fillStyle = '#000';
    pctx.fillRect(0, 0, w, h);
    pctx.restore();
  }

  // Graticule lines per mode (drawn on top)
  drawWaveformGraticule(pctx, w, h, display, graticule, mirror);

  // Draw custom waveform markers on top
  drawWaveformMarkers(pctx, w, h);

  // Draw envelope if enabled (instant top/bottom lines) on top
  if (env) {
    pctx.globalCompositeOperation = 'source-over';
    pctx.globalAlpha = 0.9;
    pctx.strokeStyle = 'rgba(255,255,255,0.85)';
    pctx.lineWidth = 1;

  const sectionOffsetsX = [0, sectionW, 2 * sectionW];
  const sectionOffsetsY = [0, Math.floor(h / 3), Math.floor(2 * h / 3)];

    for (let k = 0; k < 3; k++) {
      const baseX = display === 'parade' ? sectionOffsetsX[k] : 0;
      const yOffset = display === 'stack' ? sectionOffsetsY[k] : 0;
      // top line
      pctx.beginPath();
      for (let iMap = 0; iMap < xMap.length; iMap++) {
        const xc = baseX + xMap[iMap];
        const yLocal = env[k].top[iMap];
        const yCanvas = yOffset + (mirror ? yLocal : (yScale - 1 - yLocal));
        if (iMap === 0) pctx.moveTo(xc, yCanvas); else pctx.lineTo(xc, yCanvas);
      }
      pctx.stroke();
      // bottom line
      pctx.beginPath();
      for (let iMap = 0; iMap < xMap.length; iMap++) {
        const xc = baseX + xMap[iMap];
        const yLocal = env[k].bot[iMap];
        const yCanvas = yOffset + (mirror ? yLocal : (yScale - 1 - yLocal));
        if (iMap === 0) pctx.moveTo(xc, yCanvas); else pctx.lineTo(xc, yCanvas);
      }
      pctx.stroke();
    }
  }

  pctx.globalCompositeOperation = 'source-over';
}

// Map 8-bit component to waveform vertical position respecting transfer function
function toWaveY(v8, transfer, yScale) {
  const n = v8 / 255;
  let lin;
  if (transfer === 'pq') {
    // ST 2084 EOTF (approx inverse to map code to relative display luminance 0..1)
    // Use a simplified OETF-like curve for visualization input
    const m1 = 2610 / 16384;
    const m2 = 2523 / 32;
    const c1 = 3424 / 4096;
    const c2 = 2413 / 128;
    const c3 = 2392 / 128;
    // Inverse EOTF (OETF) from normalized linear to code; we need the reverse, so approximate
    // For scope, a simple 2.4 gamma can approximate perceptual spread
    lin = Math.pow(n, 2.4);
  } else if (transfer === 'hlg') {
    // BT.2100 HLG OETF (camera curve), approximate inverse for display mapping
    const a = 0.17883277, b = 1 - 4 * a, c = 0.5 - a * Math.log(4 * a);
    lin = n <= 0.5 ? (n * n) / 3 : (Math.exp((n - c) / a) + b) / 12;
  } else {
    // SDR: keep linear code mapping for standard digital waveform
    lin = n;
  }
  const yVal = Math.floor(lin * (yScale - 1));
  return yVal;
}

function drawWaveformMarkers(ctx, w, h) {
  if (!wfHMarkers.length) return;
  ctx.save();
  ctx.lineWidth = 1;
  // Horizontal markers + labels
  ctx.strokeStyle = 'rgba(255,180,60,0.95)'; // orange
  ctx.setLineDash([6, 6]);
  wfHMarkers.forEach(m => {
    const y = clamp(Math.round(m.y), 0, h - 1);
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
    ctx.stroke();
    // label value: show 8-bit value or IRE if selected
    ctx.setLineDash([]);
    ctx.font = '11px system-ui, Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(255,200,60,0.95)';
    // Map back to 0..255 considering mirror false for label readability; use raw y
    const v8 = Math.round((h - 1 - y) / (h - 1) * 255);
    let label = `${v8}`;
    const transfer = transferEl?.value || 'sdr';
    if (transfer !== 'sdr') {
      // Display approximate nits for HDR modes assuming normalized 0..1 maps to 1000 nits for PQ and ~1000 for HLG
      const n = v8 / 255;
      const nits = Math.round((transfer === 'pq' ? Math.pow(n, 2.4) : n) * 1000);
      label = `${nits} nits`;
    } else if (wfGraticuleEl.value === 'ire') {
      const ire = ((v8 - 16) / (235 - 16)) * 100;
      label = `${Math.max(0, Math.min(100, ire)).toFixed(1)} IRE`;
    } else if (wfGraticuleEl.value === 'mv') {
      const mv = ((v8 - 16) / (235 - 16)) * 700;
      label = `${Math.max(0, Math.min(700, mv)).toFixed(0)} mV`;
    }
    ctx.fillText(label, 8, y - 6);
    ctx.setLineDash([6,6]);
  });
  ctx.restore();
}

function drawWaveformGraticule(ctx, w, h, display, mode, mirror) {
  if (mode === 'none') return;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1;

  // Horizontal reference lines for 8-bit digital/IRE/mV approximations
  /** @type {{v:number,label:string}[]} */
  const markers = [];
  if (mode === 'digital') {
    markers.push(
      { v: 16, label: '16' },
      { v: 128, label: '128' },
      { v: 235, label: '235' }
    );
  } else if (mode === 'ire') {
    // IRE is generally for SDR; treat as reference points
    markers.push(
      { v: 16, label: '0 IRE' },
      { v: 71, label: '25' },
      { v: 128, label: '50' },
      { v: 184, label: '75' },
      { v: 235, label: '100 IRE' }
    );
  } else if (mode === 'mv') {
    // mV reference for SDR composite-like scale
    markers.push(
      { v: 16, label: '0 mV' },
      { v: 71, label: '175' },
      { v: 128, label: '350' },
      { v: 184, label: '525' },
      { v: 235, label: '700 mV' }
    );
  }
  // Convert 0..255 to canvas y, honoring mirror
  const toY = v => {
    const y = Math.round((v / 255) * (h - 1));
    return mirror ? y : (h - 1 - y);
  };

  // Draw lines and labels
  ctx.font = '12px system-ui, Segoe UI, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  markers.forEach(m => {
    const y = toY(m.v);
    // line
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    // label at left
    const textY = Math.max(10, Math.min(h - 4, y - 2));
    ctx.fillText(m.label, 6, textY);
  });

  // Parade separators
  if (display === 'parade') {
    ctx.beginPath();
    ctx.moveTo(w / 3, 0); ctx.lineTo(w / 3, h);
    ctx.moveTo((2 * w) / 3, 0); ctx.lineTo((2 * w) / 3, h);
    ctx.stroke();
  }

  ctx.restore();
}

function processFrame() {
  if (pauseScopesEl.checked || videoEl.paused || videoEl.ended) return;

  const d = parseInt(downscaleEl.value, 10) || 4;
  const sw = Math.max(2, Math.floor((videoEl.videoWidth || 0) / d));
  const sh = Math.max(2, Math.floor((videoEl.videoHeight || 0) / d));
  if (sw <= 0 || sh <= 0) return;

  sampleCanvas.width = sw;
  sampleCanvas.height = sh;

  sctx.drawImage(videoEl, 0, 0, sw, sh);
  const frame = sctx.getImageData(0, 0, sw, sh);

  drawVectorscope(frame);
  drawWaveform(frame);
}

function tick() {
  // rAF fallback if requestVideoFrameCallback is not supported
  processFrame();
  rafId = requestAnimationFrame(tick);
}

// Prefer requestVideoFrameCallback to follow source FPS; fallback to rAF
const hasRVFC = typeof /** @type {any} */ (videoEl).requestVideoFrameCallback === 'function';
if (hasRVFC) {
  const v = /** @type {any} */ (videoEl);
  const onFrame = () => {
    if (!pauseScopesEl.checked && !videoEl.paused && !videoEl.ended) {
      processFrame();
    }
    v.requestVideoFrameCallback(onFrame);
  };
  videoEl.addEventListener('play', () => {
    v.requestVideoFrameCallback(onFrame);
  });
} else {
  videoEl.addEventListener('play', () => {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(tick);
  });
  videoEl.addEventListener('pause', () => cancelAnimationFrame(rafId));
  videoEl.addEventListener('ended', () => cancelAnimationFrame(rafId));
}

// Optional: load a sample video if drag-dropped
window.addEventListener('dragover', e => { e.preventDefault(); });
window.addEventListener('drop', e => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  stopCamera();
  const url = URL.createObjectURL(file);
  videoEl.src = url;
  videoEl.play();
});

// Camera integration
async function startCamera() {
  try {
    stopCamera();
    const constraints = { video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 60 } }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    camStream = stream;
    videoEl.srcObject = stream;
    await videoEl.play();
  startCamBtn.textContent = 'Stop Camera';
  } catch (err) {
    console.error('Camera error:', err);
    alert('Unable to access camera: ' + (err?.message || err));
  }
}

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  if (videoEl.srcObject) {
    videoEl.srcObject = null;
  }
  startCamBtn.textContent = 'Use Camera';
}

// Toggle camera with a single button
startCamBtn?.addEventListener('click', () => {
  if (camStream || videoEl.srcObject) {
    stopCamera();
  } else {
    startCamera();
  }
});

// Vectorscope markers: left click to add at exact point, right click to remove nearest
vectorscopeCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
vectorscopeCanvas.addEventListener('mousedown', (e) => {
  const rect = vectorscopeCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (vectorscopeCanvas.width / rect.width);
  const y = (e.clientY - rect.top) * (vectorscopeCanvas.height / rect.height);
  if (e.button === 2) {
    if (!vsMarkers.length) return;
    let bestI = -1, bestD = 1e9;
    for (let i = 0; i < vsMarkers.length; i++) {
      const m = vsMarkers[i];
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI >= 0) vsMarkers.splice(bestI, 1);
  } else if (e.button === 0) {
    vsMarkers.push({ x, y });
  }
});

wfAddHBtn?.addEventListener('click', () => {
  // Add a horizontal marker at current mouse Y is not available; prompt using a simple input
  const def = '128';
  const res = prompt('Add horizontal marker (0..' + (rgbParadeCanvas.height - 1) + '):', def);
  if (res == null) return;
  const y = Math.max(0, Math.min(rgbParadeCanvas.height - 1, parseInt(res, 10) || 0));
  wfHMarkers.push({ y });
});

// Waveform horizontal markers: left click to add/drag, right click to remove nearest
rgbParadeCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
rgbParadeCanvas.addEventListener('mousedown', (e) => {
  const rect = rgbParadeCanvas.getBoundingClientRect();
  const toY = (clientY) => (clientY - rect.top) * (rgbParadeCanvas.height / rect.height);
  const y0 = toY(e.clientY);
  if (e.button === 2) {
    if (!wfHMarkers.length) return;
    let bestI = -1, bestD = 1e9;
    wfHMarkers.forEach((m, i) => {
      const d = Math.abs(m.y - y0);
      if (d < bestD) { bestD = d; bestI = i; }
    });
    if (bestI >= 0) wfHMarkers.splice(bestI, 1);
    return;
  }
  // Left button: add if none close, else drag nearest
  let idx = -1, minD = 8;
  wfHMarkers.forEach((m, i) => {
    const d = Math.abs(m.y - y0);
    if (d < minD) { minD = d; idx = i; }
  });
  if (idx === -1) {
    wfHMarkers.push({ y: clamp(y0, 0, rgbParadeCanvas.height - 1) });
    idx = wfHMarkers.length - 1;
  }
  let dragging = true;
  const onMove = (ev) => {
    if (!dragging) return;
    wfHMarkers[idx].y = clamp(toY(ev.clientY), 0, rgbParadeCanvas.height - 1);
  };
  const onUp = () => {
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
});

clearMarkersBtn?.addEventListener('click', () => {
  vsMarkers.length = 0;
  wfHMarkers.length = 0;
});

// Splitter logic
if (splitterEl) {
  let dragging = false;
  splitterEl.addEventListener('mousedown', (e) => {
    dragging = true;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const main = document.querySelector('main');
    const rect = main.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    const left = Math.max(0.15, Math.min(0.85, rel));
    main.style.gridTemplateColumns = `${left * 100}% 8px ${100 - left * 100}%`;
  resizeCanvases();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
}

// Horizontal splitter logic inside scopes column
if (scopesSplitterEl) {
  let draggingH = false;
  scopesSplitterEl.addEventListener('mousedown', (e) => {
    draggingH = true;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!draggingH) return;
    const scopes = document.querySelector('.scopes');
    const rect = scopes.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;
    const top = Math.max(0.15, Math.min(0.85, rel));
    scopes.style.gridTemplateRows = `${top * 100}% 8px ${100 - top * 100}%`;
  resizeCanvases();
  });
  window.addEventListener('mouseup', () => { draggingH = false; });
}

// Maximize buttons
maxVideoBtn?.addEventListener('click', () => {
  const b = document.body;
  const on = b.classList.toggle('max-video');
  b.classList.remove('max-scopes');
  b.classList.remove('max-vs');
  b.classList.remove('max-wf');
  if (!on) {
    b.classList.remove('max-video');
  }
  setTimeout(resizeCanvases, 0);
});
maxVSBtn?.addEventListener('click', () => {
  const b = document.body;
  const on = b.classList.toggle('max-vs');
  b.classList.remove('max-wf');
  b.classList.remove('max-video');
  if (!on) {
    b.classList.remove('max-vs');
  }
  setTimeout(resizeCanvases, 0);
});
maxWFBtn?.addEventListener('click', () => {
  const b = document.body;
  const on = b.classList.toggle('max-wf');
  b.classList.remove('max-vs');
  b.classList.remove('max-video');
  if (!on) {
    b.classList.remove('max-wf');
  }
  setTimeout(resizeCanvases, 0);
});

// Window resize -> recalc canvas backing sizes
window.addEventListener('resize', () => {
  resizeCanvases();
});

// Initial resize on load
window.addEventListener('load', () => {
  resizeCanvases();
});
