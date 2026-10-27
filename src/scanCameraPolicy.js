export const SCAN_CAMERA_CONSTRAINTS = {
  video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  audio: false,
};
export function nativeBarcodeFormats(supported) {
  const desired = ["ean_13", "ean_8", "upc_a", "code_128", "code_39", "qr_code"];
  // Our printed SKU labels use Code 128. A browser missing it needs the fallback.
  if (!supported.includes("code_128")) return [];
  return desired.filter((format) => supported.includes(format));
}
