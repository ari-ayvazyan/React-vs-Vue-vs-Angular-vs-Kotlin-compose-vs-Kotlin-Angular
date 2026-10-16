/** Integer axis scale with "nice" steps (1, 2, 5, 10, 20, …) covering `maxValue`. */
export function niceScale(maxValue: number): { step: number; max: number } {
  const m = Math.max(1, Math.ceil(maxValue));
  const step = m <= 5 ? 1 : m <= 10 ? 2 : m <= 25 ? 5 : m <= 50 ? 10 : Math.ceil(m / 5 / 10) * 10;
  return { step, max: Math.ceil(m / step) * step };
}

export function scaleTicks({ step, max }: { step: number; max: number }): number[] {
  return Array.from({ length: max / step + 1 }, (_, i) => i * step);
}
