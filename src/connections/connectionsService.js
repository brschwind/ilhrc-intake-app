import { toPublicConnectionResource, validatePublicConnectionResource } from "./connectionsModel.js";

export function createConnectionsService({ enabled = false, fixturesEnabled = false, fixtureLoader } = {}) {
  let cachedResources;

  async function loadFixtureResources() {
    if (!enabled) return [];
    if (!fixturesEnabled) throw new Error("Connections data is not configured for this environment.");
    if (!cachedResources) {
      if (!fixtureLoader) throw new Error("Connections fixture loading is unavailable in this environment.");
      const module = await fixtureLoader();
      cachedResources = (module.connectionFixtures || []).map(validatePublicConnectionResource);
    }
    return cachedResources.map(toPublicConnectionResource);
  }

  return {
    async listResources() {
      return loadFixtureResources();
    },
  };
}
