/**
 * Toolbox category rows styled by CSS: instead of Blockly's inline coloured
 * border/background, the category colour is exposed as the CSS variable
 * --sw-cat (dot + tinted selection in SoftwareView.css).
 */
import * as Blockly from 'blockly';

class CvToolboxCategory extends Blockly.ToolboxCategory {
  protected override addColourBorder_(colour: string): void {
    this.rowDiv_?.style.setProperty('--sw-cat', colour || 'var(--text-dim)');
  }

  override setSelected(isSelected: boolean): void {
    super.setSelected(isSelected);
    if (this.rowDiv_) this.rowDiv_.style.backgroundColor = '';
  }
}

let registered = false;

export function registerToolboxCategory(): void {
  if (registered) return;
  registered = true;
  Blockly.registry.register(Blockly.registry.Type.TOOLBOX_ITEM, Blockly.ToolboxCategory.registrationName, CvToolboxCategory, true);
}
