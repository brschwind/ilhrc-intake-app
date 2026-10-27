import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
test("starting barcode closes cover before opening scanner", () => {
  const handler = source.slice(source.indexOf('function scanBarcode(target'), source.indexOf('async function handleIntakeCameraBarcode'));
  const calls = [];
  new Function('stopCoverCamera','setBarcodeScanTarget','setIsScanningBarcode', handler+'scanBarcode("publisher");')(
    () => calls.push('stop cover'), value => calls.push(value), value => calls.push(value));
  assert.deepEqual(calls,['stop cover','publisher',true]);
});
test("late cover-camera permission results release the stale stream", async () => {
  const handler = source.slice(source.indexOf('async function attachCoverCameraStream'),source.indexOf('async function startCoverCamera'));
  let stopped = false;
  const stream = { getTracks: () => [{ stop: () => { stopped = true; } }] };
  await new Function('coverCameraRequestRef','stream',handler+'return attachCoverCameraStream(stream, 1);')({current:2},stream);
  assert.equal(stopped,true);
});
test("closing cover invalidates pending requests and stops its active stream", () => {
  const handler = source.slice(source.indexOf('function stopCoverCamera()'),source.indexOf('async function attachCoverCameraStream'));
  const request = {current:1}; let stopped=false;
  const stream = {current:{getTracks:()=>[{stop:()=>{stopped=true;}}]}};
  const noop=()=>{};
  new Function('coverCameraRequestRef','coverCameraStreamRef','coverCameraVideoRef','setCoverCameraReady','setCoverCameraOpen','setCoverCameraDevices','setCoverCameraDeviceId','setAnalysisStatus',handler+'stopCoverCamera();')(request,stream,{current:null},noop,noop,noop,noop,noop);
  assert.equal(request.current,2); assert.equal(stream.current,null); assert.equal(stopped,true);
});
