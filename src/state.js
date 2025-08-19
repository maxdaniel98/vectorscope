// Shared state
export const vsMarkers = []; // {x,y}
export const wfHMarkers = []; // {y}

export const sampleCanvas = document.createElement('canvas');
export const sctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
