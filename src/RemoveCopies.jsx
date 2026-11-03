import React, { useEffect, useState } from "react";

export default function RemoveCopies({ supabase, itemId, onRemoved }) {
  const [rows, setRows] = useState([]);
  const [location, setLocation] = useState("");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      const { data, error } = await supabase.from("inventory_by_location")
        .select("location_id, quantity, inventory_locations!inner(code, active)")
        .eq("item_id", String(itemId)).eq("inventory_locations.active", true).gt("quantity", 0);
      if (!active) return;
      if (error) setError(error.message);
      else {
        setRows(data);
        if (data.length === 1) setLocation(data[0].location_id);
      }
    }
    load();
    return () => { active = false; };
  }, [supabase, itemId]);

  const limit = rows.find((row) => row.location_id === location)?.quantity || 0;
  const amount = Number(count);
  const valid = Number.isInteger(amount) && amount > 0 && amount <= limit;

  async function remove() {
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase.rpc("adjust_inventory_at_location", {
        p_item_id: String(itemId), p_location_id: location,
        p_quantity_delta: -amount, p_action_type: "removal",
        p_notes: "Inventory count correction", p_scan_session_id: null,
      });
      if (error) throw error;
      onRemoved();
    } catch (error) {
      setError(error.message || "Could not remove copies.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset disabled={busy}>
      <legend>Remove Copies</legend>
      <label>
        Stock location
        <select value={location} onChange={(event) => setLocation(event.target.value)}>
          <option value="">Select a location</option>
          {rows.map((row) => (
            <option key={row.location_id} value={row.location_id}>
              {row.inventory_locations.code} ({row.quantity} copies)
            </option>
          ))}
        </select>
      </label>
      <label>
        Copies to remove
        <input type="number" min="1" max={limit || undefined} step="1"
          value={count} onChange={(event) => setCount(event.target.value)} />
      </label>
      <p className="helper-text">Applies immediately without saving other edits. The SKU stays in inventory.</p>
      <button type="button" disabled={!valid || busy} onClick={remove}>Remove Copies</button>
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
