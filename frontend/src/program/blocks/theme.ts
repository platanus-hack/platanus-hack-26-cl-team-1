/** Dark Blockly theme matching app/theme.css (workspace #0b0f14, Inter). */
import * as Blockly from 'blockly';
import { CATEGORIES, blockStyle, categoryStyle, shade, type CategoryKey } from './palette';

export const THEME_NAME = 'circuito-vivo-dark';

let theme: Blockly.Theme | null = null;

function styleFor(k: CategoryKey): Blockly.Theme.BlockStyle {
  const c = CATEGORIES[k].colour;
  return { colourPrimary: c, colourSecondary: shade(c, 0.28), colourTertiary: shade(c, -0.28), hat: '' };
}

export function getTheme(): Blockly.Theme {
  if (theme) return theme;
  const blockStyles: Record<string, Blockly.Theme.BlockStyle> = {};
  const categoryStyles: Record<string, Blockly.Theme.CategoryStyle> = {};
  for (const k of Object.keys(CATEGORIES) as CategoryKey[]) {
    blockStyles[blockStyle(k)] = styleFor(k);
    categoryStyles[categoryStyle(k)] = { colour: CATEGORIES[k].colour };
  }
  // Styles referenced by Blockly's built-in blocks.
  blockStyles.logic_blocks = styleFor('logic');
  blockStyles.loop_blocks = styleFor('control');
  blockStyles.math_blocks = styleFor('math');
  blockStyles.text_blocks = styleFor('comm');
  blockStyles.variable_blocks = styleFor('variables');
  blockStyles.variable_dynamic_blocks = styleFor('variables');
  blockStyles.procedure_blocks = styleFor('functions');
  blockStyles.hat_blocks = { ...styleFor('events'), hat: 'cap' };

  theme = Blockly.Theme.defineTheme(THEME_NAME, {
    name: THEME_NAME,
    base: Blockly.Themes.Classic,
    blockStyles,
    categoryStyles,
    componentStyles: {
      workspaceBackgroundColour: '#0b0f14',
      toolboxBackgroundColour: '#131820',
      toolboxForegroundColour: '#e6edf3',
      flyoutBackgroundColour: '#181f28',
      flyoutForegroundColour: '#e6edf3',
      flyoutOpacity: 0.97,
      scrollbarColour: '#2f3a47',
      scrollbarOpacity: 0.7,
      insertionMarkerColour: '#e6edf3',
      insertionMarkerOpacity: 0.25,
      markerColour: '#3ddc97',
      cursorColour: '#3ddc97',
      selectedGlowColour: '#3ddc97',
      selectedGlowOpacity: 0.6,
    },
    fontStyle: { family: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", weight: '600', size: 11 },
    startHats: true,
  });
  return theme;
}
