import {useEffect, useRef, useState} from 'react';
import {supabase} from './supabaseClient';
import {ACE_PRICES, ACE_SUBJECTS, ACE_TYPES, aceNumbersForLevel, aceLevelForNumber, buildAceItem, newAceDraft} from './acePace';

export function AcePricingSettings() {
  const [prices,setPrices]=useState(ACE_PRICES), [message,setMessage]=useState(''), [ready,setReady]=useState(false);
  useEffect(()=>{supabase.from('ace_pricing').select('prices').eq('id',1).single().then(({data,error})=>{if(error) setMessage(error.message); else {setPrices(data.prices);setReady(true);}});},[]);
  async function save(event) {
    event.preventDefault();
    const {error}=await supabase.from('ace_pricing').update({prices}).eq('id',1);
    setMessage(error?error.message:'ACE prices saved. Existing listings retain their selling prices.');
  }
  const labels={complete:'Complete unused 12-PACE set',older:'Older-edition complete unused set',individual:'Individual unused PACE',partial:'Partial set, per PACE',scoreKey:'Individual Score Key',test:'Individual PACE Test'};
  return <form className="options-section" onSubmit={save}><h3>ACE resale pricing</h3><div className="ace-grid">{Object.entries(labels).map(([key,label])=><label key={key}>{label}<input required type="number" min="0" step="0.01" value={prices[key]} onChange={e=>setPrices({...prices,[key]:Number(e.target.value)})}/></label>)}</div><button disabled={!ready} type="submit">Save ACE Prices</button><p role="status">{message}</p></form>;
}

