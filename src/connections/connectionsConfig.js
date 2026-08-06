export function isConnectionsFeatureEnabled(environment = {}) {
  return environment?.VITE_CONNECTIONS_ENABLED === "true";
}

const runtimeEnvironment = import.meta.env || {};

export const CONNECTIONS_ENABLED = isConnectionsFeatureEnabled(runtimeEnvironment);
export const CONNECTIONS_FIXTURES_ENABLED =
  CONNECTIONS_ENABLED && runtimeEnvironment.VITE_CONNECTIONS_DATA_SOURCE === "fixtures" &&
  (runtimeEnvironment.DEV === true || runtimeEnvironment.MODE === "test");
