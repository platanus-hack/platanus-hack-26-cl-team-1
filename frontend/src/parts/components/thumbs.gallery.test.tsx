/**
 * Visual QA for palette thumbnails (not a real test):
 *   THUMBS_OUT=/abs/dir npx vitest run src/parts/components/thumbs.gallery.test.tsx
 * writes <type>.svg drawn by PartThumbnail at 96 px.
 */
import { describe, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { findPartDef } from '@/catalog';
import { PartThumbnail } from '@/parts/PartThumbnail';
import { componentRenderers } from './index';

const out = process.env.THUMBS_OUT;

describe.runIf(Boolean(out))('component thumbnails', () => {
  it('writes SVGs', () => {
    mkdirSync(out!, { recursive: true });
    for (const type of Object.keys(componentRenderers)) {
      const def = findPartDef(type);
      if (!def) continue;
      const svg = renderToStaticMarkup(<PartThumbnail def={def} size={96} />).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
      writeFileSync(join(out!, `${type}.svg`), svg);
    }
  });
});
