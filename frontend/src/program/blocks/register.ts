/**
 * registerBlocks(): Spanish locale, custom fields, block definitions,
 * built-in overrides, connection checker, theme and serializers. Idempotent.
 */
import * as Blockly from 'blockly';
import * as Es from 'blockly/msg/es';
import { builtinOverrideDefs, customBlockDefs } from './defs';
import { registerFields } from './fields';
import { registerChecker } from './checker';
import { registerVarMetaSerializer } from './varMeta';
import { getTheme } from './theme';
import { blockStyle } from './palette';
import { RGB_PRESETS, BI } from './kinds';

let registered = false;

const MESSAGES: Record<string, string> = {
  CONTROLS_IF_MSG_ELSE: 'si no',
  CONTROLS_IF_MSG_ELSEIF: 'si no, si',
  CONTROLS_IF_MSG_IF: 'si',
  CONTROLS_IF_MSG_THEN: '',
  CONTROLS_REPEAT_TITLE: 'repetir %1 veces',
  CONTROLS_REPEAT_INPUT_DO: '',
  CONTROLS_WHILEUNTIL_INPUT_DO: '',
  CONTROLS_FOR_INPUT_DO: '',
  CONTROLS_WHILEUNTIL_OPERATOR_WHILE: 'repetir mientras',
  CONTROLS_WHILEUNTIL_OPERATOR_UNTIL: 'repetir hasta que',
  CONTROLS_FOR_TITLE: 'contar con %1 desde %2 hasta %3 de a %4',
  CONTROLS_FLOW_STATEMENTS_OPERATOR_BREAK: 'salir del bucle',
  CONTROLS_FLOW_STATEMENTS_OPERATOR_CONTINUE: 'continuar con la siguiente vuelta',
  CONTROLS_FLOW_STATEMENTS_WARNING: 'Este bloque solo funciona dentro de un bucle (repetir, mientras, contar).',
  MATH_CHANGE_TITLE: 'sumar %2 a %1',
  MATH_RANDOM_INT_TITLE: 'número al azar entre %1 y %2',
  VARIABLES_SET: 'dar a %1 el valor %2',
  NEW_VARIABLE: 'Crear variable…',
  NEW_VARIABLE_TITLE: 'Nombre de la nueva variable:',
  RENAME_VARIABLE: 'Renombrar variable…',
  PROCEDURES_DEFNORETURN_TITLE: 'función',
  PROCEDURES_DEFNORETURN_PROCEDURE: 'hacer algo',
  PROCEDURES_DEFNORETURN_TOOLTIP: 'Agrupa bloques con un nombre para usarlos varias veces.',
  PROCEDURES_DEFNORETURN_COMMENT: '',
};

/** Wrap the init of an existing block definition (once). */
function patchInit(type: string, after: (block: Blockly.Block) => void): void {
  const def = Blockly.Blocks[type] as { init?: () => void; __cvPatched?: boolean } | undefined;
  if (!def || def.__cvPatched || typeof def.init !== 'function') return;
  const original = def.init;
  def.init = function (this: Blockly.Block) {
    original.call(this);
    after(this);
  };
  def.__cvPatched = true;
}

function applyPreset(block: Blockly.Block, presetId: string): void {
  const preset = RGB_PRESETS.find((p) => p.id === presetId);
  if (!preset) return;
  (['R', 'G', 'B'] as const).forEach((name, i) => {
    const child = block.getInputTargetBlock(name);
    if (child && child.type === BI.number) child.setFieldValue(String(preset.rgb[i]), 'NUM');
  });
}

function registerExtensions(): void {
  if (!Blockly.Extensions.isRegistered('cv_hat')) {
    Blockly.Extensions.register('cv_hat', function (this: Blockly.Block) {
      this.setDeletable(false);
    });
  }
  if (!Blockly.Extensions.isRegistered('cv_rgb_preset')) {
    Blockly.Extensions.register('cv_rgb_preset', function (this: Blockly.Block) {
      const field = this.getField('PRESET');
      if (!field) return;
      field.setValidator((value: string) => {
        applyPreset(this, value);
        return value;
      });
      // Editing a number by hand turns the preset into "personalizado".
      this.setOnChange((e: Blockly.Events.Abstract) => {
        if (this.isInFlyout || e.isUiEvent || e.type !== Blockly.Events.BLOCK_CHANGE) return;
        const preset = RGB_PRESETS.find((p) => p.id === this.getFieldValue('PRESET'));
        if (!preset) return;
        const matches = (['R', 'G', 'B'] as const).every((name, i) => {
          const child = this.getInputTargetBlock(name);
          return !child || (child.type === BI.number && Number(child.getFieldValue('NUM')) === preset.rgb[i]);
        });
        if (!matches) this.getField('PRESET')?.setValue('custom');
      });
    });
  }
}

export function registerBlocks(): void {
  if (registered) return;
  registered = true;

  Blockly.setLocale(Es as unknown as Record<string, string>);
  for (const [k, v] of Object.entries(MESSAGES)) Blockly.Msg[k] = v;

  registerFields();
  registerChecker();
  registerVarMetaSerializer();
  registerExtensions();

  const overrides = builtinOverrideDefs();
  for (const d of overrides) delete Blockly.Blocks[d.type as string];
  Blockly.common.defineBlocksWithJsonArray(overrides);

  const custom = customBlockDefs().filter((d) => !Blockly.Blocks[d.type as string]);
  Blockly.common.defineBlocksWithJsonArray(custom);

  // "si" belongs to Control (orange) instead of Blockly's logic colour.
  const control = blockStyle('control');
  for (const t of ['controls_if', 'controls_if_if', 'controls_if_elseif', 'controls_if_else']) {
    patchInit(t, (b) => b.setStyle(control));
  }
  // Functions without parameters: drop the parameters mutator.
  patchInit(BI.procDef, (b) => {
    b.removeIcon(Blockly.icons.MutatorIcon.TYPE);
  });

  getTheme();
}
