const { WebhooksHelper } = require("square");

const INVENTORY_EVENT_TYPE = "inventory.count.updated";
const INVENTORY_STATE = "IN_STOCK";

function parseSquareQuantity(value) {
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) ? quantity : null;
}

function variationsWithoutInventoryTracking(objects, variationIds) {
  const requested = new Set(variationIds || []);
  return (objects || []).filter((object) => (
    object?.type === "ITEM_VARIATION" &&
    requested.has(object.id) &&
    object.item_variation_data?.track_inventory !== true
  ));
}

function soldQuantitiesByVariation(orders, variationIds) {
  const requested = new Set(variationIds || []);
  const sold = new Map();
  for (const order of orders || []) {
    if (order?.state !== "COMPLETED") continue;
    for (const lineItem of order.line_items || []) {
      const variationId = lineItem?.catalog_object_id;
      const quantity = parseSquareQuantity(lineItem?.quantity);
      if (!requested.has(variationId) || quantity === null || quantity <= 0) continue;
      sold.set(variationId, (sold.get(variationId) || 0) + quantity);
    }
  }
  return sold;
}

function squareSalesPayloadFromOrders(orders) {
  return (orders || [])
    .filter((order) => order?.state === "COMPLETED" && order?.id)
    .map((order) => ({
      order_id: order.id,
      closed_at: order.closed_at || order.updated_at || order.created_at,
      lines: (order.line_items || []).flatMap((lineItem, index) => {
        const quantity = parseSquareQuantity(lineItem?.quantity);
        if (!lineItem?.catalog_object_id || quantity === null || quantity <= 0) return [];
        return [{
          line_uid: lineItem.uid || `${lineItem.catalog_object_id}:${index}`,
          catalog_object_id: lineItem.catalog_object_id,
          quantity,
        }];
      }),
    }))
    .filter((order) => order.closed_at && order.lines.length > 0);
}

function catalogVariationWithInventoryTracking(object) {
  const updated = structuredClone(object);
  delete updated.created_at;
  delete updated.updated_at;
  delete updated.is_deleted;
  updated.item_variation_data = {
    ...updated.item_variation_data,
    track_inventory: true,
  };
  return updated;
}

function startOfDayInTimeZone(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZoneName: "shortOffset",
    }).formatToParts(now).map((part) => [part.type, part.value])
  );
  const match = parts.timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Could not determine the UTC offset for ${timeZone}.`);
  const direction = match[1] === "+" ? 1 : -1;
  const offsetMinutes = direction * (Number(match[2]) * 60 + Number(match[3] || 0));
  return new Date(Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day)
  ) - offsetMinutes * 60_000).toISOString();
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
  catalogVariationWithInventoryTracking,
  inventoryCountsFromEvent,
  parseSquareQuantity,
  soldQuantitiesByVariation,
  squareSalesPayloadFromOrders,
  startOfDayInTimeZone,
  variationsWithoutInventoryTracking,
  verifySquareWebhook,
};
