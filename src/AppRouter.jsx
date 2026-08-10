import { useEffect, useMemo, useState } from "react";
import App from "./App.jsx";
import ConnectionsPublic, { ConnectionsUnavailable } from "./connections/ConnectionsPublic.jsx";
import ConnectionsAdmin from "./connections/ConnectionsAdmin.jsx";
import {
  ConnectionsCorrectionPage,
  ConnectionsReferralPage,
  ConnectionsSubmissionPage,
} from "./connections/ConnectionsForms.jsx";
import { CONNECTIONS_ENABLED, CONNECTIONS_FIXTURES_ENABLED } from "./connections/connectionsConfig.js";
import { createConnectionsService } from "./connections/connectionsService.js";
import { createConnectionsSupabaseAdapterFromEnvironment } from "./connections/connectionsSupabaseAdapter.js";
import { createConnectionsWorkflowService } from "./connections/connectionsWorkflowService.js";
import { createConnectionsWorkflowSupabaseAdapterFromEnvironment } from "./connections/connectionsWorkflowSupabaseAdapter.js";
import { APP_NAVIGATION_EVENT, navigateToPath, resolveAppRoute } from "./routing/appRoutes.js";

const developmentFixtureLoader = import.meta.env.DEV
  ? () => import("./connections/connectionsFixtures.js")
  : undefined;

function currentRoute() {
  return resolveAppRoute(window.location, CONNECTIONS_ENABLED);
}

function handlePublicNavigation(event, path) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigateToPath(path);
}

let connectionsServices;

function getConnectionsServices() {
  if (!connectionsServices) {
    const adapter = CONNECTIONS_ENABLED && !CONNECTIONS_FIXTURES_ENABLED
      ? createConnectionsSupabaseAdapterFromEnvironment(import.meta.env)
      : undefined;
    const workflowAdapter = CONNECTIONS_ENABLED && !CONNECTIONS_FIXTURES_ENABLED
      ? createConnectionsWorkflowSupabaseAdapterFromEnvironment(import.meta.env)
      : undefined;
    connectionsServices = {
      publicService: createConnectionsService({
        enabled: CONNECTIONS_ENABLED,
        adapter,
        fixturesEnabled: CONNECTIONS_FIXTURES_ENABLED,
        fixtureLoader: developmentFixtureLoader,
      }),
      workflowService: createConnectionsWorkflowService({
        enabled: CONNECTIONS_ENABLED && !CONNECTIONS_FIXTURES_ENABLED,
        adapter: workflowAdapter,
      }),
    };
  }
  return connectionsServices;
}

export default function AppRouter() {
  const [route, setRoute] = useState(currentRoute);
  const services = useMemo(() => getConnectionsServices(), []);

  useEffect(() => {
    const updateRoute = () => setRoute(currentRoute());
    window.addEventListener("popstate", updateRoute);
    window.addEventListener(APP_NAVIGATION_EVENT, updateRoute);
    return () => {
      window.removeEventListener("popstate", updateRoute);
      window.removeEventListener(APP_NAVIGATION_EVENT, updateRoute);
    };
  }, []);

  if (route.kind === "connections-unavailable") {
    return <ConnectionsUnavailable onNavigate={handlePublicNavigation} />;
  }
  if (route.kind === "connections") {
    if (route.page === "submit") return <ConnectionsSubmissionPage workflowService={services.workflowService} onNavigate={handlePublicNavigation} />;
    if (route.page === "correction") return <ConnectionsCorrectionPage resourceSlug={route.slug} workflowService={services.workflowService} onNavigate={handlePublicNavigation} />;
    if (route.page === "referral") return <ConnectionsReferralPage workflowService={services.workflowService} onNavigate={handlePublicNavigation} />;
    if (route.page === "admin") return <ConnectionsAdmin workflowService={services.workflowService} onNavigate={handlePublicNavigation} />;
    return <ConnectionsPublic route={route} service={services.publicService} onNavigate={handlePublicNavigation} />;
  }
  return <App />;
}
