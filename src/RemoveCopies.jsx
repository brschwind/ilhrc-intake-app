import { useState } from "react";

export default function RemoveCopies({ supabase, itemId, onRemoved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data, error: lookupError } = await supabase.from("inventory_by_location")
        .select("location_id, inventory_locations!inner(code, active)")
        .eq("item_id", String(itemId))
        .eq("inventory_locations.active", true)
        .gt("quantity", 0)
        .order("location_id");
      if (lookupError) throw lookupError;

      const source = data.find((row) => row.inventory_locations.code === "PROCESSING")
        || data.find((row) => row.inventory_locations.code === "UNVERIFIED_LEGACY")
        || data[0];
      if (!source) throw new Error("This SKU has no copies to remove.");

      const { error: removalError } = await supabase.rpc("adjust_inventory_at_location", {
        p_item_id: String(itemId),
        p_location_id: source.location_id,
        p_quantity_delta: -1,
        p_action_type: "removal",
        p_notes: "Inventory count correction",
        p_scan_session_id: null,
      });
      if (removalError) throw removalError;
      onRemoved();
    } catch (error) {
      setError(error.message || "Could not remove a copy.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={remove}>
        {busy ? "Removing…" : "Remove One Copy"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
