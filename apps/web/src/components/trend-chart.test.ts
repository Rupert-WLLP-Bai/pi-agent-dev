import { expect, test } from "bun:test";
import { axisTicks, monotonePath } from "./trend-chart";

/** Every y coordinate the path emits, in order. */
const yValues = (path: string): number[] => {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  // Command letters interleave with x/y pairs; the first number of each pair is x.
  return numbers.filter((_, index) => index % 2 === 1);
};

test("monotonePath handles the degenerate lengths", () => {
  expect(monotonePath([])).toBe("");
  expect(monotonePath([{ x: 4, y: 9 }])).toBe("M 4 9");
});

test("a flat series stays flat rather than bowing between points", () => {
  const path = monotonePath([
    { x: 0, y: 50 },
    { x: 10, y: 50 },
    { x: 20, y: 50 },
  ]);
  for (const y of yValues(path)) expect(y).toBe(50);
});

test("a monotone series never overshoots its own range", () => {
  // Spans a long flat run then climbs: Catmull-Rom would dip below the flat run
  // where it turns upward, drawing a trough the data never had.
  const points = [
    { x: 0, y: 100 },
    { x: 10, y: 100 },
    { x: 20, y: 100 },
    { x: 30, y: 40 },
    { x: 40, y: 20 },
  ];
  const path = monotonePath(points);
  expect(path).toContain("C");
  for (const y of yValues(path)) {
    expect(y).toBeGreaterThanOrEqual(20);
    expect(y).toBeLessThanOrEqual(100);
  }
});

test("axisTicks covers the data with round numbers from zero", () => {
  expect(axisTicks(48)).toEqual([0, 20, 40, 60]);
  expect(axisTicks(5)).toEqual([0, 2, 4, 6]);
  // A peak that already sits on the step must not gain a redundant empty band.
  expect(axisTicks(40)).toEqual([0, 10, 20, 30, 40]);
});

test("axisTicks still returns an axis when there is nothing to plot", () => {
  expect(axisTicks(0)).toEqual([0, 1]);
  expect(axisTicks(-3)).toEqual([0, 1]);
});
