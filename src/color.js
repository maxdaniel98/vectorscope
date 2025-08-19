// Color math and transfer functions
export function rgbToYuv(r, g, b, gamut = 'bt709') {
  const R = r / 255, G = g / 255, B = b / 255;
  const coeffs = gamut === 'bt2020'
    ? { kr: 0.2627, kg: 0.6780, kb: 0.0593 }
    : gamut === 'bt709'
    ? { kr: 0.2126, kg: 0.7152, kb: 0.0722 }
    : { kr: 0.299,  kg: 0.587,  kb: 0.114 };
  const { kr, kg, kb } = coeffs;
  const Y = kr * R + kg * G + kb * B;
  const Cb = (B - Y) / (2 * (1 - kb));
  const Cr = (R - Y) / (2 * (1 - kr));
  return { Y, U: Cb, V: Cr };
}

export function toWaveY(v8, transfer, yScale) {
  const n = v8 / 255;
  let lin;
  if (transfer === 'pq') {
    lin = Math.pow(n, 2.4);
  } else if (transfer === 'hlg') {
    const a = 0.17883277, b = 1 - 4 * a, c = 0.5 - a * Math.log(4 * a);
    lin = n <= 0.5 ? (n * n) / 3 : (Math.exp((n - c) / a) + b) / 12;
  } else {
    lin = n;
  }
  return Math.floor(lin * (yScale - 1));
}

export function clamp(v, min, max) { return v < min ? min : v > max ? max : v; }
