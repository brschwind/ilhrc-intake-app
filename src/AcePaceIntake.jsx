import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import ListingPhotoCapture from './ListingPhotoCapture.jsx';
import { ACE_PRICES, ACE_SUBJECTS, ACE_TYPES, aceNumbersForLevel, aceLevelForNumber, buildAceItem, newAceDraft } from './acePace';

export function AcePricingSettings() {
  const [prices, setPrices] = useState(ACE_PRICES);
  const [message, setMessage] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    supabase.from('ace_pricing').select('prices').eq('id', 1).single().then(({ data, error }) => {
      if (error) setMessage(error.message);
      else { setPrices(data.prices); setReady(true); }
    });
  }, []);
  async function save(event) {
    event.preventDefault();
    const { error } = await supabase.from('ace_pricing').update({ prices }).eq('id', 1);
    setMessage(error ? error.message : 'ACE prices saved. Existing listings retain their selling prices.');
  }
  const labels = { complete: 'Complete unused 12-PACE set', individual: 'Individual unused PACE', partial: 'Partial set, per PACE', scoreKey: 'Individual Score Key', test: 'Individual PACE Test' };
  return <form className="options-section" onSubmit={save}>
    <h3>ACE resale pricing</h3>
    <div className="ace-grid">{Object.entries(labels).map(([key, label]) => <label key={key}>{label}
      <input required type="number" min="0" step="0.01" value={prices[key]} onChange={e => setPrices({ ...prices, [key]: Number(e.target.value) })} />
    </label>)}</div>
    <button className="primary" disabled={!ready} type="submit">Save ACE Prices</button><p role="status">{message}</p>
  </form>;
}

