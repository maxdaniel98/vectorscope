import { startCamBtn, videoEl } from './elements.js';

let camStream = null;

export async function startCamera() {
  try {
    stopCamera();
    const constraints = { video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 60 } }, audio: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    camStream = stream; videoEl.srcObject = stream; await videoEl.play();
    startCamBtn.textContent = 'Stop Camera';
  } catch (err) {
    console.error('Camera error:', err);
    alert('Unable to access camera: ' + (err?.message || err));
  }
}

export function stopCamera() {
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
  if (videoEl.srcObject) { videoEl.srcObject = null; }
  startCamBtn.textContent = 'Use Camera';
}

export function wireCamera() {
  startCamBtn?.addEventListener('click', () => {
    if (camStream || videoEl.srcObject) stopCamera(); else startCamera();
  });
}
