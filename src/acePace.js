export const ACE_SUBJECTS = ['Math','English','Science','Social Studies','Word Building','Literature and Creative Writing','Bible','Electives','Other'];
export const ACE_TYPES = ['Complete subject set','Partial subject set','Student PACE','PACE Test','Score Key','Test Key','Teacher Manual','Other ACE resource'];
export const ACE_PRICES = { complete:8, older:5, individual:0.75, partial:0.50, scoreKey:1, test:0.25 };
export const aceNumbersForLevel = level => Number.isInteger(Number(level)) && level >= 1 && level <= 12 ? Array.from({length:12}, (_,i)=>1001+(Number(level)-1)*12+i) : [];
export const aceLevelForNumber = number => /^\d+$/.test(String(number)) && number >= 1001 && number <= 1144 ? Math.floor((Number(number)-1001)/12)+1 : '';
export function parseAceNumbers(text) {
  const numbers = [];
  for (const token of String(text).trim().split(/[,\s]+/).filter(Boolean)) {
    const match = token.match(/^(\d+)(?:[-–](\d+))?$/);
    if (!match) throw new Error('Use numbers or ranges separated by commas.');
    const start=Number(match[1]), end=Number(match[2] || start);
    if (start < 1 || end < start || end-start > 200) throw new Error('Invalid PACE range.');
    for(let n=start;n<=end;n++) numbers.push(n);
  }
  return [...new Set(numbers)].sort((a,b)=>a-b);
}
export const newAceDraft = () => ({subject:'English',level:'4',edition:'Unknown',condition:'Like New / Unused',writing:'No writing',materialType:'Complete subject set',older:false,custom:false,numbers:aceNumbersForLevel(4),customNumbers:'',expectedCount:12,confirmed:false,tests:false,keys:false,compatibility:'Unknown',quantity:1,price:'',sku:''});
export function buildAceItem(draft, prices=ACE_PRICES) {
  const sku = String(draft.sku || '').trim().toUpperCase();
  if (sku && !/^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(sku)) throw new Error('Use 1-64 letters, numbers, dots, slashes, underscores or hyphens for the SKU.');
  const numbers = draft.custom ? parseAceNumbers(draft.customNumbers) : [...new Set(draft.numbers)].sort((a,b)=>a-b);
  const set = /subject set$/.test(draft.materialType);
  const complete = draft.materialType === 'Complete subject set';
  if (!ACE_TYPES.includes(draft.materialType)) throw new Error('Choose a material type.');
  if (!draft.subject.trim() || !draft.edition.trim()) throw new Error('Subject and edition are required.');
  if (!Number.isInteger(Number(draft.quantity)) || draft.quantity < 1) throw new Error('Enter a positive whole quantity.');
  if ((set || ['Student PACE','PACE Test','Score Key','Test Key'].includes(draft.materialType)) && !numbers.length) throw new Error('Select at least one PACE number.');
  if (complete && (!draft.confirmed || numbers.length !== Number(draft.expectedCount))) throw new Error('Confirm every expected student PACE is present.');
  if (complete && !draft.custom && numbers.some(n=>!aceNumbersForLevel(draft.level).includes(n))) throw new Error('PACE numbers do not match this level. Use custom numbering to override.');
  if (['Student PACE','PACE Test','Score Key','Test Key'].includes(draft.materialType) && numbers.length !== 1) throw new Error('Individual intake requires one PACE number.');
  const unused = draft.condition === 'Like New / Unused' && draft.writing === 'No writing';
  let suggested = null;
  if(complete && unused && numbers.length===12) suggested = Number(prices[draft.older?'older':'complete']);
  else if(draft.materialType==='Partial subject set') suggested = numbers.length*Number(prices.partial);
  else if(draft.materialType==='Student PACE' && unused) suggested = Number(prices.individual);
  else if(draft.materialType==='PACE Test') suggested = Number(prices.test);
  else if(draft.materialType==='Score Key') suggested = Number(prices.scoreKey);
  if(suggested !== null) suggested = Math.round(suggested*100)/100;
  const price = draft.price === '' ? suggested : Number(draft.price);
  if(price !== null && (!Number.isFinite(price) || price < 0)) throw new Error('Enter a valid selling price.');
  const missing = (draft.custom ? [] : aceNumbersForLevel(draft.level)).filter(n=>!numbers.includes(n));
  const range = numbers.length ? `${numbers[0]}${numbers.length>1?`–${numbers.at(-1)}`:''}` : '';
  const suffix = complete ? `PACEs ${range} — Complete Set` : draft.materialType==='Partial subject set' ? `${numbers.length} PACEs${missing.length?` (Missing ${missing.join(', ')})`:''}` : `${draft.materialType}${range?` ${range}`:''}`;
  const title = `ACE ${draft.subject} — ${draft.level?`Level ${draft.level} — `:''}${suffix}${draft.edition==='Mixed editions'?' — Mixed Editions':''}`;
  const components = [draft.tests?'tests':null,draft.keys?'Score Keys':null].filter(Boolean);
  const notes = `${complete?'Complete':set?'Partial':'Individual'} ${draft.materialType}. Included PACE numbers: ${numbers.join(', ') || 'Not specified'}.${missing.length?` Missing: ${missing.join(', ')}.`:''} ${draft.level?`Approximate level ${draft.level}; specialized courses may differ.`:''} Condition: ${draft.condition}. ${draft.writing}. Edition: ${draft.edition}. ${components.length?`Bundled ${components.join(' and ')}; edition compatibility: ${draft.compatibility}.`:'Student bundles include no separate tests or keys.'} Price is for one ${set?'entire bundle':'item'}.`;
  return {...(sku ? {sku} : {}),title,notes,category:set?'Bundle / Kit':draft.materialType==='Score Key'||draft.materialType==='Test Key'?'Answer Key':draft.materialType==='Teacher Manual'?'Teacher Guide':'Workbook & Tests',primary_category:'Curriculum',subcategory:'ACE / School of Tomorrow',curriculum:'ACE',publisher:'ACE / School of Tomorrow',subject:draft.subject,grade_level:String(draft.level),edition:draft.edition,condition:draft.condition,final_price:price,suggested_price:suggested,quantity:Number(draft.quantity),item_type:'individual',ace_details:{subject:draft.subject,level:String(draft.level),numbers,edition:draft.edition,condition:draft.condition,writing:draft.writing,materialType:draft.materialType,complete,tests:draft.tests,keys:draft.keys,compatibility:components.length?draft.compatibility:'Unknown',older:draft.older,expectedCount:Number(draft.expectedCount)}};
}
export function aceMatchesFilters(item, filters) {
  if(!Object.values(filters).some(Boolean)) return true;
  const a=item.ace_details;
  if(!a) return false;
  return Object.entries(filters).every(([key,value])=>!value || key==='ace' || (key==='number'?a.numbers.includes(Number(value)):key==='complete'?a.materialType===(value==='true'?'Complete subject set':'Partial subject set'):String(a[key])===value));
}

export function aceStickerItem(saved) {
  const quantity = Number(saved.received_quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Invalid sticker quantity.');
  return { ...saved, label_quantity: quantity };
}
