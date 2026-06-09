const express = require("express");
const cors = require("cors");
const multer = require("multer");
const OpenAI = require("openai");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/", (req, res) => {
  res.send("IL HRC AI Vision Server Running");
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

Look at the uploaded image(s). They may include:
- front cover
- back cover
- barcode / ISBN area

Identify the book as accurately as possible.

Return ONLY valid JSON in this exact format:

{
  "title": "",
  "curriculum": "",
  "subject": "",
  "grade": "",
  "edition": "",
  "isbn": "",
  "confidence": 0.0 to 1.0
  "notes": ""
}

Rules:
- Use the title visible on the book cover if available.
- Curriculum should be the homeschool publisher/brand if recognizable, such as Apologia, Abeka, BJU Press, Notgrass, IEW, Saxon, Math-U-See, Master Books, The Good and the Beautiful, etc.
- Subject should be one of: Science, Math, History, Language Arts, Bible, Geography, Art, Music, Foreign Language, Preschool, Elective, General.
- Grade should be a simple range like "7-8", "9-12", "K-2", or blank if unclear.
- Edition should be short, like "2nd Edition".
- ISBN should only be included if clearly visible.
- If uncertain, explain briefly in notes.
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