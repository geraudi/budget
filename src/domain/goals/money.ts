/** Rounds a monetary amount to cents, without touching its sign. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}
