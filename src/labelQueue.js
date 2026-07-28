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
