import test from "node:test";
import assert from "node:assert/strict";
import JsBarcode from "jsbarcode";
import { MultiFormatReader, BarcodeFormat, DecodeHintType, BinaryBitmap, HybridBinarizer, RGBLuminanceSource } from "@zxing/library";

for (const [value, format, barcodeFormat] of [
  ["ILHRC-001437", "CODE128", BarcodeFormat.CODE_128],
  ["LOCATION:A1", "CODE128", BarcodeFormat.CODE_128],
  ["9780140328721", "EAN13", BarcodeFormat.EAN_13],
]) {
  test("fallback reads printed " + format + " barcode " + value, () => {
    const target = {};
    JsBarcode(target, value, { format, displayValue: false });
    const bits = target.encodings.map((encoding) => encoding.data).join("");
    const scale = 2, margin = 30, width = bits.length * scale + margin * 2, height = 100;
    const pixels = new Uint8ClampedArray(width * height).fill(255);
    for (let x = 0; x < bits.length; x++) if (bits[x] === "1") {
      for (let y = 10; y < height - 10; y++) for (let dx = 0; dx < scale; dx++) pixels[y * width + margin + x * scale + dx] = 0;
    }
    const reader = new MultiFormatReader();
    const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [barcodeFormat]], [DecodeHintType.TRY_HARDER, true]]);
    const result = reader.decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, width, height))), hints);
    assert.equal(result.getText(), value);
  });
}
