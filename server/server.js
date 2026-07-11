const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
const { createClient } = require("@supabase/supabase-js");
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
app.use(express.json({ limit: "1mb" }));

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

function sendSafeError(res, status, message) {
  res.status(status).json({
    success: false,
    error: message,
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

    if (!match) {
      sendSafeError(res, 401, "Sign in to continue.");
      return;
    }

    const { data, error } = await supabaseAuth.auth.getUser(match[1]);

    if (error || !data?.user) {
      sendSafeError(res, 401, "Your session is no longer valid.");
      return;
    }

    const profile = await loadProfile(data.user.id);

    if (!profile || profile.is_active === false) {
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
    sendSafeError(res, 400, "Could not send the invitation.");
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

    const inventoryResponse = await fetch(
      `${SQUARE_BASE_URL}/v2/inventory/changes/batch-create`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          idempotency_key: `${square_variation_id}-inventory-${Date.now()}`,
          changes: [
            {
              type: "PHYSICAL_COUNT",
              physical_count: {
                catalog_object_id: square_variation_id,
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

    await writeAudit(req, "square_inventory_synced", "square_variation", square_variation_id, {
      quantity,
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
      const inventoryResponse = await fetch(
        `${SQUARE_BASE_URL}/v2/inventory/changes/batch-create`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            idempotency_key: `${square_variation_id}-edit-inventory-${Date.now()}`,
            changes: [
              {
                type: "PHYSICAL_COUNT",
                physical_count: {
                  catalog_object_id: square_variation_id,
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
"weight_ounces": null,
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

* Weight_ounces should be a numeric estimated shipping weight in ounces when you can make a reasonable estimate from the item type, size, format, and visible clues. Use null if there is not enough information. Do not guess wildly.

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

setInterval(() => {}, 1000);
