/**
 * Dynamic toolbox categories that need the live workspace:
 *  - CV_VARIABLE: Blockly's variables flyout, with a number shadow on
 *    "dar a … el valor" so a new block is never half-empty.
 *  - CV_PROCEDURE: functions without parameters or return values (the only
 *    kind the IR supports) + one call block per existing function.
 */
import * as Blockly from 'blockly';
import { BI } from './kinds';
import { PROCEDURE_CATEGORY, VARIABLE_CATEGORY } from './toolbox';

function procedureFlyout(ws: Blockly.WorkspaceSvg): Blockly.utils.toolbox.FlyoutDefinition {
  const items: Blockly.utils.toolbox.FlyoutItemInfoArray = [
    // 'web-class' is read by Blockly's FlyoutButton but missing from its typings.
    { kind: 'label', text: 'Agrupa bloques con un nombre y úsalos donde quieras.', 'web-class': 'sw-flyout-label' } as unknown as Blockly.utils.toolbox.FlyoutItemInfo,
    { kind: 'block', type: BI.procDef, fields: { NAME: Blockly.Msg.PROCEDURES_DEFNORETURN_PROCEDURE || 'hacer algo' } },
  ];
  const [noReturn] = Blockly.Procedures.allProcedures(ws);
  const names = noReturn.map((p) => p[0]).sort((a, b) => a.localeCompare(b, 'es'));
  if (names.length) items.push({ kind: 'sep', gap: 24 });
  for (const name of names) items.push({ kind: 'block', type: BI.procCall, extraState: { name } });
  return items;
}

function variableFlyout(ws: Blockly.WorkspaceSvg): Blockly.utils.toolbox.FlyoutDefinition {
  return Blockly.Variables.flyoutCategory(ws).map((item) => {
    const block = item as Blockly.utils.toolbox.BlockInfo;
    if (block.kind !== 'block' || block.type !== BI.varSet) return item;
    return { ...block, inputs: { VALUE: { shadow: { type: BI.number, fields: { NUM: 0 } } } } } as Blockly.utils.toolbox.FlyoutItemInfo;
  });
}

export function registerToolboxCallbacks(ws: Blockly.WorkspaceSvg): void {
  ws.registerToolboxCategoryCallback(PROCEDURE_CATEGORY, procedureFlyout);
  ws.registerToolboxCategoryCallback(VARIABLE_CATEGORY, variableFlyout);
  ws.registerButtonCallback('CREATE_VARIABLE', (button) => Blockly.Variables.createVariableButtonHandler(button.getTargetWorkspace()));
}
