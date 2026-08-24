const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
const {
  applyInventoryCount,
  catalogVariationWithInventoryTracking,
  inventoryCountsFromEvent,
  soldQuantitiesByVariation,
  squareSalesPayloadFromOrders,
  startOfDayInTimeZone,
  variationsWithoutInventoryTracking,
  verifySquareWebhook,
} = require("./squareInventorySync");
const {
  MAX_SOURCE_TEXT,
  curriculumAnalysisPrompt,
  curriculumAnalysisSchema,
  fetchPublicCurriculumSource,
  normalizeAnalysisResult,
} = require("./curriculumImport");
require("dotenv").config();

const SQUARE_BASE_URL =
  process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 3,
  },
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const localOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || localOrigins.includes(origin) || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed."));
    },
  })
);
app.use(express.json({
  limit: "1mb",
  verify(req, _res, buffer) {
    if (req.originalUrl === "/square/webhooks/inventory") {
      req.rawBody = buffer.toString("utf8");
    }
  },
}));

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAuth =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
      })
    : null;

const supabaseAdmin =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function squareInventoryIsConfigured() {
  return Boolean(
    supabaseAdmin &&
    process.env.SQUARE_ACCESS_TOKEN &&
    process.env.SQUARE_LOCATION_ID
  );
}

async function retrieveSquareInventoryCounts(squareVariationIds) {
  const counts = [];
  for (let start = 0; start < squareVariationIds.length; start += 1000) {
    const catalogObjectIds = squareVariationIds.slice(start, start + 1000);
    let cursor;
    do {
      const response = await fetch(`${SQUARE_BASE_URL}/v2/inventory/counts/batch-retrieve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          catalog_object_ids: catalogObjectIds,
          location_ids: [process.env.SQUARE_LOCATION_ID],
          states: ["IN_STOCK"],
          ...(cursor ? { cursor } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Square inventory lookup failed (${response.status}).`);
      }
      counts.push(...(data.counts || []));
      cursor = data.cursor;
    } while (cursor);
  }
  return counts;
}

async function retrieveSquareCatalogVariations(squareVariationIds) {
  const objects = [];
  for (let start = 0; start < squareVariationIds.length; start += 1000) {
    const response = await fetch(`${SQUARE_BASE_URL}/v2/catalog/batch-retrieve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        object_ids: squareVariationIds.slice(start, start + 1000),
        include_related_objects: false,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Square catalog lookup failed (${response.status}).`);
    }
    objects.push(...(data.objects || []));
  }
  return objects;
}

async function searchCompletedSquareOrders(startAt, timestampField = "created_at") {
  const orders = [];
  const sortField = timestampField.toUpperCase();
  let cursor;
  do {
    const response = await fetch(`${SQUARE_BASE_URL}/v2/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        location_ids: [process.env.SQUARE_LOCATION_ID],
        return_entries: false,
        limit: 500,
        ...(cursor ? { cursor } : {}),
        query: {
          filter: {
            state_filter: { states: ["COMPLETED"] },
            date_time_filter: { [timestampField]: { start_at: startAt } },
          },
          sort: { sort_field: sortField, sort_order: "ASC" },
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Square order lookup failed (${response.status}).`);
    }
    orders.push(...(data.orders || []));
    cursor = data.cursor;
  } while (cursor);
  return orders;
}

let squareSalesHistoryPrepared = false;

async function synchronizeSquareSales() {
  const fullHistory = !squareSalesHistoryPrepared;
  const startAt = fullHistory
    ? (process.env.SQUARE_SALES_BACKFILL_START_AT || "2000-01-01T00:00:00Z")
    : new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const orders = await searchCompletedSquareOrders(
    startAt,
    fullHistory ? "closed_at" : "updated_at"
  );
  const sales = squareSalesPayloadFromOrders(orders);
  const totals = { recorded_lines: 0, updated_lines: 0, sold_copies_delta: 0 };

  for (let start = 0; start < sales.length; start += 100) {
    const { data, error } = await supabaseAdmin.rpc("record_square_order_sales", {
      p_orders: sales.slice(start, start + 100),
    });
    if (error) throw error;
    totals.recorded_lines += Number(data?.recorded_lines || 0);
    totals.updated_lines += Number(data?.updated_lines || 0);
    totals.sold_copies_delta += Number(data?.sold_copies_delta || 0);
  }

  squareSalesHistoryPrepared = true;
  return {
    full_history: fullHistory,
    orders_checked: orders.length,
    ...totals,
  };
}

