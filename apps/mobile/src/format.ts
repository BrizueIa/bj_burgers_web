export const numberValue = (value: unknown) => Number(value ?? 0) || 0;
export const money = (cents: unknown) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(
    numberValue(cents) / 100,
  );
export const quantity = (value: unknown) =>
  new Intl.NumberFormat('es-MX', { maximumFractionDigits: 3 }).format(numberValue(value));
export const statusLabel = (status: string) =>
  ({
    new: 'Nueva',
    preparing: 'En preparación',
    ready: 'Lista',
    out_for_delivery: 'En camino',
    delivered: 'Entregada',
    cancelled: 'Cancelada',
  })[status] ?? status;
function amountFromInput(value: string): number | undefined {
  const compact = value
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/\s/g, '');
  const match = compact.match(/^(-?)(.*)$/);
  if (!match || !match[2] || !/^[0-9.,]+$/.test(match[2])) return undefined;
  let normalized = match[2];
  const comma = normalized.lastIndexOf(',');
  const dot = normalized.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = Math.max(comma, dot);
    const decimalSeparator = normalized[decimal]!;
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = normalized.split(thousandsSeparator).join('').replace(decimalSeparator, '.');
  } else {
    const separator = comma >= 0 ? ',' : dot >= 0 ? '.' : undefined;
    if (separator) {
      const pieces = normalized.split(separator);
      const final = pieces.at(-1)!;
      const intermediateGroups = pieces.slice(1, -1);
      const groupedThousands =
        final.length === 3 && intermediateGroups.every((part) => part.length === 3);
      if (groupedThousands) {
        normalized = pieces.join('');
      } else if (pieces.length > 2) {
        return undefined;
      } else if (separator === ',') {
        normalized = normalized.replace(',', '.');
      }
    }
  }
  if (normalized.startsWith('.')) normalized = `0${normalized}`;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
  const parsed = Number(`${match[1]}${normalized}`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function isMoneyInput(value: string) {
  return amountFromInput(value) !== undefined;
}

export function centsFromInput(value: string) {
  const parsed = amountFromInput(value);
  return parsed === undefined ? 0 : Math.round(parsed * 100);
}
export function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
