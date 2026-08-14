const { WebhooksHelper } = require("square");

const INVENTORY_EVENT_TYPE = "inventory.count.updated";
const INVENTORY_STATE = "IN_STOCK";

function parseSquareQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

function inventoryCountsFromEvent(event, locationId) {
  if (event?.type !== INVENTORY_EVENT_TYPE) return [];

  const newestByVariation = new Map();
  const counts = event?.data?.object?.inventory_counts;
  if (!Array.isArray(counts)) return [];

  for (const count of counts) {
    const quantity = parseSquareQuantity(count?.quantity);
    const calculatedAt = new Date(count?.calculated_at || event.created_at || "");
    if (
      count?.state !== INVENTORY_STATE ||
      count?.location_id !== locationId ||
      !count?.catalog_object_id ||
      quantity === null ||
      Number.isNaN(calculatedAt.getTime())
    ) {
      continue;
    }

    const normalized = {
      squareVariationId: count.catalog_object_id,
      locationId: count.location_id,
      quantity,
      calculatedAt: calculatedAt.toISOString(),
    };
    const previous = newestByVariation.get(normalized.squareVariationId);
    if (!previous || normalized.calculatedAt > previous.calculatedAt) {
      newestByVariation.set(normalized.squareVariationId, normalized);
    }
  }

  return [...newestByVariation.values()];
}

async function verifySquareWebhook({ requestBody, signatureHeader, signatureKey, notificationUrl }) {
  return WebhooksHelper.verifySignature({
    requestBody,
    signatureHeader,
    signatureKey,
    notificationUrl,
  });
}

async function applyInventoryCount(supabaseAdmin, eventId, count) {
  return supabaseAdmin.rpc("apply_square_inventory_count", {
    p_event_id: eventId,
    p_square_variation_id: count.squareVariationId,
    p_location_id: count.locationId,
    p_quantity: count.quantity,
    p_calculated_at: count.calculatedAt,
  });
}

module.exports = {
  INVENTORY_EVENT_TYPE,
  applyInventoryCount,
  inventoryCountsFromEvent,
  parseSquareQuantity,
  verifySquareWebhook,
};
