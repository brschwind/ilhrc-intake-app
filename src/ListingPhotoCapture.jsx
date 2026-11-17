import { useEffect, useRef, useState } from 'react';

export default function ListingPhotoCapture({ preview, onPhoto, disabled }) {
  const video = useRef(null);
  const stream = useRef(null);
  const request = useRef(0);
  const captureInput = useRef(null);
  const uploadInput = useRef(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => {
    request.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  function stop() {
    request.current += 1;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setOpen(false);
    setReady(false);
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      captureInput.current?.click();
      return;
    }
    stop();
    const id = ++request.current;
    setError('');
    setOpen(true);
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1400 } }, audio: false,
      });
      if (id !== request.current) {
        camera.getTracks().forEach(track => track.stop());
        return;
      }
      stream.current = camera;
      video.current.srcObject = camera;
      await video.current.play();
      if (id === request.current) setReady(true);
    } catch {
      if (id === request.current) {
        stop();
        setError('Camera unavailable. Use Choose Photo or your phone camera instead.');
      }
    }
  }

  async function takePhoto() {
    const player = video.current;
    if (!player?.videoWidth) return;
    try {
      const scale = Math.min(1, 1400 / Math.max(player.videoWidth, player.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(player.videoWidth * scale);
      canvas.height = Math.round(player.videoHeight * scale);
      canvas.getContext('2d').drawImage(player, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Photo capture failed.');
      onPhoto(new File([blob], 'ace-set-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
      stop();
    } catch (e) { setError(e.message); }
  }

  function choose(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    stop();
    setError('');
    onPhoto(file);
  }

  return <section className="ace-photo-section" aria-label="Listing photo">
    <h3>Listing photo</h3>
    <p className="helper-text">Photograph the whole set together for its listing.</p>
    {preview && <img className="ace-photo-preview" src={preview} alt="ACE listing photo preview" />}
    <div className="intake-actions">
      <button className="secondary" type="button" disabled={disabled} onClick={start}>Take Photo</button>
      <button className="secondary" type="button" disabled={disabled} onClick={() => uploadInput.current?.click()}>Choose Photo</button>
      {preview && <button className="text-button" type="button" disabled={disabled} onClick={() => onPhoto(null)}>Remove Photo</button>}
    </div>
    <input ref={captureInput} type="file" accept="image/*" capture="environment" className="visually-hidden-file" onChange={choose} disabled={disabled} aria-label="Take listing photo with phone camera" />
    <input ref={uploadInput} type="file" accept="image/*" className="visually-hidden-file" onChange={choose} disabled={disabled} aria-label="Choose listing photo" />
    <video ref={video} hidden={!open} className="cover-camera-video" autoPlay muted playsInline />
    {open && <div className="intake-actions">
      <button className="primary" type="button" disabled={!ready || disabled} onClick={takePhoto}>{ready ? 'Use This Photo' : 'Starting Camera...'}</button>
      <button className="secondary" type="button" onClick={() => captureInput.current?.click()}>Use Phone Camera</button>
      <button className="secondary" type="button" onClick={stop}>Cancel Camera</button>
    </div>}
    {error && <p role="alert" className="warning-text">{error}</p>}
  </section>;
}
