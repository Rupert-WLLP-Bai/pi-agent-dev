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

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  demoRoute,
  listRoute,
  detailRoute,
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
