import { wireCamera } from './camera.js';
import { wireSplitters, wireMaximize, initResizes } from './layout.js';
import { startRunner } from './runner.js';

// Entry point: wire UI and start frame processing
wireCamera();
wireSplitters();
wireMaximize();
initResizes();
startRunner();
