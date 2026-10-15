import { describe, expect, test } from "bun:test";
import {
  FIXTURE_CATEGORIES,
  fixtureCategoryCounts,
  fixtureCrossReferencesResolve,
  fixtureReviewStatusCounts,
  syntheticClauseFixtures,
} from "./clauses";

describe("synthetic clause fixture set", () => {
  test("holds at least sixty clauses", () => {
    expect(syntheticClauseFixtures.length).toBeGreaterThanOrEqual(60);
  });

  test("covers all ten categories with at least one clause each", () => {
    const counts = fixtureCategoryCounts();
    for (const category of FIXTURE_CATEGORIES) {
      expect(counts[category]).toBeGreaterThanOrEqual(1);
    }
  });

  test("every category carries positive, negative, ambiguous and exception-or-cross-clause cases", () => {
    for (const category of FIXTURE_CATEGORIES) {
      const kinds = new Set(
        syntheticClauseFixtures
          .filter((fixture) => fixture.category === category)
          .map((fixture) => fixture.kind),
      );
      expect(kinds.has("positive")).toBe(true);
      expect(kinds.has("negative")).toBe(true);
      expect(kinds.has("ambiguous")).toBe(true);
      expect(kinds.has("exception") || kinds.has("cross_clause")).toBe(true);
    }
  });

  test("every clause carries a label reason and a review status", () => {
    for (const fixture of syntheticClauseFixtures) {
      expect(fixture.reason.trim().length).toBeGreaterThan(0);
      expect(
        fixture.reviewStatus === "settled" || fixture.reviewStatus === "needs_human_review",
      ).toBe(true);
    }
  });

  test("every cross-clause reference resolves to a clause in the set", () => {
    expect(fixtureCrossReferencesResolve()).toBe(true);
  });

  test("ambiguous clauses are never marked settled", () => {
    for (const fixture of syntheticClauseFixtures) {
      if (fixture.kind === "ambiguous") expect(fixture.reviewStatus).toBe("needs_human_review");
    }
  });

  test("clause ids are unique", () => {
    const ids = syntheticClauseFixtures.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("reports the review-status split a report must cite", () => {
    const counts = fixtureReviewStatusCounts();
    expect(counts.settled + counts.needs_human_review).toBe(syntheticClauseFixtures.length);
    expect(counts.needs_human_review).toBeGreaterThan(0);
  });
});
