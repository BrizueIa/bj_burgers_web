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
export function centsFromInput(value: string) {
  const parsed = Number(
    value
      .replace(/\./g, '')
      .replace(',', '.')
      .replace(/[^0-9.-]/g, ''),
  );
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}
export function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}
