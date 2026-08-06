import { useEffect, useMemo, useState } from "react";
import App from "./App.jsx";
import ConnectionsPublic, { ConnectionsUnavailable } from "./connections/ConnectionsPublic.jsx";
import { CONNECTIONS_ENABLED, CONNECTIONS_FIXTURES_ENABLED } from "./connections/connectionsConfig.js";
import { createConnectionsService } from "./connections/connectionsService.js";
import { createConnectionsSupabaseAdapterFromEnvironment } from "./connections/connectionsSupabaseAdapter.js";
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

let connectionsService;

function getConnectionsService() {
  if (!connectionsService) {
    const adapter = CONNECTIONS_ENABLED && !CONNECTIONS_FIXTURES_ENABLED
      ? createConnectionsSupabaseAdapterFromEnvironment(import.meta.env)
      : undefined;
    connectionsService = createConnectionsService({
      enabled: CONNECTIONS_ENABLED,
      adapter,
      fixturesEnabled: CONNECTIONS_FIXTURES_ENABLED,
      fixtureLoader: developmentFixtureLoader,
    });
  }
  return connectionsService;
}

export default function AppRouter() {
  const [route, setRoute] = useState(currentRoute);
  const service = useMemo(() => getConnectionsService(), []);

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
    return <ConnectionsPublic route={route} service={service} onNavigate={handlePublicNavigation} />;
  }
  return <App />;
}