export default function AcePaceIntake({ onClose, onSaved, syncSquare, uploadPhoto, generateSku, onPrint }) {
  const [draft, setDraft] = useState(newAceDraft);
  const [prices, setPrices] = useState(ACE_PRICES);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [duplicates, setDuplicates] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);
  const [photo, setPhoto] = useState(null);
  const lock = useRef(false);
  const requestId = useRef(null);
  const uploadedPhoto = useRef(null);
  const continueNext = useRef(false);
  const heading = useRef(null);

  useEffect(() => {
    heading.current?.focus();
    supabase.from('ace_pricing').select('prices').eq('id', 1).single().then(({ data, error }) => {
      if (error) setMessage('ACE setup is unavailable: ' + error.message);
      else { setPrices(data.prices); setReady(true); }
    });
  }, []);
  useEffect(() => () => { if (photo?.preview) URL.revokeObjectURL(photo.preview); }, [photo]);

  function change(key, value) {
    setDraft(current => ({ ...current, [key]: value }));
    setDuplicates(null);
    requestId.current = null;
  }
  function choosePhoto(file) {
    setPhoto(file ? { file, preview: URL.createObjectURL(file) } : null);
    uploadedPhoto.current = null;
    requestId.current = null;
  }
  function next() {
    requestId.current = null;
    uploadedPhoto.current = null;
    setPhoto(null);
    setReceipt(null);
    setDuplicates(null);
    setDraft(current => ({ ...current, sku: '', quantity: 1, price: '', confirmed: false }));
  }

  let item, error;
  try { item = buildAceItem({ ...draft, confirmed: true }, prices); }
  catch (e) { error = e.message; }

  async function assignSku() {
    setBusy(true);
    try { change('sku', await generateSku()); }
    catch (e) { setMessage(e.message); }
    finally { setBusy(false); }
  }

  async function save(action = 'check', existingId = null) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const candidate = buildAceItem(draft, prices);
      if (candidate.final_price === null) throw new Error('Enter a manual selling price for this material and condition.');
      const candidateSignature = JSON.stringify(candidate);
      const retry = requestId.current?.candidateSignature === candidateSignature;
      if (retry) existingId = requestId.current.existingId;
      if (action === 'check' && !retry) {
        const { data, error } = await supabase.from('items').select('*')
          .eq('ace_details', candidate.ace_details).eq('final_price', candidate.final_price)
          .eq('subject', candidate.subject).eq('grade_level', candidate.grade_level)
          .eq('edition', candidate.edition).eq('condition', candidate.condition).in('status', ['Available', 'Hold']);
        if (error) throw error;
        if (data.length) { setDuplicates(data); return; }
      }
      if (!retry) {
        if (photo && uploadedPhoto.current?.file !== photo.file) {
          uploadedPhoto.current = { file: photo.file, url: await uploadPhoto(photo.file) };
        }
        requestId.current = {
          candidateSignature, existingId, id: crypto.randomUUID(),
          payload: { ...candidate, image_url: uploadedPhoto.current?.url || '' },
        };
      }
      const { data, error } = await supabase.rpc('receive_ace_intake', {
        p_item: requestId.current.payload, p_quantity: candidate.quantity,
        p_existing_id: existingId, p_request_id: requestId.current.id,
      });
      if (error) throw error;
      setReceipt({ item: data, synced: false });
      setDuplicates(null);
      await finishSync(data);
    } catch (e) { setMessage(e.message); }
    finally { lock.current = false; setBusy(false); }
  }

  function print(saved) {
    try { onPrint(saved); }
    catch (e) { setMessage('Inventory saved. Sticker could not be created: ' + e.message + '. Use Print Sticker to retry.'); }
  }

  async function finishSync(saved) {
    try { await syncSquare(saved); }
    catch (e) {
      setMessage('Inventory saved. Square sync needs retry: ' + e.message + '. Do not re-enter these sets.');
      return;
    }
    setReceipt({ item: saved, synced: true });
    setLastSaved(saved);
    setMessage(saved.received_quantity + ' x ' + saved.title + ' added to Processing. SKU: ' + saved.sku + '. Sticker PDF created, one sticker per sellable set or item.');
    print(saved);
    await onSaved();
    if (continueNext.current) next();
  }

  const select = (label, key, options) => <label>{label}<select value={draft[key]} onChange={e => change(key, e.target.value)}>
    {options.map(value => <option key={value} value={value}>{value}</option>)}
  </select></label>;

  return <section className="card ace-intake" aria-labelledby="ace-intake-heading">
    <div className="ace-header"><div>
      <h2 id="ace-intake-heading" ref={heading} tabIndex={-1}>ACE PACE Intake</h2>
      <p className="helper-text">One listing, photo, SKU and sticker for the whole set.</p>
    </div><button className="secondary" disabled={busy} type="button" onClick={onClose}>Back to Book Intake</button></div>
    {message && <p role="status" className="ace-status">{message}</p>}
    {lastSaved && <div className="intake-actions"><button className="secondary" type="button" onClick={() => print(lastSaved)}>Print Sticker{lastSaved.received_quantity > 1 ? 's' : ''} - {lastSaved.sku}</button></div>}

    {receipt ? <section className="ace-receipt">
      <h3>{receipt.item.title}</h3><p><strong>SKU: {receipt.item.sku}</strong></p>
      {receipt.item.image_url && <img className="ace-photo-preview" src={receipt.item.image_url} alt="Saved ACE listing" />}
      {!receipt.synced ? <button className="primary" disabled={busy} type="button" onClick={async () => {
        setBusy(true); try { await finishSync(receipt.item); } finally { setBusy(false); }
      }}>Retry Square Sync</button> : <div className="intake-actions">
        <button className="primary" type="button" onClick={next}>Add Another Listing</button>
        <button className="secondary" type="button" onClick={() => {
          next(); setDraft(current => ({ ...current, materialType: 'Score Key', numbers: [current.numbers[0]], confirmed: false }));
        }}>Add Separately Priced Score Key</button>
      </div>}
    </section> : <form onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset className="ace-fields" disabled={busy}>
        <div className="ace-grid">
          {select('Subject', 'subject', ACE_SUBJECTS)}
          <label>Grade / Level<select value={draft.custom ? 'custom' : draft.level} onChange={e => {
            if (e.target.value === 'custom') change('custom', true);
            else {
              const level = e.target.value;
              setDraft(current => ({ ...current, custom: false, level, numbers: aceNumbersForLevel(level), confirmed: false, expectedCount: 12 }));
              setDuplicates(null); requestId.current = null;
            }
          }}>{Array.from({ length: 12 }, (_, i) => <option key={i} value={String(i + 1)}>Level {i + 1}</option>)}<option value="custom">Custom course / numbering</option></select></label>
          {select('Material type', 'materialType', ACE_TYPES)}
          {select('Condition', 'condition', ['Like New / Unused', 'Good', 'Fair', 'Poor'])}
          {select('Writing present', 'writing', ['No writing', 'Some writing', 'Completed', 'Unknown'])}
          <label>Number of identical sets / items<input type="number" required min="1" step="1" value={draft.quantity} onChange={e => change('quantity', Number(e.target.value))} /></label>
        </div>
        <div className="intake-actions ace-set-options" aria-label="Set type">
          <button className={draft.materialType === 'Complete subject set' ? 'primary' : 'secondary'} type="button" onClick={() => {
            setDraft(current => ({ ...current, materialType: 'Complete subject set', numbers: aceNumbersForLevel(current.level), confirmed: false }));
            setDuplicates(null); requestId.current = null;
          }}>Complete Set</button>
          <button className={draft.materialType === 'Partial subject set' ? 'primary' : 'secondary'} type="button" onClick={() => change('materialType', 'Partial subject set')}>Partial Set</button>
        </div>
        <p className="helper-text">Levels are approximate grade equivalents.</p>
        {draft.custom ? <div className="ace-grid">
          <label>Course / level<input value={draft.level} onChange={e => change('level', e.target.value)} /></label>
          <label>Included PACE numbers<input value={draft.customNumbers} onChange={e => change('customNumbers', e.target.value)} placeholder="e.g. 1-12 or 1, 2, 4" /></label>
          <label>Expected PACE count<input type="number" min="1" value={draft.expectedCount} onChange={e => change('expectedCount', Number(e.target.value))} /></label>
        </div> : /subject set$/.test(draft.materialType) ? <div className="ace-numbers">{aceNumbersForLevel(draft.level).map(number => <label className="ace-check" key={number}>
          <input type="checkbox" checked={draft.numbers.includes(number)} onChange={e => {
            setDraft(current => ({ ...current, materialType: 'Partial subject set', confirmed: false, numbers: e.target.checked ? [...current.numbers, number] : current.numbers.filter(n => n !== number) }));
            setDuplicates(null); requestId.current = null;
          }} />{number}</label>)}</div> : <label>PACE number<input type="number" min="1" value={draft.numbers.length === 1 ? draft.numbers[0] : ''} onChange={e => {
          const number = Number(e.target.value);
          setDraft(current => ({ ...current, numbers: number ? [number] : [], level: String(aceLevelForNumber(number) || current.level) }));
          setDuplicates(null); requestId.current = null;
        }} /></label>}
        {draft.materialType === 'Complete subject set' && <label className="ace-check"><input type="checkbox" checked={draft.confirmed} onChange={e => change('confirmed', e.target.checked)} />All {draft.expectedCount} student PACEs are present</label>}
        {/subject set$/.test(draft.materialType) && <div className="ace-supporting-materials">
          <label className="ace-check"><input type="checkbox" checked={draft.tests} onChange={e => change('tests', e.target.checked)} />Include tests in this bundle</label>
          <label className="ace-check"><input type="checkbox" checked={draft.keys} onChange={e => change('keys', e.target.checked)} />Include Score Keys in this bundle</label>
          {(draft.tests || draft.keys) && select('Tests / keys compatibility', 'compatibility', ['Unknown', 'Confirmed matching', 'Not matching'])}
        </div>}

        <ListingPhotoCapture preview={photo?.preview} onPhoto={choosePhoto} disabled={busy} />
        <div className="ace-sku-field"><label htmlFor="ace-sku">Listing SKU</label>
          <div className="ace-sku-controls"><input id="ace-sku" value={draft.sku || ''} onChange={e => change('sku', e.target.value)} placeholder="Assign automatically when saved" maxLength={64} />
            <button className="secondary" type="button" onClick={assignSku}>Generate SKU</button></div>
          <p className="helper-text">Enter your own SKU or leave blank for the next IL HRC number. The whole set shares this SKU.</p>
        </div>
        <section className="ace-listing-preview" aria-label="Listing preview">
          <h3>{item?.title || 'Listing preview'}</h3><p>{item?.notes}</p>
          <div className="ace-grid"><div><p>Suggested price</p><strong>{item?.suggested_price == null ? 'Manual pricing required' : '$' + item.suggested_price.toFixed(2)}</strong><p className="helper-text">Per entire set or individual item</p></div>
            <label>Final selling price ($)<input type="number" min="0" step="0.01" placeholder={item?.suggested_price ?? 'Required'} value={draft.price} onChange={e => change('price', e.target.value)} /></label></div>
          <p><strong>{draft.quantity} sellable set(s) / item(s) = {draft.quantity} sticker(s).</strong> Student PACEs inside a set share one sticker.</p>
        </section>
        {error && <p role="alert" className="warning-text">{error}</p>}
        {duplicates ? <section className="ace-duplicates"><h3>Matching listing found</h3>
          {duplicates.map(existing => <div key={existing.id}><p>{existing.title} - {existing.sku} - quantity {existing.quantity}</p>
            <button className="secondary" type="button" disabled={!!item?.sku && item.sku !== existing.sku?.toUpperCase()} onClick={() => save('increase', String(existing.id))}>Increase Existing Quantity</button>
            {!!item?.sku && item.sku !== existing.sku?.toUpperCase() && <p className="helper-text">Create a separate listing to use your new SKU, or clear the SKU field to add to {existing.sku}.</p>}
          </div>)}<button className="primary" type="button" onClick={() => save('separate')}>Create Separate Listing</button>
        </section> : <div className="intake-save-bar">
          <button className="primary" type="submit" disabled={!ready || !!error} onClick={() => { continueNext.current = false; }}>{busy ? 'Saving...' : 'Save & Print Sticker'}</button>
          <button className="secondary" type="submit" disabled={!ready || !!error} onClick={() => { continueNext.current = true; }}>Save &amp; Add Another</button>
        </div>}
      </fieldset>
    </form>}
  </section>;
}
