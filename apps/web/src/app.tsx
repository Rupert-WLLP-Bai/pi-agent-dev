import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  RouterProvider,
} from "@tanstack/react-router";
import type { AuditLifecycleFilter } from "./audit-presentation";
import { AppShell } from "./components/app-shell";
import AuditCaseDetail from "./routes/audit-case-detail";
import AuditCasesList from "./routes/audit-cases";
import AuditRunsPage from "./routes/audit-runs";
import AuditTracePage from "./routes/audit-trace";
import DashboardPage from "./routes/dashboard";
import DemoPage from "./routes/demo";
import ReviewCenterPage from "./routes/reviews";
import RuleDetail from "./routes/rule-detail";
import RulesPage from "./routes/rules";
import ValidationPage from "./routes/validation";

const queryClient = new QueryClient();

const LIFECYCLE_FILTERS: readonly AuditLifecycleFilter[] = [
  "ALL",
  "AWAITING_REVIEW",
  "PROCESSING",
  "COMPLETED",
  "CANCELLED",
  "ABNORMAL",
];
const rootRoute = createRootRoute({ component: () => <AppShell /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/dashboard" />,
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/dashboard",
  component: DashboardPage,
});

const demoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/demo",
  component: DemoPage,
});

const runsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-runs",
  component: AuditRunsPage,
});

const listRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-cases",
  // The cockpit drills into a filtered queue, so the filter has to survive the
  // navigation. An unknown value is dropped rather than trusted.
  validateSearch: (search: Record<string, unknown>): { lifecycle?: AuditLifecycleFilter } => ({
    lifecycle: LIFECYCLE_FILTERS.includes(search.lifecycle as AuditLifecycleFilter)
      ? (search.lifecycle as AuditLifecycleFilter)
      : undefined,
  }),
  component: AuditCasesRoute,
});

function AuditCasesRoute() {
  const { lifecycle } = listRoute.useSearch();
  return <AuditCasesList initialFilter={lifecycle} />;
}

function AuditCaseDetailRoute() {
  const { id } = detailRoute.useParams();
  const { origin } = detailRoute.useSearch();
  return <AuditCaseDetail id={id} origin={origin ?? null} />;
}

const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-cases/$id",
  // Keep the entry point so the workbench can return where the operator came
  // from; an unknown value is dropped rather than trusted.
  validateSearch: (search: Record<string, unknown>): { origin?: "reviews" } => ({
    origin: search.origin === "reviews" ? "reviews" : undefined,
  }),
  component: AuditCaseDetailRoute,
});

function AuditTraceRoute() {
  const { id } = traceRoute.useParams();
  const { runId } = traceRoute.useSearch();
  return <AuditTracePage id={id} initialRunId={runId ?? null} />;
}

const traceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-cases/$id/trace",
  validateSearch: (search: Record<string, unknown>) => ({
    runId: typeof search.runId === "string" ? search.runId : undefined,
  }),
  component: AuditTraceRoute,
});

const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewCenterPage,
});

const rulesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rules",
  component: RulesPage,
});

function RuleDetailRoute() {
  const { id } = ruleDetailRoute.useParams();
  return <RuleDetail id={id} />;
}

const ruleDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/rules/$id",
  component: RuleDetailRoute,
});

const validationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/cases",
  component: ValidationPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  demoRoute,
  runsRoute,
  listRoute,
  detailRoute,
  traceRoute,
  reviewsRoute,
  rulesRoute,
  ruleDetailRoute,
  validationRoute,
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
