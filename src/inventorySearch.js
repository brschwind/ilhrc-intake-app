export async function loadCompleteInventory(client, table, columns, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const {data,error} = await client.from(table).select(columns)
      .order('created_at',{ascending:false}).order('id',{ascending:true})
      .range(offset,offset+pageSize-1);
    if(error) return {data:null,error};
    rows.push(...(data || []));
    if((data || []).length<pageSize) return {data:rows,error:null};
  }
}
const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function inventoryMatchesSearch(item, query) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  const text = normalize([
    item.title,item.author,item.curriculum,item.publisher,item.subject,item.grade_level,
    item.isbn,item.publisher_barcode,item.publisher_item_number,item.sku,item.category,
    ...(item.bundle_contents || []),
    ...[item.isbn,item.publisher_barcode,item.publisher_item_number,item.sku].map(value=>String(value||'').replace(/[^a-zA-Z0-9]/g,'')),
  ].filter(Boolean).join(' '));
  return words.every(word=>text.includes(word));
}
