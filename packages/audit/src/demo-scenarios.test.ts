import { expect, test } from "bun:test";
import {
  DEFAULT_FILLER_COUNT,
  DEFAULT_RNG_SEED,
  demoScenarioCases,
  demoScenarios,
  fillerKindCounts,
  generateFillerCases,
} from "./demo-scenarios";

test("the authored catalog covers the featured cross-case story", () => {
  const featured = demoScenarios.find((scenario) => scenario.featured);
  expect(featured?.id).toBe("cross-case-missed-link");
  expect(featured?.caseIds).toEqual(["history-old-advance", "history-new-clean-look"]);
  expect(demoScenarioCases.map((item) => item.id)).toContain("history-old-advance");
});

test("filler volume is reproducible and roughly 60/25/15", () => {
  const first = generateFillerCases(DEFAULT_RNG_SEED, DEFAULT_FILLER_COUNT);
  const second = generateFillerCases(DEFAULT_RNG_SEED, DEFAULT_FILLER_COUNT);
  expect(first.map((item) => item.text)).toEqual(second.map((item) => item.text));

  const counts = fillerKindCounts(first);
  expect(counts).toEqual({ clean: 11, single: 5, complex: 2 });
});

test("a 21-case filler batch varies counterparties and contract types", () => {
  const fillers = generateFillerCases(DEFAULT_RNG_SEED, 21);
  const parties = new Set(fillers.map((item) => item.summary.split(" · ")[0]));
  const titles = new Set(fillers.map((item) => item.title.replace(/（.+）$/u, "")));
  expect(parties.size).toBeGreaterThan(3);
  expect(titles.size).toBeGreaterThan(3);
  expect(new Set(fillers.map((item) => item.text)).size).toBe(fillers.length);
});
