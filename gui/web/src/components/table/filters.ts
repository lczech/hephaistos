// A column's filter: the chosen values, of the choices its list offers.

/** How a column filters, set in its definition's `meta`. */
export interface ColumnFilterLook {
  param: string; // what the filter is called outside the list: a View's parameter
  many?: string; // what several chosen are called, e.g. `kinds`; without it, only one can be
}

/** Something to filter by. Its own choices are within it: choosing it covers them all. */
export interface Choice {
  value: string;
  label: string;
  choices?: Choice[];
}

/** The chosen values after ticking or unticking a choice, maybe within another. */
export function toggled(values: string[], choice: Choice, within?: Choice): string[] {
  if (within !== undefined && values.includes(within.value)) {
    // Covered by the one it is within: all the others within it stay chosen instead.
    const others = (within.choices ?? []).filter((other) => other.value !== choice.value);
    return [
      ...values.filter((value) => value !== within.value),
      ...others.map((other) => other.value),
    ];
  }
  if (values.includes(choice.value)) return values.filter((value) => value !== choice.value);
  const covered = new Set((choice.choices ?? []).map((inner) => inner.value));
  return [...values.filter((value) => !covered.has(value)), choice.value];
}

function label(value: string, choices: Choice[]): string | undefined {
  for (const choice of choices) {
    if (choice.value === value) return choice.label;
    const inner = label(value, choice.choices ?? []);
    if (inner !== undefined) return inner;
  }
  return undefined;
}

/** What a filter is set to, in short: the one chosen, or how many, e.g. `3 kinds`. */
export function filterText(values: string[], choices: Choice[], many = "chosen"): string {
  const [only = ""] = values;
  return values.length === 1 ? (label(only, choices) ?? only) : `${values.length} ${many}`;
}
