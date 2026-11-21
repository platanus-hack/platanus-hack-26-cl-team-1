/**
 * Shared SVG <defs> (gradients, filters) mounted ONCE by the canvas and by
 * thumbnails. Renderers may reference these ids: url(#cv-glow) etc.
 * Art agents may ADD defs here (keep ids prefixed with `cv-`).
 */
export function SharedDefs() {
  return (
    <defs>
      <filter id="cv-glow" x="-200%" y="-200%" width="500%" height="500%">
        <feGaussianBlur stdDeviation="0.6" result="b" />
        <feMerge>
          <feMergeNode in="b" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="cv-shadow" x="-60%" y="-60%" width="220%" height="220%">
        <feDropShadow dx="0.15" dy="0.25" stdDeviation="0.25" floodColor="#000" floodOpacity="0.45" />
      </filter>
      <linearGradient id="cv-metal" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#e9edf1" />
        <stop offset="0.5" stopColor="#a7b0b9" />
        <stop offset="1" stopColor="#6f7882" />
      </linearGradient>
    </defs>
  );
}
