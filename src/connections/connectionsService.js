import { toPublicConnectionResource, validatePublicConnectionResource } from "./connectionsModel.js";

export function createConnectionsService({ enabled = false, adapter, fixturesEnabled = false, fixtureLoader } = {}) {
  let cachedResources;

  async function loadResources() {
    if (!enabled) return [];
    if (!cachedResources) {
      if (fixturesEnabled) {
        if (!fixtureLoader) throw new Error("Connections fixture loading is unavailable in this environment.");
        const module = await fixtureLoader();
        cachedResources = (module.connectionFixtures || []).map(validatePublicConnectionResource);
      } else {
        if (!adapter?.listResources) throw new Error("Connections data is not configured for this environment.");
        cachedResources = (await adapter.listResources()).map(validatePublicConnectionResource);
      }
    }
    return cachedResources.map(toPublicConnectionResource);
  }

  return {
    async listResources() {
      return loadResources();
    },
  };
}
