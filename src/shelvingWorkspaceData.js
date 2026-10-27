// Fetch every stock row; Supabase's default response limit is not a total.
export async function loadAllLocationStock(client, pageSize = 500) {
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await client.from("inventory_location_details").select("*")
      .eq("active", true).gt("quantity", 0).order("item_id").order("location_id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < pageSize) return rows;
  }
}

export async function loadShelvingWorkspace(client) {
  const [locationsResult, stock, eventsResult] = await Promise.all([
    client.from("inventory_locations").select("*").eq("active", true).order("code"),
    loadAllLocationStock(client),
    client.from("inventory_events").select("*").order("created_at", { ascending: false }).limit(20),
  ]);
  if (locationsResult.error || eventsResult.error) throw locationsResult.error || eventsResult.error;
  const queueIds = [...new Set(stock.filter((row) => row.code === "PROCESSING").map((row) => String(row.item_id)))];
  const queueItems = [];
  for (let offset = 0; offset < queueIds.length; offset += 200) {
    const { data, error } = await client.from("items").select("id,title,sku,isbn,curriculum,publisher,status,item_type")
      .in("id", queueIds.slice(offset, offset + 200));
    if (error) throw error;
    queueItems.push(...(data || []));
  }
  return { locations: locationsResult.data || [], stock, events: eventsResult.data || [], queueItems };
}
