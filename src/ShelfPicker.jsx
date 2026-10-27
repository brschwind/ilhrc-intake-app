import { useId, useState } from 'react';
import { shelfGroup, shelfGroups } from './shelfPicker.js';

export default function ShelfPicker({ locations, value, onChange, disabled = false, label }) {
  const id = useId();
  const [pendingGroup, setPendingGroup] = useState('');
  const selected = locations.find(location => location.id === value);
  const group = selected ? shelfGroup(selected) : pendingGroup;
  const choices = locations.filter(location => shelfGroup(location) === group)
    .sort((a,b) => a.code.localeCompare(b.code,undefined,{numeric:true}));
  return <div className="shelf-picker" role="group" aria-label={label}>
    <strong>{label}</strong>
    <div className="shelf-picker-fields">
      <label htmlFor={id+'-letter'}>Letter
        <select id={id+'-letter'} value={group} disabled={disabled} onChange={event => {
          setPendingGroup(event.target.value); onChange('');
        }}>
          <option value="">Choose letter</option>
          {shelfGroups(locations).map(letter => <option key={letter} value={letter}>{letter === 'other' ? 'Other locations' : letter}</option>)}
        </select>
      </label>
      <label htmlFor={id+'-number'}>{group === 'other' ? 'Location' : 'Number'}
        <select id={id+'-number'} value={value} disabled={disabled || !group} onChange={event => onChange(event.target.value)}>
          <option value="">{group === 'other' ? 'Choose location' : 'Choose number'}</option>
          {choices.map(location => <option key={location.id} value={location.id}>{group === 'other' ? location.display_name : location.code.replace(/^[A-Z]+/,'')}</option>)}
        </select>
      </label>
    </div>
  </div>;
}
