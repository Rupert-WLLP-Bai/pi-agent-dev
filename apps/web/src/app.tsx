import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  RouterProvider,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import AuditCaseDetail from "./routes/audit-case-detail";
import AuditCasesList from "./routes/audit-cases";
import AuditRunsPage from "./routes/audit-runs";
import AuditTracePage from "./routes/audit-trace";
import DashboardPage from "./routes/dashboard";
import DemoPage from "./routes/demo";

const queryClient = new QueryClient();

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
  component: AuditCasesList,
});

function AuditCaseDetailRoute() {
  const { id } = detailRoute.useParams();
  return <AuditCaseDetail id={id} />;
}

const detailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-cases/$id",
  component: AuditCaseDetailRoute,
});

function AuditTraceRoute() {
  const { id } = traceRoute.useParams();
  return <AuditTracePage id={id} />;
}

const traceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/audit-cases/$id/trace",
  component: AuditTraceRoute,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  demoRoute,
  runsRoute,
  listRoute,
  detailRoute,
  traceRoute,
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
