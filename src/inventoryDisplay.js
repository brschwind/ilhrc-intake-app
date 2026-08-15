export function isSoldOutInventoryItem(item) {
  return (item?.status || "") === "Sold";
}

export function compareInventoryItems(a, b, sortBy = "newest") {
  const soldOutDifference = Number(isSoldOutInventoryItem(a)) - Number(isSoldOutInventoryItem(b));
  if (soldOutDifference !== 0) return soldOutDifference;

  if (sortBy === "title") {
    return (a.title || "").localeCompare(b.title || "");
  }
  if (sortBy === "quantityLow") {
    return Number(a.quantity || 0) - Number(b.quantity || 0);
  }
  if (sortBy === "quantityHigh") {
    return Number(b.quantity || 0) - Number(a.quantity || 0);
  }
  if (sortBy === "oldest") {
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  }
  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
}

export function totalSoldCopies(items) {
  return (items || []).reduce((sum, item) => sum + Number(item.sold_quantity || 0), 0);
}
