import { loadShelvingWorkspace } from "./shelvingWorkspaceData.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient.js";
import { classifyScan, totalLocationQuantity } from "./locationInventory.js";
import CameraBarcodeScanner from "./CameraBarcodeScanner.jsx";

const PRIMARY_MODES = [
  { id: "shelving", label: "Shelve Books", help: "Move labeled books from Processing to a shelf." },
  { id: "shelf_audit", label: "Audit a Shelf", help: "Count one shelf and review differences before saving." },
];

const QUICK_RECEIVE_MODE = {
  id: "intake",
  label: "Quick Receive Existing Books",
  help: "Add another copy of a book that is already in the catalog.",
};

const MODES = [QUICK_RECEIVE_MODE, ...PRIMARY_MODES];

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
  const [mode, setMode] = useState("shelving");
  const [locations, setLocations] = useState([]);
  const [stock, setStock] = useState([]);
  const [queueItems, setQueueItems] = useState([]);
  const [workspaceStatus, setWorkspaceStatus] = useState("loading");
  const scanBusyRef = useRef(false);
  const [events, setEvents] = useState([]);
  const [session, setSession] = useState(null);
  const [locationId, setLocationId] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [recent, setRecent] = useState([]);
  const [scanCount, setScanCount] = useState(0);
  const [pending, setPending] = useState(null);
  const [recommendations, setRecommendations] = useState([]);
  const [unknownScan, setUnknownScan] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [auditReview, setAuditReview] = useState([]);
  const [auditReviewed, setAuditReviewed] = useState(false);
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
    () => Object.fromEntries([...items, ...queueItems].map((item) => [String(item.id), item])),
    [items, queueItems]
  );
  const locationById = useMemo(
    () => Object.fromEntries(locations.map((location) => [location.id, location])),
    [locations]
  );

  function applyWorkspace(data) {
    setLocations(data.locations);
    setStock(data.stock);
    setEvents(data.events);
    setQueueItems(data.queueItems);
    setWorkspaceStatus("ready");
  }

  async function loadWorkspace() {
    try {
      applyWorkspace(await loadShelvingWorkspace(supabase));
    } catch (error) {
      setWorkspaceStatus("error");
      setMessage("Could not load the shelving queue: " + error.message);
    }
  }

  useEffect(() => {
    let cancelled = false;
    loadShelvingWorkspace(supabase).then((data) => {
      if (!cancelled) applyWorkspace(data);
    }).catch((error) => {
      if (!cancelled) {
        setWorkspaceStatus("error");
        setMessage("Could not load the shelving queue: " + error.message);
      }
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
    setScanCount(0);
    setAuditReview([]);
    setAuditReviewed(false);
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
    setScanCount((current) => current + 1);
    setAuditReview([]);
    setAuditReviewed(false);
    setMessage(mode === "shelving" && destination
      ? (item.title || "Untitled item") + " → " + (locationById[destination]?.code || "selected shelf") + ". Scan the next book."
      : (item.title || "Untitled item") + " scanned successfully.");
    await refresh();
  }

  async function processScan(rawValue, source = "manual") {
    const parsed = classifyScan(rawValue);
    if (!parsed.raw || busy || scanBusyRef.current || (pending && parsed.kind !== "location") || unknownScan) return;
    scanBusyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      if (parsed.kind === "location") {
        if (mode === "intake") throw new Error("This is a shelf code. Switch to Shelving or Shelf Audit before selecting a shelf.");
        const location = locations.find((candidate) => candidate.code === parsed.code);
        if (!location) throw new Error(`Location ${parsed.code} is not active.`);
        if (session?.mode === "shelf_audit" && session.location_id !== location.id) {
          throw new Error("Finish or cancel the current shelf audit before switching shelves.");
        }
        setLocationId(location.id);
        setMessage(`${location.display_name} selected${source === "camera" ? " with the camera" : ""}.`);
        return;
      }

      if (pending) throw new Error("Approve or cancel the current shelving scan before scanning another book.");
      if (unknownScan) throw new Error("Complete or cancel Quick Add before scanning another book.");

      const item = await lookupItem(parsed.raw);
      if (!item) {
        setUnknownScan(parsed.raw);
        setQuickTitle("");
        setMessage("Unknown barcode. Quick Add can create an incomplete catalog record.");
        return;
      }
      const activeSession = session || await startSession();
      if (mode === "shelving") {
        if (!locationId) throw new Error("Choose or scan the shelf before scanning books.");
        await recordItemScan(activeSession, item, parsed.raw, locationId);
      } else {
        await recordItemScan(activeSession, item, parsed.raw);
      }
    } catch (error) {
      setMessage(error.message || "The scan could not be recorded.");
    } finally {
      scanBusyRef.current = false;
      setBusy(false);
      setScanValue("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  async function handleScan(event) {
    event.preventDefault();
    await processScan(scanValue, "manual");
  }

  async function approveShelving(destinationId = locationId, discover = false) {
    if (!pending || !destinationId || busy || scanBusyRef.current) return;
    scanBusyRef.current = true;
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
    } finally {
      scanBusyRef.current = false;
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
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
      setScanCount((current) => Math.max(0, current - 1));
      setAuditReview([]);
      setAuditReviewed(false);
      setMessage("Most recent scan undone.");
      await refresh();
    }
    setBusy(false);
  }

  async function reviewAudit() {
    if (!session) return;
    const { data, error } = await supabase.rpc("review_shelf_audit", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else {
      setAuditReview(data || []);
      setAuditReviewed(true);
    }
  }

  async function reconcileAudit() {
    if (!session || !confirm(`Make ${selectedLocation?.code} match this physical count? Other shelves will not change.`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("reconcile_shelf_audit", { p_session_id: session.id, p_notes: "Approved shelf audit" });
    if (error) setMessage(error.message);
    else {
      setMessage(`Shelf verified. ${data} discrepanc${data === 1 ? "y" : "ies"} reconciled.`);
      setCameraOpen(false); setSession(null); setRecent([]); setScanCount(0); setAuditReview([]); setAuditReviewed(false); await refresh();
    }
    setBusy(false);
  }

  async function cancelSession() {
    if (!session) return;
    if (!confirm("Cancel this session? Shelf-audit observations will not change inventory.")) return;
    const { error } = await supabase.rpc("cancel_inventory_scan_session", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else { setCameraOpen(false); setSession(null); setRecent([]); setScanCount(0); setAuditReview([]); setAuditReviewed(false); setMessage("Session cancelled safely."); }
  }

  async function completeSession() {
    if (!session) return;
    const { error } = await supabase.rpc("complete_inventory_scan_session", { p_session_id: session.id });
    if (error) setMessage(error.message);
    else {
      setSession(null);
      setCameraOpen(false);
      setRecent([]);
      setScanCount(0);
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

  function selectMode(nextMode) {
    setCameraOpen(false);
    setPending(null);
    setRecommendations([]);
    setMode(nextMode);
    setMessage("");
  }

  const shelfFieldLabel = mode === "shelf_audit" ? "Shelf to audit" : "Shelf you are stocking";
  const scanPrompt = mode === "intake"
    ? "Scan the ISBN, SKU, or barcode for the extra copy"
    : mode === "shelf_audit"
      ? "Scan every book physically on this shelf"
      : "Scan a labeled book from Processing";
  const finishLabel = mode === "intake" ? "Finish receiving" : "Finish shelving";

  return (
    <section className="location-inventory-workspace">
      <header className="location-inventory-header">
        <div>
          <p className="eyebrow">Physical shelf inventory</p>
          <div className="shelving-title-row"><h2>Shelve Books</h2><details className="shelving-help"><summary aria-label="Shelving help">?</summary><p>Books saved through Add Item wait in Processing until you record their shelf here. Print and attach their SKU labels, choose a shelf, then scan books. Each scan moves one copy from Processing to that shelf. Change the shelf whenever needed.</p></details></div>
        </div>
        <button
          type="button"
          className="awaiting-shelving"
          disabled={Boolean(session)}
          onClick={() => selectMode("shelving")}
          aria-label={`${awaitingShelving} copies waiting to be shelved`}
        >
          <strong>{workspaceStatus === "ready" ? awaitingShelving : "—"}</strong><span>{workspaceStatus === "loading" ? "Loading queue…" : workspaceStatus === "error" ? "Queue unavailable" : "copies to shelve"}</span>
        </button>
      </header>

      <details className="shelving-other-tools" open={mode !== "shelving"}>
        <summary>Audit or receive extra copies</summary>
        <div className="scan-mode-grid" aria-label="Scan mode">{PRIMARY_MODES.map((option) => <button key={option.id} className={mode === option.id ? "active" : ""} disabled={Boolean(session)} onClick={() => selectMode(option.id)}><strong>{option.label}</strong><span>{option.help}</span></button>)}</div>
      <details className="quick-receive-disclosure" open={mode === "intake"}>
        <summary>Receiving an extra copy of a book already in the catalog?</summary>
        <p>Use this shortcut instead of Add Item. Do not use both workflows for the same copy.</p>
        <button type="button" className={mode === "intake" ? "primary" : "secondary"} disabled={Boolean(session)} onClick={() => selectMode("intake")}>Open Quick Receive</button>
      </details>


      </details>
      {mode === "shelving" && <details className="shelving-queue">
        <summary>Waiting in Processing {workspaceStatus === "ready" ? "(" + awaitingShelving + " copies)" : ""}</summary>
        <button type="button" className="text-button" disabled={busy} onClick={refresh}>Refresh queue</button>{!locationId && <p className="helper-text">Choose a shelf below to enable the Shelve buttons.</p>}
        {workspaceStatus === "loading" ? <p>Loading books…</p> : workspaceStatus === "error" ? <p>The queue could not load. Refresh to try again.</p> : awaitingShelving === 0 ? <p>No copies are currently recorded in Processing.</p> : <ul className="shelving-queue-list">{stock.filter((row) => row.location_id === processingLocation?.id).map((row) => <li key={row.item_id}><div><strong>{itemById[String(row.item_id)]?.title || "Book " + row.item_id}</strong><small>{itemById[String(row.item_id)]?.sku} · {row.quantity} {Number(row.quantity) === 1 ? "copy" : "copies"}</small></div><button type="button" className="secondary" disabled={busy || Boolean(pending) || !locationId || workspaceStatus !== "ready"} onClick={() => processScan(itemById[String(row.item_id)]?.sku || itemById[String(row.item_id)]?.isbn || "")}>Shelve</button></li>)}</ul>}
      </details>}

      <section className={`scan-console scan-console-${mode}`}>
        <p className="mode-instructions">
          {mode === "intake" && <><strong>This increases inventory.</strong> Scan only an extra copy that has not already been saved through Add Item.</>}
          {mode === "shelving" && <><strong>Scan to shelve:</strong> each book goes straight onto the selected shelf. Keep scanning until you change shelves.</>}
          {mode === "shelf_audit" && <><strong>Audit steps:</strong> choose the shelf, scan every physical copy on it, then review the count.</>}
        </p>
        <div className="scan-context">
          <span className="mode-pill" hidden={mode === "shelving"}>{MODES.find((option) => option.id === mode)?.label}</span>
          {(mode === "shelving" || mode === "shelf_audit") && <label>{shelfFieldLabel}<select value={locationId} disabled={session?.mode === "shelf_audit"} onChange={(event) => setLocationId(event.target.value)}><option value="">Scan or choose shelf</option>{locations.filter((location) => ["shelf", "display", "overflow", "needs_review"].includes(location.location_type)).map((location) => <option key={location.id} value={location.id}>{location.code} — {location.display_name}</option>)}</select></label>}
          {selectedLocation && mode !== "intake" && <div className="selected-shelf"><small>{mode === "shelf_audit" ? "SHELF TO AUDIT" : "SHELF TO STOCK"}</small><strong>{selectedLocation.code}</strong><span>{selectedLocation.display_name}</span></div>}
        </div>
        <form className="scan-entry" onSubmit={handleScan}><input ref={inputRef} autoFocus value={scanValue} onChange={(event) => setScanValue(event.target.value)} placeholder={scanPrompt} aria-label="Scan value"/><button className="primary" disabled={busy || Boolean(pending) || workspaceStatus !== "ready"}>Scan book</button><button type="button" className="secondary camera-start" disabled={cameraOpen} onClick={() => setCameraOpen(true)}>Use Camera</button></form>
        <CameraBarcodeScanner active={cameraOpen && !pending && !unknownScan} requireClearFrame={mode === "shelving"} paused={busy} onDetected={processScan} onClose={() => setCameraOpen(false)} onError={setMessage}/>
        <div className="scan-session-actions"><span>{scanCount} scans this session</span><button className="secondary" disabled={!scanCount || busy} onClick={undoLastScan}>Undo last</button><details className="shelving-session-tools"><summary>Session tools</summary><button className="secondary" disabled={!session || busy} onClick={cancelSession}>Cancel session</button></details>{mode === "shelf_audit" ? <button className="primary" disabled={!session || busy} onClick={reviewAudit}>Review count</button> : <button className="primary" disabled={!session || busy} onClick={completeSession}>{finishLabel}</button>}</div>
        {message && <p className="scan-message" role="status">{message}</p>}
        {recent.length > 0 && <div className="recent-scans" aria-label="Recently scanned books"><strong>Recently scanned</strong><ol>{recent.map((entry) => <li key={entry.id}><span>{entry.item.title || "Untitled item"}</span><small>{entry.item.sku || entry.raw}</small></li>)}</ol></div>}
      </section>

      {pending && <section className="scan-approval-card"><h3>Confirm shelf</h3><p><strong>{pending.item.title}</strong> · {pending.item.sku}</p>{recommendations.map((recommendation, index) => <button key={recommendation.location_id} className={index === 0 ? "recommendation recommended" : "recommendation"} disabled={busy} onClick={() => approveShelving(recommendation.location_id)}><strong>{index === 0 ? "Recommended: " : "Option: "}{recommendation.code}</strong><span>{recommendation.reason}</span></button>)}<button className="primary" disabled={!locationId || busy} onClick={() => approveShelving(locationId)}>{busy ? "Shelving…" : "Shelve & Next"} · {selectedLocation?.code}</button><button className="secondary" disabled={busy} onClick={() => setPending(null)}>Cancel this scan</button><details className="discovered-copy-action"><summary>Book was not recorded in Processing?</summary><p>Only use this when you found an unrecorded physical copy. This adds a copy at the selected shelf instead of moving one from Processing.</p><button className="secondary" disabled={!locationId} onClick={() => approveShelving(locationId, true)}>Add a previously unrecorded copy here</button></details></section>}

      {unknownScan && <section className="quick-add-card"><h3>Quick Add</h3><p>Barcode: <strong>{unknownScan}</strong></p><label>Title<input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="Minimum title" /></label><p>The record will stay hidden publicly and marked for catalog review.</p><button className="primary" disabled={!quickTitle.trim() || busy} onClick={quickAdd}>Create and count this copy</button><button className="secondary" onClick={() => setUnknownScan("")}>Cancel</button></section>}

      {auditReviewed && <section className="audit-review"><h3>{selectedLocation?.code} discrepancy review</h3>{auditReview.length > 0 ? <div className="audit-table"><div className="audit-row audit-heading"><span>Book</span><span>Expected</span><span>Observed</span><span>Difference</span></div>{auditReview.map((row) => <div className="audit-row" key={row.item_id}><span>{itemById[row.item_id]?.title || row.item_id}</span><span>{row.expected_quantity}</span><span>{row.observed_quantity}</span><strong className={row.difference ? "difference" : ""}>{row.difference > 0 ? "+" : ""}{row.difference}</strong></div>)}</div> : <p>No books are expected or observed on this shelf. Approving will verify the shelf as empty.</p>}<button className="primary" onClick={reconcileAudit}>Approve reconciliation</button></section>}

      <details className="advanced-location-tools">
        <summary>Location tools and shelf setup</summary>
        <p>Use these tools for corrections, moving several copies, or creating shelf labels.</p>
        <div className="location-inventory-columns">
          <section className="card"><h3>Move Stock</h3><form className="move-stock-form" onSubmit={moveStock}><label>SKU / ISBN<input value={moveDraft.itemId} onChange={(event) => setMoveDraft({ ...moveDraft, itemId: event.target.value })}/></label><label>From<select value={moveDraft.from} onChange={(event) => setMoveDraft({ ...moveDraft, from: event.target.value })}><option value="">Choose source</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>To<select value={moveDraft.to} onChange={(event) => setMoveDraft({ ...moveDraft, to: event.target.value })}><option value="">Choose destination</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>Copies<input type="number" min="1" value={moveDraft.quantity} onChange={(event) => setMoveDraft({ ...moveDraft, quantity: event.target.value })}/></label><button className="primary" disabled={!moveDraft.itemId || !moveDraft.from || !moveDraft.to}>Move stock</button></form><details className="manual-adjustment"><summary>Manual location adjustment</summary><form onSubmit={adjustStock}><label>SKU / ISBN<input value={adjustDraft.itemId} onChange={(event) => setAdjustDraft({ ...adjustDraft, itemId: event.target.value })}/></label><label>Location<select value={adjustDraft.location} onChange={(event) => setAdjustDraft({ ...adjustDraft, location: event.target.value })}><option value="">Choose location</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><label>Change (+/−)<input type="number" value={adjustDraft.delta} onChange={(event) => setAdjustDraft({ ...adjustDraft, delta: event.target.value })}/></label><label>Reason<input value={adjustDraft.notes} onChange={(event) => setAdjustDraft({ ...adjustDraft, notes: event.target.value })}/></label><button className="secondary" disabled={!adjustDraft.itemId || !adjustDraft.location || Number(adjustDraft.delta) === 0}>Apply adjustment</button></form></details></section>
          <section className="card"><h3>Shelf setup and verification</h3><form className="new-shelf-form" onSubmit={addShelf}><input aria-label="New shelf code" placeholder="Shelf code, e.g. A1" value={newShelf.code} onChange={(event) => setNewShelf({ ...newShelf, code: event.target.value })}/><input aria-label="New shelf display name" placeholder="Display name (optional)" value={newShelf.displayName} onChange={(event) => setNewShelf({ ...newShelf, displayName: event.target.value })}/><button className="secondary">Add shelf</button></form><div className="verification-list">{locations.filter((location) => location.location_type === "shelf").map((location) => <div key={location.id}><strong>{location.code}</strong><span className={`verification-${verificationLabel(location).toLowerCase().replace(" ", "-")}`}>{verificationLabel(location)}</span><small>{location.last_verified_at ? new Date(location.last_verified_at).toLocaleString() : `Label: LOCATION:${location.code}`}</small></div>)}</div></section>
        </div>
      </details>

      <details className="shelving-reference"><summary>Find stock locations</summary><section className="card location-search"><div className="location-search-heading"><div><h3>Location-aware inventory</h3><p>Totals are calculated from every active location.</p></div><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Title, ISBN, SKU, curriculum, publisher, location"/></div>{inventoryRows.slice(0, 100).map((item) => { const rows = stock.filter((row) => String(row.item_id) === String(item.id)); return <article key={item.id} className="location-item-row"><div><strong>{item.title}</strong><small>{item.sku} {item.needs_catalog_review ? "· Incomplete catalog record" : ""}</small></div><div className="location-total"><strong>{totalLocationQuantity(rows)}</strong><span>Total available</span></div><div className="location-chips">{rows.length ? rows.map((row) => <span key={row.location_id}>{row.code} — {row.quantity}</span>) : <span>No stock locations</span>}</div></article>; })}</section>

      </details>
      <details className="shelving-reference"><summary>Recent inventory activity</summary><section className="card"><h3>Recently moved or adjusted</h3>{events.slice(0, 10).map((event) => <div className="recent-inventory-event" key={event.id}><span>{event.action_type.replaceAll("_", " ")}</span><strong>{itemById[event.item_id]?.title || event.item_id}</strong><small>{new Date(event.created_at).toLocaleString()}</small></div>)}</section>
      </details>
    </section>
  );
}
