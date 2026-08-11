export function getQueuedLabelQuantity(item) {
  if (!item || item.label_printed === true) return 0;

  const pendingQuantity = Number(item.pending_label_quantity);
  if (
    item.pending_label_quantity !== null &&
    item.pending_label_quantity !== undefined &&
    Number.isFinite(pendingQuantity) &&
    pendingQuantity > 0
  ) {
    return pendingQuantity;
  }

  const inventoryQuantity = Number(item.quantity);
  return Number.isFinite(inventoryQuantity) && inventoryQuantity > 0
    ? inventoryQuantity
    : 0;
}

export function buildDuplicateLabelQueueUpdate(item, receivedQuantity, queuedAt) {
  const quantity = Number(receivedQuantity);
  const addedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

  return {
    label_printed: false,
    pending_label_quantity: getQueuedLabelQuantity(item) + addedQuantity,
    label_queued_at: queuedAt,
  };
}

export function buildSelectedLabelQueueUpdate(item, queuedAt) {
  const currentPendingQuantity = getQueuedLabelQuantity(item);
  const inventoryQuantity = Number(item?.quantity);
  const quantityToQueue = currentPendingQuantity > 0
    ? currentPendingQuantity
    : Number.isFinite(inventoryQuantity) && inventoryQuantity > 0
      ? inventoryQuantity
      : 1;

  return {
    label_printed: false,
    pending_label_quantity: quantityToQueue,
    label_queued_at: item?.label_queued_at || queuedAt,
  };
}

function comparableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

export function getLabelAffectingEditFields(originalItem, updatedItem) {
  const changedFields = [];

  if (String(originalItem?.sku || "") !== String(updatedItem?.sku || "")) {
    changedFields.push("sku");
  }
  if (comparableNumber(originalItem?.final_price) !== comparableNumber(updatedItem?.final_price)) {
    changedFields.push("final_price");
  }
  if (comparableNumber(originalItem?.quantity) !== comparableNumber(updatedItem?.quantity)) {
    changedFields.push("quantity");
  }

  return changedFields;
}

export function buildEditedItemLabelQueueUpdate(item, queuedAt) {
  return {
    label_printed: false,
    pending_label_quantity: getQueuedLabelQuantity(item) + 1,
    label_queued_at: queuedAt,
  };
}
