import { useEffect, useRef, useState } from "react";
import { createCameraDuplicateGate } from "./locationInventory.js";

const FORMATS = ["ean_13", "upc_a", "code_128", "qr_code"];

function cameraErrorMessage(error) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return "Camera permission was denied. You can continue with the scanner or barcode field.";
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return "No usable camera was found. You can continue with the scanner or barcode field.";
  }
  return "Camera scanning is unavailable. You can continue with the scanner or barcode field.";
}

export default function CameraBarcodeScanner({ active, onDetected, onClose, onError }) {
  const videoRef = useRef(null);
  const detectedRef = useRef(onDetected);
  const closeRef = useRef(onClose);
  const errorRef = useRef(onError);
  const [starting, setStarting] = useState(true);

  useEffect(() => {
    detectedRef.current = onDetected;
    closeRef.current = onClose;
    errorRef.current = onError;
  }, [onDetected, onClose, onError]);

  useEffect(() => {
    if (!active) return undefined;
    const videoElement = videoRef.current;
    let disposed = false;
    let animationFrame = 0;
    let stream;
    let fallbackControls;
    const gate = createCameraDuplicateGate();

    const accept = (value) => {
      if (disposed || !gate.shouldAccept(value)) return;
      Promise.resolve(detectedRef.current(String(value).trim(), "camera")).catch((error) => {
        errorRef.current(error?.message || "The camera scan could not be processed.");
      });
      navigator.vibrate?.(45);
    };

    async function startNative() {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      videoElement.srcObject = stream;
      await videoElement.play();
      let detector;
      try { detector = new globalThis.BarcodeDetector({ formats: FORMATS }); }
      catch { detector = new globalThis.BarcodeDetector(); }
      setStarting(false);
      const detect = async () => {
        if (disposed) return;
        try {
          const codes = await detector.detect(videoElement);
          if (codes?.[0]?.rawValue) accept(codes[0].rawValue);
        } catch (error) {
          if (error?.name !== "NotFoundError") errorRef.current("Camera is still open, but that frame could not be read.");
        }
        animationFrame = requestAnimationFrame(detect);
      };
      animationFrame = requestAnimationFrame(detect);
    }

    async function startFallback() {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 180,
        delayBetweenScanSuccess: 300,
      });
      fallbackControls = await reader.decodeFromVideoDevice(undefined, videoElement, (result) => {
        if (result) accept(result.getText());
      });
      setStarting(false);
    }

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera access is not supported by this browser.");
      if (!videoElement) throw new Error("The camera preview is not ready.");
      if ("BarcodeDetector" in globalThis) await startNative();
      else await startFallback();
    }

    start().catch((error) => {
      if (!disposed) {
        errorRef.current(cameraErrorMessage(error));
        closeRef.current();
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      fallbackControls?.stop?.();
      stream?.getTracks().forEach((track) => track.stop());
      if (videoElement) videoElement.srcObject = null;
    };
  }, [active]);

  if (!active) return null;
  return <section className="camera-scanner" aria-label="Camera barcode scanner"><div className="camera-preview"><video ref={videoRef} muted playsInline aria-label="Live camera preview"/><div className="camera-target" aria-hidden="true"/></div><div className="camera-scanner-actions"><p>{starting ? "Starting rear camera…" : "Center one barcode inside the frame."}</p><button type="button" className="secondary" onClick={onClose}>Stop camera</button></div></section>;
}
