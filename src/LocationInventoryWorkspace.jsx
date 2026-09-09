import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { classifyScan, totalLocationQuantity } from "./locationInventory.js";

const MODES = [
  { id: "intake", label: "Intake", help: "Add each scanned copy to Processing." },
  { id: "shelving", label: "Shelving", help: "Approve a shelf for each processed copy." },
  { id: "shelf_audit", label: "Shelf Audit", help: "Count a shelf first, then reconcile it." },
];

function eventId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function verificationLabel(location) {
  if (location.location_type !== "shelf") return "Operational";
  if (!location.last_verified_at) return "Never audited";
  const age = Date.now() - new Date(location.last_verified_at).getTime();
  return age > 1000 * 60 * 60 * 24 * 90 ? "Needs audit" : "Verified";
}

export default function LocationInventoryWorkspace({ items = [], onInventoryChanged }) {
  const [mode, setMode] = useState("intake");
  const [locations, setLocations] = useState([]);
  const [stock, setStock] = useState([]);
  const [events, setEvents] = useState([]);
  const [session, setSession] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [recent, setRecent] = useState([]);
  const [pending, setPending] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [unknownScan, setUnknownScan] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [auditReview, setAuditReview] = useState([]);
  const [search, setSearch] = useState("");
  const [moveDraft, setMoveDraft] = useState({ itemId: "", from: "", to: "", quantity: 1 });
  const [adjustDraft, setAdjustDraft] = useState({ itemId: "", location: "", delta: 1, notes: "" });
  const [newShelf, setNewShelf] = useState({ code: "", displayName: "" });
  const inputRef = useRef(null);

  const selectedLocation = locations.find((location) => location.id === locationId);
  const processingLocation = locations.find((location) => location.code === "PROCESSING");
  const awaitingShelving = stock
    .filter((row) => row.location_id === processingLocation?.id)
    .reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  const itemById = useMemo(
    () => Object.fromEntries(items.map((item) => [String(item.id), item])),
    [items]
  );
  const locationById = useMemo(
    () => Object.fromEntries(locations.map((location) => [location.id, location])),
    [locations]
  );

  async function loadWorkspace() {
    const [locationsResult, stockResult, eventsResult] = await Promise.all([
      supabase.from("inventory_locations").select("*").eq("active", true).order("code"),
      supabase.from("inventory_location_details").select("*").gt("quantity", 0),
      supabase.from("inventory_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    const error = locationsResult.error || stockResult.error || eventsResult.error;
    if (error) {
      setMessage(`Location inventory is not ready: ${error.message}`);
      return;
    }
    setLocations(locationsResult.data || []);
    setStock(stockResult.data || []);
    setEvents(eventsResult.data || []);
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("inventory_locations").select("*").eq("active", true).order("code"),
      supabase.from("inventory_location_details").select("*").gt("quantity", 0),
      supabase.from("inventory_events").select("*").order("created_at", { ascending: false }).limit(20),
    ]).then(([locationsResult, stockResult, eventsResult]) => {
      if (cancelled) return;
      const error = locationsResult.error || stockResult.error || eventsResult.error;
      if (error) setMessage(`Location inventory is not ready: ${error.message}`);
      else {
        setLocations(locationsResult.data || []);
        setStock(stockResult.data || []);
        setEvents(eventsResult.data || []);
      }
    }).catch((error) => {
      if (!cancelled) setMessage(error.message || "Location inventory could not be loaded.");
    });
    return () => { cancelled = true; };
  }, []);

  async function refresh() {
    await Promise.all([loadWorkspace(), onInventoryChanged?.()]);
  }

  async function startSession(nextMode = mode, nextLocationId = locationId) {
    if ((nextMode === "shelving" || nextMode === "shelf_audit") && !nextLocationId) {
      throw new Error("Scan or choose a shelf before starting.");
    }
    const { data, error } = await supabase.rpc("start_inventory_scan_session", {
      p_mode: nextMode,
      p_location_id: nextMode === "intake" ? null : nextLocationId,
    });
    if (error) throw error;
    setSession(data);
    setRecent([]);
    setAuditReview([]);
    return data;
  }

  async function lookupItem(raw) {
    const { data, error } = await supabase.rpc("lookup_inventory_scan", { p_scan: raw });
    if (error) throw error;
    if ((data || []).length > 1) throw new Error("More than one listing matches this barcode. Search inventory and resolve the duplicate first.");
    return data?.[0] || null;
  }

  async function recordItemScan(activeSession, item, raw, destination = null, discover = false) {
    const { error } = await supabase.rpc("record_inventory_scan", {
      p_session_id: activeSession.id,
      p_item_id: String(item.id),
      p_raw_scan: raw,
      p_client_event_id: eventId(),
      p_destination_location_id: destination,
      p_discover: discover,
    });
    if (error) throw error;
    setRecent((current) => [{ id: eventId(), item, raw }, ...current].slice(0, 12));
    setMessage(`${item.title || "Untitled item"} scanned successfully.`);
    await refresh();
  }

  async function handleScan(event) {
    event.preventDefault();
    const parsed = classifyScan(scanValue);
    if (!parsed.raw || busy) return;
    setBusy(true);
    setMessage("");
    try {
      if (parsed.kind === "location") {
        const location = locations.find((candidate) => candidate.code === parsed.code);
        if (!location) throw new Error(`Location ${parsed.code} is not active.`);
        if (session?.mode === "shelf_audit" && session.location_id !== location.id) {
          throw new Error("Finish or cancel the current shelf audit before switching shelves.");
        }
        setLocationId(location.id);
        setMessage(`${location.display_name} selected.`);
        return;
      }

      const item = await lookupItem(parsed.raw);
      if (!item) {
        setUnknownScan(parsed.raw);
        setQuickTitle("");
        setMessage("Unknown barcode. Quick Add can create an incomplete catalog record.");
        return;
      }
      const activeSession = session || await startSession();
      if (mode === "shelving") {
        const { data, error } = await supabase.rpc("get_shelving_recommendations", { p_item_id: String(item.id) });
        if (error) throw error;
        setRecommendations(data || []);
        setPending({ item, raw: parsed.raw, session: activeSession });
        setMessage("Review the recommendation, then approve a destination.");
      } else {
        await recordItemScan(activeSession, item, parsed.raw);
      }
    } catch (error) {
      setMessage(error.message || "The scan could not be recorded.");
    } finally {
      setBusy(false);
      setScanValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function approveShelving(destinationId = locationId, discover = false) {
    if (!pending || !destinationId) return;
    setBusy(true);
    try {
      const recommendedId = recommendations[0]?.location_id;
      await recordItemScan(pending.session, pending.item, pending.raw, destinationId, discover);
      if (recommendedId && recommendedId !== destinationId) {
        await supabase.from("inventory_events").insert({
          item_id: String(pending.item.id), to_location_id: destinationId, quantity: 1,
          quantity_delta: 0, action_type: "override", scan_session_id: pending.session.id,
          notes: `Staff chose ${locationById[destinationId]?.code || "another location"} instead of ${locationById[recommendedId]?.code || "the recommendation"}.`,
        });
      }
      setPending(null);
      setRecommendations([]);
    } catch (error) {
      setMessage(error.message || "Shelving could not be completed.");
    } finally { setBusy(false); }
  }

  async function quickAdd() {
    if (!unknownScan || !quickTitle.trim()) return;
    setBusy(true);
    try {
      const { data: sku, error: skuError } = await supabase.rpc("next_inventory_sku", { p_item_type: "individual" });
      if (skuError) throw skuError;
      const looksLikeIsbn = /^\d{9}[\dXx]$|^(978|979)\d{10}$/.test(unknownScan.replace(/[^0-9Xx]/g, ""));
      const { data: item, error } = await supabase.from("items").insert({
        sku, title: quickTitle.trim(), isbn: looksLikeIsbn ? unknownScan : "",
        quantity: 0, status: "Available", public_visible: false,
        needs_catalog_review: true, notes: `Quick added from scan ${unknownScan}`,
      }).select("*").single();
      if (error) throw error;
      const activeSession = session || await startSession();
      const { error: quickAddEventError } = await supabase.from("inventory_events").insert({
        item_id: String(item.id), quantity: 1, quantity_delta: 0,
        action_type: "quick_add", scan_session_id: activeSession.id,
        notes: `Incomplete catalog record created from scan ${unknownScan}.`,
      });
      if (quickAddEventError) throw quickAddEventError;
      if (mode === "shelving") {
        const needsReview = locations.find((location) => location.code === "NEEDS_REVIEW");
        setRecommendations(needsReview ? [{
          location_id: needsReview.id, code: needsReview.code,
          reason: "New catalog record; staff should approve a shelf or use Needs Review.",
        }] : []);
        setPending({ item, raw: unknownScan, session: activeSession });
      } else {
        await recordItemScan(activeSession, item, unknownScan);
      }
      setUnknownScan("");
      setQuickTitle("");
      setMessage(`${item.title} was quick-added and scanned.`);
    } catch (error) { setMessage(error.message || "Quick Add failed."); }
    finally { setBusy(false); }
  }

  async function undoLastScan() {
    if (!session) return;
    setBusy(true);
    const { error } = await supabase.rpc("undo_last_inventory_scan", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else {
      setRecent((current) => current.slice(1));
      setMessage("Most recent scan undone.");
      await refresh();
    }
    setBusy(false);
  }

  async function reviewAudit() {
    if (!session) return;
    const { data, error } = await supabase.rpc("review_shelf_audit", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else setAuditReview(data || []);
  }

  async function reconcileAudit() {
    if (!session || !confirm(`Make ${selectedLocation?.code} match this physical count? Other shelves will not change.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("reconcile_shelf_audit", { p_session_id: session.id, p_notes: "Approved shelf audit" });
    if (error) setMessage(error.message);
    else {
      setMessage(`Shelf verified. ${data} discrepanc${data === 1 ? "y" : "ies"} reconciled.`);
      setSession(null); setRecent([]); setAuditReview([]); await refresh();
    }
    setBusy(false);
  }

  async function cancelSession() {
    if (!session) return;
    if (!confirm("Cancel this session? Shelf-audit observations will not change inventory.")) return;
    const { error } = await supabase.rpc("cancel_inventory_scan_session", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else { setSession(null); setRecent([]); setAuditReview([]); setMessage("Session cancelled safely."); }
  }

  async function completeSession() {
    if (!session) return;
    const { error } = await supabase.rpc("complete_inventory_scan_session", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else {
      setSession(null);
      setRecent([]);
      setMessage("Session completed.");
      await refresh();
    }
  }

  async function moveStock(event) {
    event.preventDefault();
    try {
      const item = await lookupItem(moveDraft.itemId);
      if (!item) { setMessage("SKU or barcode was not found."); return; }
      const { error } = await supabase.rpc("move_inventory_stock", {
        p_item_id: String(item.id), p_from_location_id: moveDraft.from,
        p_to_location_id: moveDraft.to, p_quantity: Number(moveDraft.quantity),
        p_notes: "Explicit Move Stock action", p_scan_session_id: null, p_action_type: "move",
      });
      if (error) setMessage(error.message);
      else { setMessage(`${moveDraft.quantity} cop${Number(moveDraft.quantity) === 1 ? "y" : "ies"} moved.`); await refresh(); }
    } catch (error) { setMessage(error.message || "Stock could not be moved."); }
  }

  async function addShelf(event) {
    event.preventDefault();
    const code = newShelf.code.trim().toUpperCase();
    if (!/^[A-Z]+\d+$/.test(code)) {
      setMessage("Shelf codes use letters followed by numbers, such as A1 or C12.");
      return;
    }
    const { error } = await supabase.from("inventory_locations").insert({
      code, display_name: newShelf.displayName.trim() || code, location_type: "shelf",
    });
    if (error) setMessage(error.message);
    else {
      setNewShelf({ code: "", displayName: "" });
      setMessage(`${code} created. Its scan label value is LOCATION:${code}.`);
      await loadWorkspace();
    }
  }

  async function adjustStock(event) {
    event.preventDefault();
    try {
      const item = await lookupItem(adjustDraft.itemId);
      if (!item) { setMessage("SKU or barcode was not found."); return; }
      const delta = Number(adjustDraft.delta);
      const { error } = await supabase.rpc("adjust_inventory_at_location", {
        p_item_id: String(item.id), p_location_id: adjustDraft.location,
        p_quantity_delta: delta, p_action_type: delta < 0 ? "removal" : "manual_adjustment",
        p_notes: adjustDraft.notes || "Manual location adjustment", p_scan_session_id: null,
      });
      if (error) setMessage(error.message);
      else { setMessage(`${item.title} adjusted by ${delta > 0 ? "+" : ""}${delta}.`); await refresh(); }
    } catch (error) { setMessage(error.message || "Stock could not be adjusted."); }
  }

  const inventoryRows = items.filter((item) => {
    const locationText = stock.filter((row) => String(row.item_id) === String(item.id)).map((row) => `${row.code} ${row.display_name}`).join(" ");
    return `${item.title} ${item.sku} ${item.isbn} ${item.curriculum} ${item.publisher} ${locationText}`.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <section className="location-inventory-workspace">
      <header className="location-inventory-header">
        <div><p className="eyebrow">Physical shelf inventory</p><h2>Scan & Locate</h2></div>
        <div className="awaiting-shelving"><strong>{awaitingShelving}</strong><span>awaiting shelving</span></div>
      </header>

      <div className="scan-mode-grid" aria-label="Scan mode">
        {MODES.map((option) => <button key={option.id} className={mode === option.id ? "active" : ""} disabled={Boolean(session)} onClick={() => { setMode(option.id); setMessage(""); }}><strong>{option.label}</strong><span>{option.help}</span></button>)}
      </div>

      <section className={`scan-console scan-console-${mode}`}>
        <div className="scan-context">
          <span className="mode-pill">{MODES.find((option) => option.id === mode)?.label}</span>
          {(mode === "shelving" || mode === "shelf_audit") && <label>Current shelf<select value={locationId} disabled={session?.mode === "shelf_audit"} onChange={(event) => setLocationId(event.target.value)}><option value="">Scan or choose shelf</option>{locations.filter((location) => ["shelf", "display", "overflow", "needs_review"].includes(location.location_type)).map((location) => <option key={location.id} value={location.id}>{location.code} — {location.display_name}</option>)}</select></label>}
          {selectedLocation && mode !== "intake" && <div className="selected-shelf"><small>DESTINATION</small><strong>{selectedLocation.code}</strong><span>{selectedLocation.display_name}</span></div>}
        </div>
        <form className="scan-entry" onSubmit={handleScan}><input ref={inputRef} autoFocus value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder="Scan ISBN, SKU, barcode, or LOCATION:A1" aria-label="Scan value"/><button className="primary" disabled={busy}>Record scan</button></form>
        <div className="scan-session-actions"><span>{recent.length} scans this session</span><button className="secondary" disabled={!recent.length || busy} onClick={undoLastScan}>Undo last</button><button className="secondary" disabled={!session || busy} onClick={cancelSession}>Cancel session</button>{mode === "shelf_audit" ? <button className="primary" disabled={!session || busy} onClick={reviewAudit}>Review count</button> : <button className="primary" disabled={!session || busy} onClick={completeSession}>Finish session</button>}</div>
        {message && <p className="scan-message" role="status">{message}</p>}
      </section>

      {pending && <section className="scan-approval-card"><h3>Approve destination</h3><p><strong>{pending.item.title}</strong> · {pending.item.sku}</p>{recommendations.map((recommendation, index) => <button key={recommendation.location_id} className={index === 0 ? "recommendation recommended" : "recommendation"} onClick={() => approveShelving(recommendation.location_id)}><strong>{index === 0 ? "Recommended: " : "Option: "}{recommendation.code}</strong><span>{recommendation.reason}</span></button>)}<button className="primary" disabled={!locationId} onClick={() => approveShelving(locationId)}>Approve selected shelf {selectedLocation?.code}</button><button className="secondary" disabled={!locationId} onClick={() => approveShelving(locationId, true)}>Document another copy here</button><button className="secondary" onClick={() => setPending(null)}>Cancel this scan</button></section>}

      {unknownScan && <section className="quick-add-card"><h3>Quick Add</h3><p>Barcode: <strong>{unknownScan}</strong></p><label>Title<input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Minimum title" /></label><p>The record will stay hidden publicly and marked for catalog review.</p><button className="primary" disabled={!quickTitle.trim() || busy} onClick={quickAdd}>Create and count this copy</button><button className="secondary" onClick={() => setUnknownScan("")}>Cancel</button></section>}

      {auditReview.length > 0 && <section className="audit-review"><h3>{selectedLocation?.code} discrepancy review</h3><div className="audit-table"><div className="audit-row audit-heading"><span>Book</span><span>Expected</span><span>Observed</span><span>Difference</span></div>{auditReview.map((row) => <div className="audit-row" key={row.item_id}><span>{itemById[row.item_id]?.title || row.item_id}</span><span>{row.expected_quantity}</span><span>{row.observed_quantity}</span><strong className={row.difference ? "difference" : ""}>{row.difference > 0 ? "+" : ""}{row.difference}</strong></div>)}</div><button className="primary" onClick={reconcileAudit}>Approve reconciliation</button></section>}

      <div className="location-inventory-columns">
        <section className="card"><h3>Move Stock</h3><form className="move-stock-form" onSubmit={moveStock}><label>SKU / ISBN<input value={moveDraft.itemId} onChange={(event) => setMoveDraft({ ...moveDraft, itemId: event.target.value })}/></label><label>From<select value={moveDraft.from} onChange={(event) => setMoveDraft({ ...moveDraft, from: event.target.value })}><option value="">Choose source</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>To<select value={moveDraft.to} onChange={(event) => setMoveDraft({ ...moveDraft, to: event.target.value })}><option value="">Choose destination</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>Copies<input type="number" min="1" value={moveDraft.quantity} onChange={(event) => setMoveDraft({ ...moveDraft, quantity: event.target.value })}/></label><button className="primary" disabled={!moveDraft.itemId || !moveDraft.from || !moveDraft.to}>Move atomically</button></form><details className="manual-adjustment"><summary>Manual location adjustment</summary><form onSubmit={adjustStock}><label>SKU / ISBN<input value={adjustDraft.itemId} onChange={(event) => setAdjustDraft({ ...adjustDraft, itemId: event.target.value })}/></label><label>Location<select value={adjustDraft.location} onChange={(event) => setAdjustDraft({ ...adjustDraft, location: event.target.value })}><option value="">Choose location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>Change (+/−)<input type="number" value={adjustDraft.delta} onChange={(event) => setAdjustDraft({ ...adjustDraft, delta: event.target.value })}/></label><label>Reason<input value={adjustDraft.notes} onChange={(event) => setAdjustDraft({ ...adjustDraft, notes: event.target.value })}/></label><button className="secondary" disabled={!adjustDraft.itemId || !adjustDraft.location || Number(adjustDraft.delta) === 0}>Apply adjustment</button></form></details></section>
        <section className="card"><h3>Shelf verification</h3><form className="new-shelf-form" onSubmit={addShelf}><input aria-label="New shelf code" placeholder="Shelf code, e.g. A1" value={newShelf.code} onChange={(event) => setNewShelf({ ...newShelf, code: event.target.value })}/><input aria-label="New shelf display name" placeholder="Display name (optional)" value={newShelf.displayName} onChange={(event) => setNewShelf({ ...newShelf, displayName: event.target.value })}/><button className="secondary">Add shelf</button></form><div className="verification-list">{locations.filter((location) => location.location_type === "shelf").map((location) => <div key={location.id}><strong>{location.code}</strong><span className={`verification-${verificationLabel(location).toLowerCase().replace(" ", "-")}`}>{verificationLabel(location)}</span><small>{location.last_verified_at ? new Date(location.last_verified_at).toLocaleString() : `Label: LOCATION:${location.code}`}</small></div>)}</div></section>
      </div>

      <section className="card location-search"><div className="location-search-heading"><div><h3>Location-aware inventory</h3><p>Totals are calculated from every active location.</p></div><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, ISBN, SKU, curriculum, publisher, location"/></div>{inventoryRows.slice(0, 100).map((item) => { const rows = stock.filter((row) => String(row.item_id) === String(item.id)); return <article key={item.id} className="location-item-row"><div><strong>{item.title}</strong><small>{item.sku} {item.needs_catalog_review ? "· Incomplete catalog record" : ""}</small></div><div className="location-total"><strong>{totalLocationQuantity(rows)}</strong><span>Total available</span></div><div className="location-chips">{rows.length ? rows.map((row) => <span key={row.location_id}>{row.code} — {row.quantity}</span>) : <span>No stock locations</span>}</div></article>; })}</section>

      <section className="card"><h3>Recently moved or adjusted</h3>{events.slice(0, 10).map((event) => <div className="recent-inventory-event" key={event.id}><span>{event.action_type.replaceAll("_", " ")}</span><strong>{itemById[event.item_id]?.title || event.item_id}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>)}</section>
    </section>
  );
}
