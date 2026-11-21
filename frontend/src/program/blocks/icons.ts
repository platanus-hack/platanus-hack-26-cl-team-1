/** Tiny inline SVG icons (data URIs) used inside blocks and dropdown menus. */

const uri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

const stroke = (paths: string, color = '#ffffff') =>
  uri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`,
  );

export const ICONS = {
  play: stroke('<polygon points="7 4 20 12 7 20 7 4" fill="#ffffff"/>'),
  repeat: stroke('<path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>'),
  bulb: stroke('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'),
  pin: stroke('<rect x="7" y="3" width="10" height="7" rx="1.5"/><path d="M12 10v11"/>'),
  note: stroke('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
  input: stroke('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="#ffffff"/>'),
  motion: stroke('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  chip: stroke('<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>'),
  terminal: stroke('<path d="M4 17l6-5-6-5"/><path d="M12 19h8"/>'),
  clock: stroke('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};

/** Coloured swatch used by the RGB preset dropdown. */
export function swatch(rgb: [number, number, number] | null): string {
  if (!rgb) {
    return uri(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c6c"/><stop offset="0.5" stop-color="#3ddc97"/><stop offset="1" stop-color="#4cc2ff"/></linearGradient></defs><circle cx="10" cy="10" r="8" fill="url(#g)" stroke="#ffffff" stroke-width="1.5"/></svg>`,
    );
  }
  const [r, g, b] = rgb;
  const off = r === 0 && g === 0 && b === 0;
  return uri(
    `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="rgb(${r},${g},${b})" stroke="${off ? '#9aa7b4' : '#ffffff'}" stroke-width="1.5"/></svg>`,
  );
}