async function enableSquareInventoryTracking(objects) {
  if (objects.length === 0) return;
  const response = await fetch(`${SQUARE_BASE_URL}/v2/catalog/batch-upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: `inventory-tracking-${Date.now()}`,
      batches: Array.from({ length: Math.ceil(objects.length / 1000) }, (_, index) => ({
        objects: objects.slice(index * 1000, (index + 1) * 1000)
          .map(catalogVariationWithInventoryTracking),
      })),
    }),
  });
  const data = await response.json();
  if (!response.ok || data.errors?.length) {
    throw new Error(`Square inventory tracking update failed (${response.status}).`);
  }
}

let squareInventoryTrackingPrepared = false;

async function prepareSquareInventoryTracking() {
  if (squareInventoryTrackingPrepared) return { checked: 0, enabled: 0, backfilled: 0 };
  const { data, error } = await supabaseAdmin
    .from("items")
    .select("square_variation_id")
    .not("square_variation_id", "is", null);
  if (error) throw error;
  const variationIds = [...new Set(
    (data || []).map((item) => String(item.square_variation_id || "").trim()).filter(Boolean)
  )];
  const catalogObjects = await retrieveSquareCatalogVariations(variationIds);
  const disabled = variationsWithoutInventoryTracking(catalogObjects, variationIds);
  const disabledIds = disabled.map((object) => object.id);

  let backfilled = 0;
  let skippedWithoutCount = 0;
  if (disabledIds.length > 0) {
    const startAt = process.env.SQUARE_TRACKING_BACKFILL_START_AT ||
      startOfDayInTimeZone(new Date(), "America/Chicago");
    const [orders, rawCounts] = await Promise.all([
      searchCompletedSquareOrders(startAt),
      retrieveSquareInventoryCounts(disabledIds),
    ]);
    const sold = soldQuantitiesByVariation(orders, disabledIds);
    const counts = inventoryCountsFromEvent({
      type: "inventory.count.updated",
      created_at: new Date().toISOString(),
      data: { object: { inventory_counts: rawCounts } },
    }, process.env.SQUARE_LOCATION_ID);
    const quantityByVariation = new Map(
      counts.map((count) => [count.squareVariationId, count.quantity])
    );

    for (const [variationId, soldQuantity] of sold) {
      const currentQuantity = quantityByVariation.get(variationId);
      if (currentQuantity === undefined) {
        skippedWithoutCount += 1;
        continue;
      }
      await setSquareInventoryPhysicalCount(
        variationId,
        Math.max(0, currentQuantity - soldQuantity),
        `tracking-backfill:${startAt.slice(0, 10)}:${variationId}`
      );
      backfilled += 1;
    }

    await enableSquareInventoryTracking(disabled);
  }

  squareInventoryTrackingPrepared = true;
  return {
    checked: variationIds.length,
    enabled: disabledIds.length,
    backfilled,
    skipped_without_count: skippedWithoutCount,
  };
}

async function setSquareInventoryPhysicalCount(squareVariationId, quantity, idempotencyKey) {
  const occurredAt = new Date().toISOString();
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${SQUARE_BASE_URL}/v2/inventory/changes/batch-create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          changes: [{
            type: "PHYSICAL_COUNT",
            physical_count: {
              catalog_object_id: squareVariationId,
              location_id: process.env.SQUARE_LOCATION_ID,
              quantity: String(quantity),
              state: "IN_STOCK",
              occurred_at: occurredAt,
            },
          }],
        }),
      });
      const data = await response.json();
      if (response.ok) return data;
      lastError = new Error(`Square inventory hold failed (${response.status}).`);
      if (response.status < 500) lastError.nonRetryable = true;
      if (lastError.nonRetryable) throw lastError;
    } catch (error) {
      lastError = error;
      if (error.nonRetryable || attempt === 1) throw error;
    }
  }
  throw lastError;
}

async function prepareSquareAvailableQuantity(squareVariationId, physicalQuantity) {
  const { data: item, error: itemError } = await supabaseAdmin
    .from("items")
    .select("id,square_expected_quantity")
    .eq("square_variation_id", squareVariationId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) {
    return {
      itemId: null,
      previousExpected: null,
      availableQuantity: Math.max(Number(physicalQuantity || 0), 0),
    };
  }

  const { count, error: holdError } = await supabaseAdmin
    .from("book_reservations")
    .select("id", { count: "exact", head: true })
    .eq("item_id", String(item.id))
    .in("status", ["pending", "ready"])
    .gt("expires_at", new Date().toISOString())
    .not("square_hold_synced_at", "is", null)
    .is("square_hold_released_at", null);
  if (holdError) throw holdError;

  const availableQuantity = Math.max(Number(physicalQuantity || 0) - Number(count || 0), 0);
  const { error: expectationError } = await supabaseAdmin
    .from("items")
    .update({ square_expected_quantity: availableQuantity })
    .eq("id", item.id);
  if (expectationError) throw expectationError;
  return {
    itemId: item.id,
    previousExpected: item.square_expected_quantity,
    availableQuantity,
  };
}

async function restoreSquareExpectation(prepared) {
  if (!prepared.itemId) return;
  await supabaseAdmin
    .from("items")
    .update({ square_expected_quantity: prepared.previousExpected })
    .eq("id", prepared.itemId)
    .eq("square_expected_quantity", prepared.availableQuantity);
}

async function synchronizeSquareReservationAvailability(requestedItemIds = null) {
  if (!squareInventoryIsConfigured()) {
    throw new Error("Square inventory synchronization is not configured.");
  }

  let itemQuery = supabaseAdmin
    .from("items")
    .select("id,square_variation_id,quantity,square_expected_quantity")
    .not("square_variation_id", "is", null);
  if (requestedItemIds?.length) {
    itemQuery = itemQuery.in("id", requestedItemIds);
  }
  const { data: itemsToSync, error: itemError } = await itemQuery;
  if (itemError) throw itemError;
  if (!itemsToSync?.length) return { checked: 0, updated: 0 };

  const itemIds = itemsToSync.map((item) => String(item.id));
  const { data: holds, error: holdError } = await supabaseAdmin
    .from("book_reservations")
    .select("item_id")
    .in("item_id", itemIds)
    .in("status", ["pending", "ready"])
    .gt("expires_at", new Date().toISOString())
    .not("square_hold_synced_at", "is", null)
    .is("square_hold_released_at", null);
  if (holdError) throw holdError;

  const holdCountByItem = (holds || []).reduce((counts, hold) => {
    const itemId = String(hold.item_id);
    counts.set(itemId, (counts.get(itemId) || 0) + 1);
    return counts;
  }, new Map());

  let updated = 0;
  for (const item of itemsToSync) {
    const desiredQuantity = Math.max(
      Number(item.quantity || 0) - (holdCountByItem.get(String(item.id)) || 0),
      0
    );
    const previousExpected = item.square_expected_quantity;
    if (previousExpected !== null && Number(previousExpected) === desiredQuantity) continue;

    const { error: expectationError } = await supabaseAdmin
      .from("items")
      .update({ square_expected_quantity: desiredQuantity })
      .eq("id", item.id);
    if (expectationError) throw expectationError;

    try {
      await setSquareInventoryPhysicalCount(
        item.square_variation_id,
        desiredQuantity,
        `reservation-availability-${item.id}-${desiredQuantity}-${Date.now()}`
      );
      updated += 1;
    } catch (error) {
      await supabaseAdmin
        .from("items")
        .update({ square_expected_quantity: previousExpected })
        .eq("id", item.id)
        .eq("square_expected_quantity", desiredQuantity);
      throw error;
    }
  }

  return { checked: itemsToSync.length, updated };
}

async function reconcileSquareInventory(requestedVariationIds = null) {
  if (!squareInventoryIsConfigured()) {
    throw new Error("Square inventory synchronization is not configured.");
  }

  let variationIds = requestedVariationIds;
  if (!variationIds) {
    const { data, error } = await supabaseAdmin
      .from("items")
      .select("square_variation_id")
      .not("square_variation_id", "is", null);
    if (error) throw error;
    variationIds = (data || []).map((item) => item.square_variation_id);
  }

  const uniqueVariationIds = [...new Set(
    (variationIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  )];
  if (uniqueVariationIds.length === 0) return { checked: 0, updated: 0 };

  const rawCounts = await retrieveSquareInventoryCounts(uniqueVariationIds);
  const counts = inventoryCountsFromEvent({
    type: "inventory.count.updated",
    created_at: new Date().toISOString(),
    data: { object: { inventory_counts: rawCounts } },
  }, process.env.SQUARE_LOCATION_ID);

  let updated = 0;
  for (const count of counts) {
    const eventId = `reconcile:${count.squareVariationId}:${count.calculatedAt}`;
    const { data, error } = await applyInventoryCount(supabaseAdmin, eventId, count);
    if (error) throw error;
    updated += Number(data?.updated_items || 0);
  }
  return { checked: uniqueVariationIds.length, updated };
}

async function loadReservationAndItem(reservationId) {
  const { data: reservation, error: reservationError } = await supabaseAdmin
    .from("book_reservations")
    .select("*")
    .eq("id", reservationId)
    .maybeSingle();
  if (reservationError) throw reservationError;
  if (!reservation) return { reservation: null, item: null };

  const { data: item, error: itemError } = await supabaseAdmin
    .from("items")
    .select("*")
    .eq("id", reservation.item_id)
    .maybeSingle();
  if (itemError) throw itemError;
  return { reservation, item };
}

function sendSafeError(res, status, message) {
  res.status(status).json({
    success: false,
    error: message,
  });
}

function sendInvitationError(res, error) {
  const status = Number(error?.status) || 400;
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();

  console.error("[team invitation failed]", {
    status,
    code: error?.code || null,
    message: error?.message || "Supabase did not return an invited user.",
  });

  if (status === 429 || code.includes("rate") || message.includes("rate limit")) {
    sendSafeError(
      res,
      429,
      "The email sending limit has been reached. Please wait and try again, or configure custom SMTP in Supabase."
    );
    return;
  }

  if (
    status === 409 ||
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("duplicate")
  ) {
    sendSafeError(
      res,
      409,
      "An account already exists for this email. Ask the team member to use Forgot password on the sign-in screen."
    );
    return;
  }

  if (message.includes("redirect") || message.includes("url")) {
    sendSafeError(
      res,
      400,
      "The invitation redirect URL is not configured correctly. Check the Supabase URL Configuration settings."
    );
    return;
  }

  if (
    status >= 500 ||
    message.includes("smtp") ||
    message.includes("email") ||
    message.includes("mail")
  ) {
    sendSafeError(
      res,
      502,
      "Supabase could not send the invitation email. Check the Supabase email provider and authentication logs."
    );
    return;
  }

  sendSafeError(
    res,
    400,
    "Could not send the invitation. Check the Supabase authentication logs for details."
  );
}

function getSupabaseHostname() {
  try {
    return supabaseUrl ? new URL(supabaseUrl).hostname : "missing";
  } catch {
    return "invalid-url";
  }
}

function logAuthDiagnostic(details) {
  console.info("[auth diagnostic]", {
    hasAuthorizationHeader: details.hasAuthorizationHeader,
    hasBearerToken: details.hasBearerToken,
    tokenLength: details.tokenLength,
    supabaseHostname: getSupabaseHostname(),
    authErrorMessage: details.authErrorMessage || null,
    authErrorCode: details.authErrorCode || null,
  });
}

async function loadProfile(userId) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,role,is_active,created_at,updated_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function requireAuth(req, res, next) {
  try {
    if (!supabaseAuth || !supabaseAdmin) {
      sendSafeError(res, 500, "Authentication is not configured.");
      return;
    }

    const authHeader = req.get("authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    const accessToken = match?.[1]?.trim() || "";

    if (!accessToken) {
      logAuthDiagnostic({
        hasAuthorizationHeader: Boolean(authHeader),
        hasBearerToken: false,
        tokenLength: 0,
      });
      sendSafeError(res, 401, "Sign in to continue.");
      return;
    }

    const { data, error } = await supabaseAuth.auth.getUser(accessToken);

    if (error || !data?.user) {
      logAuthDiagnostic({
        hasAuthorizationHeader: Boolean(authHeader),
        hasBearerToken: Boolean(accessToken),
        tokenLength: accessToken.length,
        authErrorMessage: error?.message,
        authErrorCode: error?.code || error?.status,
      });
      sendSafeError(res, 401, "Your session is no longer valid.");
      return;
    }

    const profile = await loadProfile(data.user.id);

    if (!profile) {
      sendSafeError(res, 403, "No active account profile was found.");
      return;
    }

    if (profile.is_active === false) {
      sendSafeError(res, 403, "This account is inactive.");
      return;
    }

    req.user = data.user;
    req.profile = profile;
    next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    sendSafeError(res, 500, "Could not verify account access.");
  }
}

function requireAdmin(req, res, next) {
  if (req.profile?.role !== "admin") {
    sendSafeError(res, 403, "Admin access is required.");
    return;
  }

  next();
}

async function writeAudit(req, action, entityType, entityId, details = {}) {
  if (!supabaseAdmin) return;

  const safeDetails = { ...details };
  delete safeDetails.password;
  delete safeDetails.token;
  delete safeDetails.access_token;

  await supabaseAdmin.from("audit_logs").insert([
    {
      user_id: req.user?.id || null,
      action,
      entity_type: entityType,
      entity_id: entityId ? String(entityId) : null,
      details: safeDetails,
    },
  ]);
}

function sanitizeProfile(profile) {
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.full_name,
    role: profile.role,
    is_active: profile.is_active,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}

app.get("/", (req, res) => {
  res.send("IL HRC AI Vision Server Running");
});

app.get("/auth/me", requireAuth, async (req, res) => {
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
    },
    profile: sanitizeProfile(req.profile),
  });
});

app.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,email,full_name,role,is_active,created_at,updated_at")
    .order("created_at", { ascending: false });

  if (error) {
    sendSafeError(res, 500, "Could not load users.");
    return;
  }

  res.json({ users: data || [] });
});

app.post("/admin/users/invite", requireAuth, requireAdmin, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const fullName = String(req.body.full_name || "").trim();
  const role = req.body.role === "admin" ? "admin" : "team";

  if (!email || !email.includes("@")) {
    sendSafeError(res, 400, "Enter a valid email address.");
    return;
  }

  const redirectTo = process.env.SUPABASE_INVITE_REDIRECT_URL;
  const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
    email,
    redirectTo ? { redirectTo } : undefined
  );

  if (error || !data?.user) {
    sendInvitationError(res, error);
    return;
  }

  const existingAppMetadata = data.user.app_metadata || {};
  const { error: metadataError } = await supabaseAdmin.auth.admin.updateUserById(
    data.user.id,
    {
      app_metadata: {
        ...existingAppMetadata,
        password_setup_required: true,
      },
    }
  );

  if (metadataError) {
    sendSafeError(
      res,
      500,
      "Invitation was sent, but account setup could not be marked as required."
    );
    return;
  }

  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: data.user.id,
    email,
    full_name: fullName || null,
    role,
    is_active: true,
    updated_at: new Date().toISOString(),
  });

  if (profileError) {
    sendSafeError(res, 500, "Invitation was sent, but the profile could not be saved.");
    return;
  }

  await writeAudit(req, "user_invited", "profile", data.user.id, {
    email,
    role,
  });

  res.json({ success: true });
});

app.post("/auth/complete-password-setup", requireAuth, async (req, res) => {
  const { data: currentUserData, error: currentUserError } =
    await supabaseAdmin.auth.admin.getUserById(req.user.id);

  if (currentUserError || !currentUserData?.user) {
    sendSafeError(res, 500, "Password was saved, but account metadata could not be loaded.");
    return;
  }

  const existingAppMetadata = currentUserData.user.app_metadata || {};
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    req.user.id,
    {
      app_metadata: {
        ...existingAppMetadata,
        password_setup_required: false,
      },
    }
  );

  if (error || !data?.user) {
    sendSafeError(res, 500, "Password was saved, but account setup could not be completed.");
    return;
  }

  await writeAudit(req, "password_setup_completed", "profile", req.user.id);

  res.json({ success: true });
});

app.patch("/admin/users/:id", requireAuth, requireAdmin, async (req, res) => {
  const targetId = req.params.id;
  const updates = {};

  if (Object.prototype.hasOwnProperty.call(req.body, "full_name")) {
    updates.full_name = String(req.body.full_name || "").trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "role")) {
    if (!["admin", "team"].includes(req.body.role)) {
      sendSafeError(res, 400, "Choose either Admin or Team.");
      return;
    }

    updates.role = req.body.role;
  }

  if (Object.prototype.hasOwnProperty.call(req.body, "is_active")) {
    updates.is_active = req.body.is_active === true;
  }

  if (Object.keys(updates).length === 0) {
    sendSafeError(res, 400, "No user changes were provided.");
    return;
  }

  const { data: current, error: currentError } = await supabaseAdmin
    .from("profiles")
    .select("id,role,is_active")
    .eq("id", targetId)
    .maybeSingle();

  if (currentError || !current) {
    sendSafeError(res, 404, "User not found.");
    return;
  }

  const wouldRemoveActiveAdmin =
    current.role === "admin" &&
    current.is_active !== false &&
    (updates.role === "team" || updates.is_active === false);

  if (wouldRemoveActiveAdmin) {
    const { count, error: countError } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin")
      .eq("is_active", true);

    if (countError) {
      sendSafeError(res, 500, "Could not verify active admins.");
      return;
    }

    if ((count || 0) <= 1) {
      sendSafeError(res, 400, "At least one active Admin must remain.");
      return;
    }
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .update(updates)
    .eq("id", targetId)
    .select("id,email,full_name,role,is_active,created_at,updated_at")
    .single();

  if (error) {
    sendSafeError(res, 500, "Could not update the user.");
    return;
  }

  await writeAudit(req, "user_updated", "profile", targetId, updates);

  res.json({ user: data });
});

app.get("/admin/audit-logs", requireAuth, requireAdmin, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("audit_logs")
    .select("id,user_id,action,entity_type,entity_id,details,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    sendSafeError(res, 500, "Could not load audit logs.");
    return;
  }

  res.json({ audit_logs: data || [] });
});

app.post("/square/webhooks/inventory", async (req, res) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const notificationUrl = process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  if (
    !signatureKey ||
    !notificationUrl ||
    !process.env.SQUARE_LOCATION_ID ||
    !supabaseAdmin
  ) {
    sendSafeError(res, 503, "Square inventory webhook is not configured.");
    return;
  }

  try {
    const valid = await verifySquareWebhook({
      requestBody: req.rawBody,
      signatureHeader: req.get("x-square-hmacsha256-signature") || "",
      signatureKey,
      notificationUrl,
    });
    if (!valid) {
      sendSafeError(res, 403, "Invalid Square webhook signature.");
      return;
    }

    const event = req.body;
    if (event?.type !== "inventory.count.updated") {
      res.json({ success: true, ignored: true });
      return;
    }
    if (!event?.event_id) {
      sendSafeError(res, 400, "Square webhook is missing an event ID.");
      return;
    }

    const counts = inventoryCountsFromEvent(event, process.env.SQUARE_LOCATION_ID);
    const results = await Promise.all(counts.map(async (count) => {
      const result = await applyInventoryCount(
        supabaseAdmin,
        event.event_id,
        count
      );
      if (result.error) throw result.error;
      return result.data;
    }));
    const updated = results.reduce(
      (total, result) => total + Number(result?.updated_items || 0),
      0
    );

    res.json({ success: true, processed_counts: counts.length, updated_items: updated });
  } catch (error) {
    console.error("[Square inventory webhook failed]", error?.message || error);
    sendSafeError(res, 500, "Could not apply the Square inventory update.");
  }
});

app.post("/sync-square-inventory", requireAuth, async (req, res) => {
  try {
    const requestedIds = Array.isArray(req.body?.square_variation_ids)
      ? req.body.square_variation_ids
      : null;
    const result = await reconcileSquareInventory(requestedIds);
    await writeAudit(req, "square_inventory_reconciled", "inventory", null, result);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[Square inventory reconciliation failed]", error?.message || error);
    sendSafeError(res, 502, "Could not reconcile inventory with Square.");
  }
});

app.post("/square/reservations/:id/hold", async (req, res) => {
  try {
    const { reservation, item } = await loadReservationAndItem(req.params.id);
    if (
      !reservation ||
      !item ||
      !["pending", "ready"].includes(reservation.status) ||
      new Date(reservation.expires_at).getTime() <= Date.now()
    ) {
      sendSafeError(res, 409, "This reservation is no longer active.");
      return;
    }

    if (!item.square_variation_id) {
      res.json({ success: true, square_linked: false });
      return;
    }

    const { error: markError } = await supabaseAdmin
      .from("book_reservations")
      .update({
        square_hold_synced_at: reservation.square_hold_synced_at || new Date().toISOString(),
        square_hold_released_at: null,
        square_hold_error: null,
      })
      .eq("id", reservation.id);
    if (markError) throw markError;

    await synchronizeSquareReservationAvailability([item.id]);
    res.json({ success: true, square_linked: true });
  } catch (error) {
    console.error("[Square reservation hold failed]", error?.message || error);
    await supabaseAdmin
      ?.from("book_reservations")
      .update({ square_hold_error: "Square hold failed; retry required." })
      .eq("id", req.params.id);
    sendSafeError(res, 502, "Square could not hold this copy. Please try again.");
  }
});

app.post("/square/reservations/:id/resync", requireAuth, async (req, res) => {
  try {
    const { reservation, item } = await loadReservationAndItem(req.params.id);
    if (!reservation || !item) {
      sendSafeError(res, 404, "Reservation not found.");
      return;
    }
    const result = item.square_variation_id
      ? await synchronizeSquareReservationAvailability([item.id])
      : { checked: 0, updated: 0 };
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("[Square reservation resync failed]", error?.message || error);
    sendSafeError(res, 502, "Could not synchronize this reservation with Square.");
  }
});

app.post("/square/reservations/:id/release-for-checkout", requireAuth, async (req, res) => {
  try {
    const { reservation, item } = await loadReservationAndItem(req.params.id);
    if (!reservation || !item || reservation.status !== "ready") {
      sendSafeError(res, 409, "Only a ready reservation can be released for checkout.");
      return;
    }
    if (!item.square_variation_id) {
      res.json({ success: true, square_linked: false });
      return;
    }

    const { error: releaseError } = await supabaseAdmin
      .from("book_reservations")
      .update({ square_hold_released_at: new Date().toISOString(), square_hold_error: null })
      .eq("id", reservation.id);
    if (releaseError) throw releaseError;

    await synchronizeSquareReservationAvailability([item.id]);
    const { data: refreshedItem, error: refreshError } = await supabaseAdmin
      .from("items")
      .select("square_expected_quantity")
      .eq("id", item.id)
      .single();
    if (refreshError) throw refreshError;
    await supabaseAdmin
      .from("book_reservations")
      .update({ square_checkout_quantity: refreshedItem.square_expected_quantity })
      .eq("id", reservation.id);

    res.json({ success: true, square_linked: true });
  } catch (error) {
    console.error("[Square checkout release failed]", error?.message || error);
    sendSafeError(res, 502, "Could not release this copy for Square checkout.");
  }
});

app.post("/square/reservations/:id/return-to-hold", requireAuth, async (req, res) => {
  let reservation;
  let item;
  try {
    ({ reservation, item } = await loadReservationAndItem(req.params.id));
    if (
      !reservation ||
      !item ||
      reservation.status !== "ready" ||
      !reservation.square_hold_released_at ||
      new Date(reservation.expires_at).getTime() <= Date.now()
    ) {
      sendSafeError(res, 409, "Only an active checkout release can be put back on hold.");
      return;
    }
    if (!item.square_variation_id) {
      res.json({ success: true, square_linked: false });
      return;
    }

    const { error: holdError } = await supabaseAdmin
      .from("book_reservations")
      .update({
        square_hold_released_at: null,
        square_checkout_quantity: null,
        square_hold_error: null,
      })
      .eq("id", reservation.id);
    if (holdError) throw holdError;

    try {
      await synchronizeSquareReservationAvailability([item.id]);
    } catch (syncError) {
      await supabaseAdmin
        .from("book_reservations")
        .update({
          square_hold_released_at: reservation.square_hold_released_at,
          square_checkout_quantity: reservation.square_checkout_quantity,
          square_hold_error: "Square hold failed; retry required.",
        })
        .eq("id", reservation.id);
      throw syncError;
    }

    res.json({ success: true, square_linked: true });
  } catch (error) {
    console.error("[Square checkout return-to-hold failed]", error?.message || error);
    sendSafeError(res, 502, "Could not put this copy back on hold in Square.");
  }
});

app.post("/square/reservations/:id/verify-sale", requireAuth, async (req, res) => {
  try {
    const { reservation, item } = await loadReservationAndItem(req.params.id);
    if (!reservation || !item || reservation.status !== "ready") {
      sendSafeError(res, 409, "Only a ready reservation can be completed.");
      return;
    }
    if (!item.square_variation_id) {
      res.json({ success: true, sale_verified: false, square_linked: false });
      return;
    }
    if (!reservation.square_hold_released_at || reservation.square_checkout_quantity === null) {
      sendSafeError(res, 409, "Release this reservation for Square checkout first.");
      return;
    }

    await reconcileSquareInventory([item.square_variation_id]);
    const counts = await retrieveSquareInventoryCounts([item.square_variation_id]);
    const current = inventoryCountsFromEvent({
      type: "inventory.count.updated",
      created_at: new Date().toISOString(),
      data: { object: { inventory_counts: counts } },
    }, process.env.SQUARE_LOCATION_ID)[0];
    if (!current || current.quantity >= Number(reservation.square_checkout_quantity)) {
      sendSafeError(res, 409, "Square has not recorded this sale yet.");
      return;
    }
    res.json({ success: true, sale_verified: true, square_linked: true });
  } catch (error) {
    console.error("[Square reservation sale verification failed]", error?.message || error);
    sendSafeError(res, 502, "Could not verify this sale with Square.");
  }
});

app.get("/test-square", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await fetch(`${SQUARE_BASE_URL}/v2/locations`, {
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json({
      success: true,
      locations: data.locations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test-square-item", requireAuth, requireAdmin, async (req, res) => {
  try {
    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: Date.now().toString(),
          object: {
            type: "ITEM",
            id: "#TEMP_ITEM",
            item_data: {
              name: "IL HRC Test Book",
              description: "Created from IL HRC Inventory App",
              variations: [
                {
                  type: "ITEM_VARIATION",
                  id: "#TEMP_VARIATION",
                  item_variation_data: {
                    sku: "ILHRC-TEST-001",
                    pricing_type: "FIXED_PRICING",
                    price_money: {
                      amount: 100,
                      currency: "USD",
                    },
                  },
                },
              ],
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json({
      success: true,
      squareItemId: data.catalog_object?.id,
      data,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/update-square-inventory", requireAuth, async (req, res) => {
  try {
    const { square_variation_id, quantity } = req.body;

    if (!square_variation_id || quantity === undefined || quantity === null) {
      return res.status(400).json({
        success: false,
        error: "Missing square_variation_id or quantity.",
      });
    }

    const prepared = await prepareSquareAvailableQuantity(square_variation_id, quantity);
    let inventoryData;
    try {
      inventoryData = await setSquareInventoryPhysicalCount(
        square_variation_id,
        prepared.availableQuantity,
        `${square_variation_id}-inventory-${Date.now()}`
      );
    } catch (error) {
      await restoreSquareExpectation(prepared);
      throw error;
    }

    await writeAudit(req, "square_inventory_synced", "square_variation", square_variation_id, {
      physical_quantity: quantity,
      square_available_quantity: prepared.availableQuantity,
    });

    res.json({
      success: true,
      square_inventory_synced: true,
      data: inventoryData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/update-square-item", requireAuth, async (req, res) => {
  try {
    const {
      square_item_id,
      square_variation_id,
      title,
      sku,
      final_price,
      quantity,
      notes,
    } = req.body;

    if (!square_item_id || !square_variation_id) {
      return res.status(400).json({
        success: false,
        error: "Missing square_item_id or square_variation_id.",
      });
    }

    const amount = Math.round(Number(final_price || 0) * 100);

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object/${square_item_id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const existingData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: existingData,
      });
    }

    const itemObject = existingData.object;
    const variation =
      itemObject.item_data?.variations?.find(
        (v) => v.id === square_variation_id
      ) || itemObject.item_data?.variations?.[0];

    itemObject.item_data.name = title || itemObject.item_data.name;
    itemObject.item_data.description = notes || "";
    variation.item_variation_data.name = "Regular";
    variation.item_variation_data.sku = sku || variation.item_variation_data.sku;
    variation.item_variation_data.pricing_type = "FIXED_PRICING";
    variation.item_variation_data.track_inventory = true;
    variation.item_variation_data.price_money = {
      amount,
      currency: "USD",
    };

    const updateResponse = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: `${square_item_id}-update-${Date.now()}`,
          object: itemObject,
        }),
      }
    );

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      return res.status(updateResponse.status).json({
        success: false,
        error: updateData,
      });
    }

    if (quantity !== undefined && quantity !== null) {
      const prepared = await prepareSquareAvailableQuantity(square_variation_id, quantity);
      try {
        await setSquareInventoryPhysicalCount(
          square_variation_id,
          prepared.availableQuantity,
          `${square_variation_id}-edit-inventory-${Date.now()}`
        );
      } catch (error) {
        await restoreSquareExpectation(prepared);
        throw error;
      }
    }

    await writeAudit(req, "square_item_updated", "square_item", square_item_id, {
      square_variation_id,
      quantity,
    });

    res.json({
      success: true,
      square_item_updated: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/archive-square-item", requireAuth, async (req, res) => {
  try {
    const { square_item_id } = req.body;

    if (!square_item_id) {
      return res.status(400).json({
        success: false,
        error: "Missing square_item_id",
      });
    }

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object/${square_item_id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const existingData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: existingData,
      });
    }

    const itemObject = existingData.object;

    itemObject.is_deleted = false;
    itemObject.item_data.is_archived = true;

    const updateResponse = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: `archive-${square_item_id}-${Date.now()}`,
          object: itemObject,
        }),
      }
    );

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      return res.status(updateResponse.status).json({
        success: false,
        error: updateData,
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/unarchive-square-item", requireAuth, async (req, res) => {
  try {
    const { square_item_id } = req.body;

    if (!square_item_id) {
      return res.status(400).json({
        success: false,
        error: "Missing square_item_id",
      });
    }

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object/${square_item_id}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const existingData = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: existingData,
      });
    }

    const itemObject = existingData.object;
    itemObject.is_deleted = false;
    itemObject.item_data.is_archived = false;

    const updateResponse = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: `unarchive-${square_item_id}-${Date.now()}`,
          object: itemObject,
        }),
      }
    );

    const updateData = await updateResponse.json();

    if (!updateResponse.ok) {
      return res.status(updateResponse.status).json({
        success: false,
        error: updateData,
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error("Square unarchive failed:", error);

    res.status(500).json({
      success: false,
      error: error.message || error,
    });
  }
});

app.post("/create-square-item", requireAuth, async (req, res) => {
  try {
    const { title, sku, final_price, notes } = req.body;

    if (!title || !sku || final_price === undefined || final_price === null) {
      return res.status(400).json({
        success: false,
        error: "Missing title, sku, or final_price.",
      });
    }

    const amount = Math.round(Number(final_price) * 100);

    const response = await fetch(
      `${SQUARE_BASE_URL}/v2/catalog/object`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: `${sku}-${Date.now()}`,
          object: {
            type: "ITEM",
            id: "#ITEM",
            item_data: {
              name: title,
              description: notes || "",
              variations: [
                {
                  type: "ITEM_VARIATION",
                  id: "#VARIATION",
                  item_variation_data: {
                    name: "Regular",
                    sku,
                    track_inventory: true,
                    pricing_type: "FIXED_PRICING",
                    price_money: {
                      amount,
                      currency: "USD",
                    },
                  },
                },
              ],
            },
          },
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: data,
      });
    }



const variation = data.catalog_object?.item_data?.variations?.[0];

const quantity = req.body.quantity || 1;

const inventoryResponse = await fetch(
  `${SQUARE_BASE_URL}/v2/inventory/changes/batch-create`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotency_key: `${sku}-inventory-${Date.now()}`,
      changes: [
        {
          type: "PHYSICAL_COUNT",
          physical_count: {
            catalog_object_id: variation?.id,
            location_id: process.env.SQUARE_LOCATION_ID,
            quantity: String(quantity),
            state: "IN_STOCK",
            occurred_at: new Date().toISOString(),
          },
        },
      ],
    }),
  }
);

const inventoryData = await inventoryResponse.json();

if (!inventoryResponse.ok) {
  return res.status(inventoryResponse.status).json({
    success: false,
    error: inventoryData,
  });
}

res.json({
  success: true,
  square_item_id: data.catalog_object?.id,
  square_variation_id: variation?.id,
  square_inventory_synced: true,
});

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/analyze-curriculum", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const sourceType = String(req.body.source_type || "").trim().toLowerCase();
    if (!["link", "text", "pdf"].includes(sourceType)) {
      sendSafeError(res, 400, "Choose a publisher link, pasted text, or PDF.");
      return;
    }

    let sourceUrl = "";
    let sourceText = "";
    let pdfBuffer = null;
    let pdfFilename = "curriculum.pdf";

    if (sourceType === "link") {
      const requestedUrl = String(req.body.url || "").trim();
      if (!requestedUrl || requestedUrl.length > 2048) {
        sendSafeError(res, 400, "Enter a valid publisher link.");
        return;
      }
      const fetched = await fetchPublicCurriculumSource(requestedUrl);
      sourceUrl = fetched.url;
      if (fetched.kind === "pdf") {
        pdfBuffer = fetched.buffer;
        pdfFilename = fetched.filename;
      } else {
        sourceText = fetched.text;
      }
    } else if (sourceType === "text") {
      sourceText = String(req.body.text || "").trim().slice(0, MAX_SOURCE_TEXT);
      if (sourceText.length < 30) {
        sendSafeError(res, 400, "Paste more of the curriculum list before analyzing it.");
        return;
      }
    } else {
      const file = req.file;
      const looksLikePdf = file?.buffer?.subarray(0, 4).toString() === "%PDF";
      if (!file || (!looksLikePdf && file.mimetype !== "application/pdf")) {
        sendSafeError(res, 400, "Choose a PDF file.");
        return;
      }
      pdfBuffer = file.buffer;
      pdfFilename = String(file.originalname || "curriculum.pdf").slice(0, 200);
    }

    const checkedOn = new Date().toISOString().slice(0, 10);
    const content = [{
      type: "input_text",
      text: curriculumAnalysisPrompt({ sourceType, sourceUrl, checkedOn }),
    }];
    if (sourceText) {
      content.push({ type: "input_text", text: `SOURCE CONTENT\n---\n${sourceText}\n---\nEND SOURCE` });
    }
    if (pdfBuffer) {
      content.push({
        type: "input_file",
        filename: pdfFilename,
        file_data: `data:application/pdf;base64,${pdfBuffer.toString("base64")}`,
        detail: "high",
      });
    }

    const model = sourceType === "link"
      ? process.env.CURRICULUM_LINK_MODEL || "gpt-5.6-luna"
      : process.env.CURRICULUM_IMPORT_MODEL || "gpt-5.6-luna";
    const request = {
      model,
      input: [{ role: "user", content }],
      text: {
        format: {
          type: "json_schema",
          name: "curriculum_package_import",
          strict: true,
          schema: curriculumAnalysisSchema,
        },
      },
      max_output_tokens: 32_000,
    };
    if (sourceType === "link") request.tools = [{ type: "web_search" }];
    const response = await openai.responses.create(request);

    if (!response.output_text) throw new Error("The analysis returned no package data.");
    const analysis = normalizeAnalysisResult(JSON.parse(response.output_text), sourceUrl, checkedOn);
    if (!analysis.package.name || !analysis.materials.length) {
      analysis.warnings.unshift("The source did not provide a clear package name or material list. Review carefully or try another source format.");
    }

    await writeAudit(req, "analyze_curriculum", "curriculum_import", null, {
      source_type: sourceType,
      source_host: sourceUrl ? new URL(sourceUrl).hostname : null,
      materials_found: analysis.materials.length,
      package_offers_excluded: analysis.excluded_offers.length,
      model,
      input_tokens: response.usage?.input_tokens || null,
      output_tokens: response.usage?.output_tokens || null,
    });

    res.json({
      success: true,
      ...analysis,
      usage: {
        model,
        input_tokens: response.usage?.input_tokens || null,
        output_tokens: response.usage?.output_tokens || null,
      },
    });
  } catch (error) {
    console.error("Curriculum analysis failed:", error);
    sendSafeError(res, 500, error.message || "Could not analyze that curriculum source.");
  }
});

app.post("/analyze-book", requireAuth, upload.any(), async (req, res) => {
  try {
    const coverFile =
      req.files?.find((file) => file.fieldname === "cover") ||
      req.files?.find((file) => file.fieldname === "image");

    const isbnFile =
      req.files?.find((file) => file.fieldname === "isbnImage") ||
      req.files?.find((file) => file.fieldname === "isbn") ||
      req.files?.find((file) => file.fieldname === "barcode");

    if (!coverFile && !isbnFile) {
      return res.status(400).json({ error: "No image uploaded." });
    }

    const imageParts = [];

    if (coverFile) {
      imageParts.push({
        type: "input_image",
        image_url: `data:${coverFile.mimetype};base64,${coverFile.buffer.toString("base64")}`,
      });
    }

    if (isbnFile) {
      imageParts.push({
        type: "input_image",
        image_url: `data:${isbnFile.mimetype};base64,${isbnFile.buffer.toString("base64")}`,
      });
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
You are helping the Illinois Homeschool Resource Center catalog used homeschool curriculum and books.

Look at all uploaded images carefully. Images may include:

* Front cover
* Back cover
* Spine
* Copyright page
* Barcode / ISBN area

Identify the book as accurately as possible.

Return ONLY valid JSON in this exact format:

{
"title": "",
"curriculum": "",
"subject": "",
"grade": "",
"edition": "",
"isbn": "",
"confidence": 0.0,
"notes": ""
}

Rules:

* Use the exact title visible on the book whenever possible.
* Curriculum should be the homeschool publisher, curriculum provider, or educational brand if recognizable.

Common curriculum examples include:
Apologia, Abeka, BJU Press, Notgrass, IEW, Saxon, Math-U-See, Master Books, The Good and the Beautiful, Teaching Textbooks, Sonlight, Mystery of History, All About Reading, All About Spelling, Singapore Math, Alpha Omega, Lifepac, Bob Jones, Rod & Staff, Christian Light Education, Easy Grammar, Shurley English, Veritas Press, Memoria Press, Answers in Genesis, ACE, and Classical Conversations.

* If the curriculum is clearly visible, populate the curriculum field.

* If the curriculum is not visible but strongly implied by branding, use your best judgment.

* If uncertain, leave curriculum blank and explain in notes.

* Subject must be one of:
  Science, Math, History, Language Arts, Bible, Geography, Art, Music, Foreign Language, Preschool, Elective, General.

* Grade should be a simple value such as:
  Pre-K, K, 1, 2, 3, 4, 5, 6, 7, 8, 9-12, K-2, 3-5, 6-8, 7-8, High School.

* Look carefully for grade indicators in the title, subtitle, cover text, level markings, or series name.
  Examples:

  * "Math 5" → "5"
  * "Grade 3" → "3"
  * "Level K" → "K"
  * "Algebra 1" → "9-12"
  * "Biology" → "9-12" unless another grade is visible

* Edition should be short and standardized, such as:

  * "2nd Edition"
  * "3rd Edition"
  * "Revised Edition"
  * "Updated Edition"

* ISBN should only be included if clearly visible.

* Remove spaces and dashes from ISBN values.

* If no ISBN is visible, return an empty string.


* Confidence should be a number between 0.0 and 1.0 indicating overall confidence in the identification.

* Notes should briefly explain any uncertainty, assumptions, missing information, or alternate possibilities.

* Never invent information that is not supported by the images.

* Prefer leaving a field blank over guessing wildly.

* Return ONLY valid JSON and no additional text.

              `,
            },
            ...imageParts,
          ],
        },
      ],
    });

    let text = response.output_text.trim();

text = text
  .replace(/^```json/i, "")
  .replace(/^```/i, "")
  .replace(/```$/i, "")
  .trim();

const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to analyze image.",
      details: error.message,
    });
  }
});

const server = app.listen(5001, () => {
  console.log("Server running on http://localhost:5001");
});

server.on("error", (error) => {
  console.error("Server error:", error);
});

async function runScheduledSquareReconciliation() {
  if (!squareInventoryIsConfigured()) return;
  try {
    const trackingResult = await prepareSquareInventoryTracking();
    const salesResult = await synchronizeSquareSales();
    const inventoryResult = await reconcileSquareInventory();
    const reservationResult = await synchronizeSquareReservationAvailability();
    console.info("[Square inventory reconciled]", {
      tracking: trackingResult,
      sales: salesResult,
      inventory: inventoryResult,
      reservations: reservationResult,
    });
  } catch (error) {
    console.error("[Square inventory reconciliation failed]", error?.message || error);
  }
}

setTimeout(runScheduledSquareReconciliation, 5000).unref();
setInterval(runScheduledSquareReconciliation, 5 * 60 * 1000).unref();
