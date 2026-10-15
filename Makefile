# Layered QA and demo entry points.
#
# Every target names the real command it runs; nothing here is a placeholder.
# The split mirrors the three coverage kinds in docs/quality/TEST-STRATEGY.md:
# unit, integration and end-to-end are separate layers and are never summed
# into one number.
#
#   make dev            start the API + web servers (scripts/dev-up.sh)
#   make test           unit tests only (packages/ and apps/)
#   make test-unit      same as test
#   make test-integration  real PostgreSQL / Redis / S3 scenarios
#   make test-e2e       Playwright acceptance suite
#   make test-all       unit + integration + e2e
#   make coverage       unit line/function coverage into artifacts/qa/coverage
#   make verify         lint + typecheck + unit (unchanged gate)
#   make qa-report      layered report with Git SHA, exit codes and artifacts
#   make qa-faults      failure-path scenarios (S3/Redis/upload/hostile input)
#   make demo-ready     demo readiness gate (delegates to the demo CLI `ready`)
#
# Integration and E2E need a disposable database: export TEST_DATABASE_URL
# (or DATABASE_URL with INTEGRATION_ALLOW_DEFAULT_DB=1) before running them.

BUN ?= bun
PLAYWRIGHT ?= bunx playwright

.PHONY: help dev test test-unit test-integration test-e2e test-all coverage verify \
        qa-report qa-faults qa-coverage \
        demo-up demo-down demo-reset demo-seed demo-verify demo-check demo-ready \
        secrets-rotate lint typecheck

help:
	@echo "dev, test, test-unit, test-integration, test-e2e, test-all, coverage, verify,"
	@echo "qa-report, qa-faults, qa-coverage, demo-up, demo-down, demo-reset, demo-seed,"
	@echo "demo-verify, demo-check, demo-ready, secrets-rotate, lint, typecheck"

dev:
	./scripts/dev-up.sh

lint:
	$(BUN) run lint

typecheck:
	$(BUN) run typecheck

test: test-unit

test-unit:
	$(BUN) run test:unit

test-integration:
	$(BUN) run test:integration

test-e2e:
	$(BUN) run test:e2e

test-all:
	$(BUN) run test:all

coverage:
	$(BUN) run test:coverage
	$(BUN) run qa:coverage

verify:
	$(BUN) run verify

qa-report:
	$(BUN) run qa:report

qa-faults:
	$(BUN) run qa:faults

qa-coverage:
	$(BUN) run qa:coverage

secrets-rotate:
	$(BUN) run secrets:rotate

# ── Demo world ────────────────────────────────────────────────────
# The CLI owns the environment/identity confirmation, the stack lifecycle and
# the repeated-reset verification, so the aliases only forward to it. `ready`
# runs the whole gate inside the CLI: Make prerequisites are deduplicated (a
# target listed twice runs once), so repeating `demo-reset` here would not
# actually reset twice, and comparing the two worlds is the CLI's job.

demo-up:
	$(BUN) run demo:up

demo-down:
	$(BUN) run demo:down

demo-reset:
	$(BUN) run demo:reset

demo-seed:
	$(BUN) run demo:seed

demo-verify:
	$(BUN) run demo:verify

demo-check:
	$(BUN) run demo:check

demo-ready:
	$(BUN) run demo:ready
