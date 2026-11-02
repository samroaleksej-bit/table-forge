/**
 * Вывод формулы броска из диапазонов результатов.
 * [1..12] → 1d12; [3..8] → 1d6+2; без диапазонов → по сумме весов.
 */
export function inferFormula(results = []) {
  const ranges = results
    .map((r) => r.range)
    .filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] >= r[0] && r[1] > 0);
  if (ranges.length) {
    const min = Math.min(...ranges.map((r) => r[0]));
    const max = Math.max(...ranges.map((r) => r[1]));
    const size = max - min + 1;
    const offset = min - 1;
    if (offset === 0) return `1d${max}`;
    return offset > 0 ? `1d${size}+${offset}` : `1d${size}${offset}`;
  }
  const total = results.reduce((sum, r) => sum + (Number(r.weight) > 0 ? Number(r.weight) : 1), 0);
  return total ? `1d${total}` : "";
}
