# HTML5 Vectorscope & RGB Parade

A minimal, self-contained web app that visualizes a playing video on a vectorscope and RGB parade using Canvas2D.

## Features

## How to run
Just open `index.html` in a modern browser (Chrome, Edge, Firefox). No build steps.

If your browser restricts file URLs, you can serve the folder locally:

	 - Downscale: reduces the sampled resolution for faster processing.
	 - Stride: skips pixels horizontally and vertically to reduce per-frame work (higher = faster, lower detail).
# From the project folder
python -m http.server 8080
# then open http://localhost:8080/
```

## Notes
- The vectorscope uses a conservative chroma radius to approximate 100% bars. Exact SDI alignment varies by transfer characteristics; Rec.601 was chosen for simplicity.
- Parade uses per-column average; you can switch to max or RMS if preferred.
- Performance: increase the downscale factor if frames drop.

 - Performance tips: increase Downscale and/or Stride to reduce CPU usage; turn off Envelope; set Display to Overlay; lower FPS.
- Performance: increase the downscale factor if frames drop.
