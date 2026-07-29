export const EMPTY_BUNDLE_DRAFT = {
  active: false,
  title: "",
  price: "",
  components: [],
};

export function getBundlePieceCount(components = []) {
  return components.reduce(
    (total, component) => total + Math.max(1, Number(component.quantity || 1)),
    0
  );
}

export function getBundleIndividualValue(components = []) {
  return components.reduce(
    (total, component) =>
      total +
      Number(component.final_price || 0) *
        Math.max(1, Number(component.quantity || 1)),
    0
  );
}

export function buildBundleContentsNote(components = []) {
  return components
    .map((component) => {
      const quantity = Math.max(1, Number(component.quantity || 1));
      return `${quantity}× ${component.title || "Untitled item"} (${component.sku || "SKU pending"})`;
    })
    .join("\n");
}

export function getBundleComponentRows(bundleItemId, components = []) {
  return components.map((component) => ({
    bundle_item_id: String(bundleItemId),
    component_item_id: String(component.id),
    piece_quantity: Math.max(1, Number(component.quantity || 1)),
  }));
}
