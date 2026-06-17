const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("IL HRC AI Vision Server Running");
});

app.get("/test-square", async (req, res) => {
  try {
    const response = await fetch("https://connect.squareupsandbox.com/v2/locations", {
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

app.get("/test-square-item", async (req, res) => {
  try {
    const response = await fetch(
      "https://connect.squareupsandbox.com/v2/catalog/object",
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

app.post("/update-square-inventory", async (req, res) => {
  try {
    const { square_variation_id, quantity } = req.body;

    if (!square_variation_id || quantity === undefined || quantity === null) {
      return res.status(400).json({
        success: false,
        error: "Missing square_variation_id or quantity.",
      });
    }

    const inventoryResponse = await fetch(
      "https://connect.squareupsandbox.com/v2/inventory/changes/batch-create",
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

app.post("/update-square-item", async (req, res) => {
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
      `https://connect.squareupsandbox.com/v2/catalog/object/${square_item_id}?include_related_objects=true`,
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
      "https://connect.squareupsandbox.com/v2/catalog/object",
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
        "https://connect.squareupsandbox.com/v2/inventory/changes/batch-create",
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

app.post("/archive-square-item", async (req, res) => {
  try {
    const { square_item_id } = req.body;

    if (!square_item_id) {
      return res.status(400).json({
        success: false,
        error: "Missing square_item_id",
      });
    }

    const response = await fetch(
      `https://connect.squareupsandbox.com/v2/catalog/object/${square_item_id}`,
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
      "https://connect.squareupsandbox.com/v2/catalog/object",
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

app.post("/unarchive-square-item", async (req, res) => {
  console.log("UNARCHIVE ROUTE HIT");
  console.log(req.body);
  try {
    const { square_item_id } = req.body;

    if (!square_item_id) {
      return res.status(400).json({
        success: false,
        error: "Missing square_item_id",
      });
    }

    const response = await squareClient.catalogApi.upsertCatalogObject({
      idempotencyKey: crypto.randomUUID(),
      object: {
        type: "ITEM",
        id: square_item_id,
        presentAtAllLocations: true,
        itemData: {},
      },
    });

    res.json({
      success: true,
      result: response.result,
    });
  } catch (error) {
    console.error("Square unarchive failed:", error);

    res.status(500).json({
      success: false,
      error: error.message || error,
    });
  }
});

app.post("/create-square-item", async (req, res) => {
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
      "https://connect.squareupsandbox.com/v2/catalog/object",
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
  "https://connect.squareupsandbox.com/v2/inventory/changes/batch-create",
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

app.post("/analyze-book", upload.any(), async (req, res) => {
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

setInterval(() => {}, 1000);