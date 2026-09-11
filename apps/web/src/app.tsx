import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Navigate,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { AppShell } from "./components/app-shell";
import AuditCasesList from "./routes/audit-cases";
import AuditCaseDetail from "./routes/audit-case-detail";

const queryClient = new QueryClient();

const rootRoute = createRootRoute({ component: () => <AppShell /> });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/audit-cases" />,
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

const routeTree = rootRoute.addChildren([indexRoute, listRoute, detailRoute]);

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