export default function AcePaceIntake({onClose,onSaved,syncSquare}) {
  const [draft,setDraft]=useState(newAceDraft), [prices,setPrices]=useState(ACE_PRICES), [ready,setReady]=useState(false);
  const [busy,setBusy]=useState(false), [message,setMessage]=useState(''), [duplicates,setDuplicates]=useState(null);
  const [receipt,setReceipt]=useState(null);
  const lock=useRef(false);
  const requestId=useRef(null);
  const continueNext=useRef(false);
  const dialog=useRef(null);
  useEffect(()=>{dialog.current?.showModal();supabase.from('ace_pricing').select('prices').eq('id',1).single().then(({data,error})=>{if(error)setMessage(`ACE setup is unavailable: ${error.message}`);else {setPrices(data.prices);setReady(true);}});},[]);
  const change=(key,value)=>{setDraft(d=>({...d,[key]:value}));setDuplicates(null);setMessage('');requestId.current=null;};
  let item,error;
  try {item=buildAceItem({...draft,confirmed:true},prices);} catch(e){error=e.message;}
  function next() {requestId.current=null;setReceipt(null);setDuplicates(null);setDraft(d=>({...d,quantity:1,price:'',confirmed:false}));}
  async function save(action='check',existingId=null) {
    if(lock.current)return;
    lock.current=true;setBusy(true);setMessage('');
    try {
      const candidate=buildAceItem(draft,prices);
      if(candidate.final_price===null)throw new Error('Enter a manual selling price for this material and condition.');
      const candidateSignature=JSON.stringify(candidate);
      const retry=requestId.current?.candidateSignature===candidateSignature;
      if(retry)existingId=requestId.current.existingId;
      if(action==='check'&&!retry) {
        const {data,error}=await supabase.from('items').select('*').eq('ace_details',candidate.ace_details).eq('final_price',candidate.final_price).eq('subject',candidate.subject).eq('grade_level',candidate.grade_level).eq('edition',candidate.edition).eq('condition',candidate.condition).in('status',['Available','Hold']);
        if(error)throw error;
        if(data.length){setDuplicates(data);return;}
      }
      if(!retry)requestId.current={candidateSignature,existingId,id:crypto.randomUUID()};
      const {data,error}=await supabase.rpc('receive_ace_intake',{p_item:candidate,p_quantity:candidate.quantity,p_existing_id:existingId,p_request_id:requestId.current.id});
      if(error)throw error;
      // Remember the receipt before network sync: retrying Square must never receive stock twice.
      setReceipt({item:data,synced:false});setDuplicates(null);
      await finishSync(data);
    }catch(e){setMessage(e.message);}finally{lock.current=false;setBusy(false);}
  }
  async function finishSync(saved) {
    try {await syncSquare(saved);setReceipt({item:saved,synced:true});setMessage(`${saved.received_quantity} × ${saved.title} added to Processing. Labels are queued.`);await onSaved();if(continueNext.current)next();}
    catch(e){setMessage(`Inventory saved. Square sync needs retry: ${e.message}. Do not re-enter these sets.`);}
  }
  const select=(label,key,options)=><label>{label}<select value={draft[key]} onChange={e=>change(key,e.target.value)}>{options.map(v=><option key={v} value={v}>{v}</option>)}</select></label>;
  return <dialog ref={dialog} className="ace-dialog" onCancel={e=>{if(busy)e.preventDefault();else onClose();}}><div className="ace-header"><h2>ACE PACE Intake</h2><button disabled={busy} type="button" onClick={onClose}>Close</button></div><p>Curriculum › ACE / School of Tomorrow · One sellable item per set.</p>
    {receipt ? <section><h3>{receipt.item.title}</h3><p role="status">{message}</p>{!receipt.synced?<button disabled={busy} onClick={async()=>{setBusy(true);try{await finishSync(receipt.item);}finally{setBusy(false);}}}>Retry Square Sync</button>:<><button onClick={next}>Save &amp; Add Another</button><button onClick={()=>{next();setDraft(d=>({...d,materialType:'Score Key',numbers:[d.numbers[0]],confirmed:false}));}}>Add Separately Priced Score Key</button></>}</section>:
    <form onSubmit={e=>{e.preventDefault();save();}}><fieldset disabled={busy}><div className="ace-grid">
      {select('Subject','subject',ACE_SUBJECTS)}<label>Grade / Level<input list="ace-levels" value={draft.level} onChange={e=>{const level=e.target.value;setDraft(d=>({...d,level,numbers:aceNumbersForLevel(level),confirmed:false,expectedCount:12}));setDuplicates(null);}}/><datalist id="ace-levels">{Array.from({length:12},(_,i)=><option key={i} value={i+1}/>)}</datalist></label>
      {select('Material type','materialType',ACE_TYPES)}{select('Condition','condition',['Like New / Unused','Good','Fair','Poor'])}
      <label>Edition<input list="ace-editions" required value={draft.edition} onChange={e=>change('edition',e.target.value)}/><datalist id="ace-editions"><option>Unknown</option><option>Mixed editions</option><option>Older / unspecified</option></datalist></label>
      {select('Writing present','writing',['No writing','Some writing','Completed','Unknown'])}
      <label>Number of identical sets / items<input type="number" required min="1" step="1" value={draft.quantity} onChange={e=>change('quantity',Number(e.target.value))}/></label>
    </div><p>Levels are approximate grade equivalents. Override the level or numbering for specialized courses.</p>
    <label><input type="checkbox" checked={draft.older} onChange={e=>change('older',e.target.checked)}/> Older-edition pricing category ($ {Number(prices.older).toFixed(2)} per complete unused set)</label>
    <div className="ace-actions"><button type="button" onClick={()=>{setDraft(d=>({...d,materialType:'Complete subject set',numbers:aceNumbersForLevel(d.level),confirmed:false}));setDuplicates(null);}}>Complete Set</button><button type="button" onClick={()=>change('materialType','Partial subject set')}>Partial Set</button></div>
    <label><input type="checkbox" checked={draft.custom} onChange={e=>change('custom',e.target.checked)}/> Custom course / numbering</label>
    {draft.custom?<><label>Included numbers (comma-separated or ranges)<input value={draft.customNumbers} onChange={e=>change('customNumbers',e.target.value)} placeholder="e.g. 1–12"/></label><label>Expected student PACE count<input type="number" min="1" value={draft.expectedCount} onChange={e=>change('expectedCount',Number(e.target.value))}/></label></>:
    /subject set$/.test(draft.materialType)?<div className="ace-numbers">{aceNumbersForLevel(draft.level).map(n=><label key={n}><input type="checkbox" checked={draft.numbers.includes(n)} onChange={e=>{setDraft(d=>({...d,materialType:'Partial subject set',confirmed:false,numbers:e.target.checked?[...d.numbers,n]:d.numbers.filter(x=>x!==n)}));setDuplicates(null);}}/>{n}</label>)}</div>:
    <label>PACE number<input type="number" min="1" value={draft.numbers.length===1?draft.numbers[0]:''} onChange={e=>{const n=Number(e.target.value);setDraft(d=>({...d,numbers:n?[n]:[],level:String(aceLevelForNumber(n)||d.level)}));setDuplicates(null);}}/></label>}
    {draft.materialType==='Complete subject set'&&<label><input type="checkbox" checked={draft.confirmed} onChange={e=>change('confirmed',e.target.checked)}/> All {draft.expectedCount} student PACEs are present</label>}
    {/subject set$/.test(draft.materialType)&&<><label><input type="checkbox" checked={draft.tests} onChange={e=>change('tests',e.target.checked)}/> Include separate tests in this bundle</label><label><input type="checkbox" checked={draft.keys} onChange={e=>change('keys',e.target.checked)}/> Include Score Keys in this bundle</label>{(draft.tests||draft.keys)&&select('Edition compatibility of included tests / keys','compatibility',['Unknown','Confirmed matching','Not matching'])}<p>Use individual intake for tests or keys sold separately. Numbers alone do not confirm compatibility.</p></>}
    <section className="card"><h3>{item?.title||'Listing preview'}</h3><p>{item?.notes}</p><p>Suggested resale price: {item?.suggested_price==null?'Manual pricing required':`$${item.suggested_price.toFixed(2)}`} per { /subject set$/.test(draft.materialType)?'entire bundle':'item'}</p><label>Final selling price ($)<input type="number" min="0" step="0.01" placeholder={item?.suggested_price??'Required'} value={draft.price} onChange={e=>change('price',e.target.value)}/></label><strong>Final: {item?.final_price==null?'Enter price':`$${item.final_price.toFixed(2)}`} × {draft.quantity}</strong></section>
    {error&&<p role="alert">{error}</p>}<p role="status">{message}</p>
    {duplicates?<section><h3>Exact matching listing found</h3>{duplicates.map(d=><div key={d.id}><p>{d.title} · {d.sku} · quantity {d.quantity}</p><button type="button" onClick={()=>save('increase',String(d.id))}>Increase Existing Quantity</button></div>)}<button type="button" onClick={()=>save('separate')}>Create Separate Listing</button></section>:<div className="ace-actions"><button type="submit" disabled={!ready||!!error} onClick={()=>{continueNext.current=false;}}>{busy?'Saving…':'Add to Inventory'}</button><button type="submit" disabled={!ready||!!error} onClick={()=>{continueNext.current=true;}}>Save &amp; Add Another</button></div>}
    </fieldset></form>}
  </dialog>;
}
