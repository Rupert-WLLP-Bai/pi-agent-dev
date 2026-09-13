/**
 * The acting operator's identity, until user accounts exist (P2).
 *
 * The value is the name the API records as the actor on a mutation
 * (`triggeredBy`, `publishedBy`, `disabledBy`, …). It is a browser-local
 * preference shared by every surface that acts on the operator's behalf, so the
 * rule editor and the review center never disagree about who is acting.
 */
const OPERATOR_STORAGE_KEY = "review-operator";
const DEFAULT_OPERATOR = "我";

export function readOperator(): string {
  if (typeof window === "undefined") return DEFAULT_OPERATOR;
  return window.localStorage.getItem(OPERATOR_STORAGE_KEY) ?? DEFAULT_OPERATOR;
}

export function writeOperator(name: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(OPERATOR_STORAGE_KEY, name);
  }
}

export { DEFAULT_OPERATOR };
