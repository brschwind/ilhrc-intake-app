import { createCameraScanLatch } from "./cameraScanLatch.js";
import { SCAN_CAMERA_CONSTRAINTS, nativeBarcodeFormats } from "./scanCameraPolicy.js";
import { useEffect, useRef, useState } from "react";
import { createCameraDuplicateGate } from "./locationInventory.js";

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera access is blocked. Allow the camera for this site, then try again.";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "No camera was found. Manual barcode entry is available in shelf settings.";
  if (error?.name === "NotReadableError") return "The camera is busy. Close other camera apps and try again.";
  return "The camera could not start. Try again or use manual barcode entry in shelf settings.";
}

export default function CameraBarcodeScanner({ active, onDetected, onClose, onError, singleShot = false, requireClearFrame = false, paused = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const pausedRef = useRef(paused);
  const detectedRef = useRef(onDetected);
  const closeRef = useRef(onClose);
  const errorRef = useRef(onError);
  const [starting, setStarting] = useState(true);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [zoomRange, setZoomRange] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [lastRead, setLastRead] = useState("");
  const [controlMessage, setControlMessage] = useState("");

  useEffect(() => {
    pausedRef.current = paused;
    detectedRef.current = onDetected;
    closeRef.current = onClose;
    errorRef.current = onError;
  }, [paused, onDetected, onClose, onError]);

  useEffect(() => {
    if (!active) return undefined;
    const videoElement = videoRef.current;
    let disposed = false;
    let accepted = false;
    let timer;
    let stream;
    let fallbackControls;
    let fallbackStarted = false;
    let lastDetectionAt = Date.now();
    const gate = createCameraDuplicateGate();
    const latch = createCameraScanLatch();
    setStarting(true); setLastRead(""); setControlMessage(""); setTorchOn(false);
    setTorchAvailable(false); setZoomRange(null);

    const accept = (value) => {
      lastDetectionAt = Date.now();
      if (disposed || pausedRef.current || (singleShot && accepted) || !gate.shouldAccept(value)) return;
      if (requireClearFrame && !latch.accept(value)) return;
      accepted = true;
      setLastRead(String(value).trim());
      Promise.resolve(detectedRef.current(String(value).trim(), "camera")).catch((error) => {
        if (!disposed) errorRef.current(error?.message || "The scan could not be processed.");
      });
      navigator.vibrate?.(45);
    };

    async function startFallback() {
      if (fallbackStarted || disposed) return;
      fallbackStarted = true;
      clearTimeout(timer);
      const { BrowserMultiFormatReader, BarcodeFormat } = await import("@zxing/browser");
      if (disposed) return;
      const reader = new BrowserMultiFormatReader(new Map(), { delayBetweenScanAttempts: 100, delayBetweenScanSuccess: 200 });
      reader.possibleFormats = [BarcodeFormat.CODE_128, BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.CODE_39, BarcodeFormat.QR_CODE];
      // Reuse the already-open rear camera rather than asking for a second stream.
      fallbackControls = await reader.decodeFromStream(stream, videoElement, (result, error) => {
        if (disposed) return;
        if (result) accept(result.getText());
        else if (error?.name === "NotFoundException" || error?.getKind?.() === "NotFoundException") latch.clear();
      });
      if (disposed) { fallbackControls.stop(); return; }
      setStarting(false);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia || !videoElement) throw new Error("Camera unavailable");
      stream = await navigator.mediaDevices.getUserMedia(SCAN_CAMERA_CONSTRAINTS);
      if (disposed) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      videoElement.srcObject = stream;
      await videoElement.play();
      if (disposed) return;
      const track = stream.getVideoTracks()[0];
      const capabilities = track?.getCapabilities?.() || {};
      if (capabilities.focusMode?.includes("continuous")) {
        await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
      }
      if (disposed) return;
      setTorchAvailable(Boolean(capabilities.torch));
      if (capabilities.zoom) {
        setZoomRange(capabilities.zoom);
        setZoom(track.getSettings?.().zoom || capabilities.zoom.min || 1);
      }
      let detector;
      if ("BarcodeDetector" in globalThis) {
        try {
          const supported = await globalThis.BarcodeDetector.getSupportedFormats();
          if (disposed) return;
          const formats = nativeBarcodeFormats(supported);
          if (formats.length) detector = new globalThis.BarcodeDetector({ formats });
        } catch { /* Use the fallback on browsers with incomplete native support. */ }
      }
      if (!detector) { await startFallback(); return; }
      setStarting(false);
      const detect = async () => {
        if (disposed || fallbackStarted) return;
        try {
          const codes = await detector.detect(videoElement);
          if (disposed) return;
          if (codes?.[0]?.rawValue) accept(codes[0].rawValue);
          else latch.clear();
          if (Date.now() - lastDetectionAt > 4000) { await startFallback(); return; }
        } catch {
          await startFallback(); return;
        }
        if (!disposed) timer = setTimeout(() => { detect().catch(fail); }, 100);
      };
      await detect();
    }

    function fail(error) {
      if (disposed) return;
      fallbackControls?.stop?.();
      stream?.getTracks().forEach((track) => track.stop());
      errorRef.current(cameraErrorMessage(error));
      closeRef.current();
    }
    start().catch(fail);
    return () => {
      disposed = true;
      clearTimeout(timer);
      fallbackControls?.stop?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (streamRef.current === stream) streamRef.current = null;
      if (videoElement) videoElement.srcObject = null;
    };
  }, [active, singleShot, requireClearFrame]);

  async function toggleTorch() {
    try {
      await streamRef.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(!torchOn); setControlMessage("");
    } catch { setControlMessage("This camera could not change its light."); }
  }
  async function changeZoom(value) {
    try {
      await streamRef.current?.getVideoTracks()[0]?.applyConstraints({ advanced: [{ zoom: Number(value) }] });
      setZoom(Number(value)); setControlMessage("");
    } catch { setControlMessage("This camera could not change its zoom."); }
  }
  if (!active) return null;
  return <section className="camera-scanner" aria-label="Camera barcode scanner">
    <div className="camera-preview"><video ref={videoRef} muted playsInline aria-label="Live camera preview"/><div className="camera-target" aria-hidden="true"/></div>
    <p className="camera-scan-guidance" role="status">{starting ? "Starting rear camera…" : paused ? "Saving scan…" : lastRead ? "Read: " + lastRead + (requireClearFrame ? ". Move it away, then scan the next book." : "") : "Hold the barcode steady, about 6–10 inches from the camera."}</p>
    <div className="camera-scanner-actions">{torchAvailable && <button type="button" className="secondary" aria-pressed={torchOn} onClick={toggleTorch}>{torchOn ? "Light off" : "Light on"}</button>}<button type="button" className="secondary" onClick={onClose}>Stop camera</button></div>
    {zoomRange && <label className="camera-zoom">Zoom<input aria-label="Camera zoom" type="range" min={zoomRange.min} max={Math.min(zoomRange.max, 4)} step={zoomRange.step || 0.1} value={zoom} onChange={(event) => changeZoom(event.target.value)}/></label>}
    {controlMessage && <p role="status">{controlMessage}</p>}
  </section>;
}
