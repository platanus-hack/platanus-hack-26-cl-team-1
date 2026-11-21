/**
 * Dynamic dropdown fields for part and pin references.
 *  - Options are regenerated from the live project every time the menu opens.
 *  - ANY string value is accepted (so loading a workspace never rewrites a
 *    reference to a part/pin that does not exist right now); the current value
 *    is always listed, as "(falta) led2" when missing.
 */
import * as Blockly from 'blockly';
import { liveContext } from './live';
import { partOptions, pinOptions, type Option } from './options';
import { PART_KINDS, type PartKind, type PinFilter } from './kinds';

type OptionsFn = (current: string | null) => Option[];

export class FieldDynamicDropdown extends Blockly.FieldDropdown {
  /** Value being applied right now (doValueUpdate_ runs before value_ changes). */
  private pending: string | null = null;

  constructor(optionsFn: OptionsFn) {
    super(function (this: Blockly.FieldDropdown) {
      const self = this as FieldDynamicDropdown;
      const current = self.pending ?? (self.getValue() as string | null);
      return optionsFn(current);
    });
  }

  protected override doClassValidation_(newValue?: string): string | null {
    return typeof newValue === 'string' ? newValue : null;
  }

  protected override doValueUpdate_(newValue: string): void {
    this.pending = newValue;
    try {
      this.getOptions(false); // regenerate so the new value is part of the list
    } finally {
      this.pending = null;
    }
    super.doValueUpdate_(newValue);
  }

  /** Re-read the options (part renamed, board changed…) and re-render the text. */
  refreshOptions(): void {
    const v = this.getValue();
    if (v === null) return;
    this.doValueUpdate_(v);
    this.forceRerender();
  }
}

export class FieldPartDropdown extends FieldDynamicDropdown {
  readonly partKind: PartKind;

  constructor(kind: PartKind) {
    super((current) => partOptions(liveContext(), kind, current));
    this.partKind = kind;
  }

  static override fromJson(options: Blockly.FieldDropdownFromJsonConfig & { partKind?: string }): FieldPartDropdown {
    const kind = (PART_KINDS as readonly string[]).includes(options.partKind ?? '') ? (options.partKind as PartKind) : 'led';
    return new FieldPartDropdown(kind);
  }
}

export class FieldPinDropdown extends FieldDynamicDropdown {
  readonly pinFilter: PinFilter;

  constructor(filter: PinFilter) {
    super((current) => pinOptions(liveContext()?.board ?? null, filter, current));
    this.pinFilter = filter;
  }

  static override fromJson(options: Blockly.FieldDropdownFromJsonConfig & { pinFilter?: string }): FieldPinDropdown {
    const f = options.pinFilter;
    return new FieldPinDropdown(f === 'pwm' || f === 'analog' ? f : 'digital');
  }
}

export const PART_FIELD = 'field_cv_part';
export const PIN_FIELD = 'field_cv_pin';

export function registerFields(): void {
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, PART_FIELD)) {
    Blockly.fieldRegistry.register(PART_FIELD, FieldPartDropdown);
  }
  if (!Blockly.registry.hasItem(Blockly.registry.Type.FIELD, PIN_FIELD)) {
    Blockly.fieldRegistry.register(PIN_FIELD, FieldPinDropdown);
  }
}

/** Refresh every dynamic dropdown of a workspace (after parts/board changes). */
export function refreshDynamicFields(ws: Blockly.Workspace): void {
  for (const block of ws.getAllBlocks(false)) {
    for (const input of block.inputList) {
      for (const field of input.fieldRow) {
        if (field instanceof FieldDynamicDropdown) field.refreshOptions();
      }
    }
  }
}
