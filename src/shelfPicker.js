export function shelfGroup(location) {
  return location.location_type === 'shelf' ? location.code.match(/^([A-Z]+)\d+$/)?.[1] || 'other' : 'other';
}
export function shelfGroups(locations) {
  return [...new Set(locations.map(shelfGroup))].sort((a,b)=>a==='other'?1:b==='other'?-1:a.localeCompare(b,undefined,{numeric:true}));
}
