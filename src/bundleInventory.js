export const EMPTY_BUNDLE_DRAFT = {
  active: false,
  source: "intake",
  title: "",
  price: "",
  components: [],
};

export function getBundleComponentQuantity(component) {
  return Math.max(
    1,
    Number(component?.bundle_quantity ?? component?.quantity ?? 1)
  );
}

export function getBundlePieceCount(components = []) {
  return components.reduce(
    (total, component) => total + getBundleComponentQuantity(component),
    0
  );
}

export function getBundleIndividualValue(components = []) {
  return components.reduce(
    (total, component) =>
      total +
      Number(component.final_price || 0) *
        getBundleComponentQuantity(component),
    0
  );
}

export function buildBundleContentsNote(components = []) {
  return components
    .map((component) => {
      const quantity = getBundleComponentQuantity(component);
      return `${quantity}× ${component.title || "Untitled item"} (${component.sku || "SKU pending"})`;
    })
    .join("\n");
}

export function getBundleComponentRows(bundleItemId, components = []) {
  return components.map((component) => ({
    bundle_item_id: String(bundleItemId),
    component_item_id: String(component.id),
    piece_quantity: getBundleComponentQuantity(component),
  }));
}
