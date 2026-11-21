import type { PartRenderer } from './types';
import { boardRenderers } from './boards';
import { componentRenderers } from './components';
import { FallbackRenderer } from './FallbackRenderer';

const registry: Record<string, PartRenderer> = { ...boardRenderers, ...componentRenderers };

export function getRenderer(type: string): PartRenderer {
  return registry[type] ?? FallbackRenderer;
}

export const hasRenderer = (type: string) => type in registry;
