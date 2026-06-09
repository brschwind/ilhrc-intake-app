const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { createWorker } = require("tesseract.js");
require("dotenv").config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());

function guessCurriculum(text) {
  const lower = text.toLowerCase();

  if (lower.includes("apologia")) return "Apologia";
  if (lower.includes("abeka") || lower.includes("a beka")) return "Abeka";
  if (lower.includes("notgrass")) return "Notgrass";
  if (lower.includes("saxon")) return "Saxon";
  if (lower.includes("math-u-see") || lower.includes("math u see")) return "Math-U-See";
  if (lower.includes("iew") || lower.includes("institute for excellence in writing")) return "IEW";
  if (lower.includes("master books")) return "Master Books";
  if (lower.includes("good and the beautiful")) return "The Good and the Beautiful";
  if (lower.includes("bob jones") || lower.includes("bju")) return "BJU Press";

  return "";
}

function guessSubject(text) {
  const lower = text.toLowerCase();

  if (lower.includes("science") || lower.includes("biology") || lower.includes("chemistry")) return "Science";
  if (lower.includes("math") || lower.includes("algebra") || lower.includes("geometry")) return "Math";
  if (lower.includes("history") || lower.includes("america") || lower.includes("world")) return "History";
  if (lower.includes("grammar") || lower.includes("writing") || lower.includes("phonics")) return "Language Arts";
  if (lower.includes("bible")) return "Bible";

  return "General";
}

function guessEdition(text) {
  const match = text.match(/(\d+)(st|nd|rd|th)?\s+edition/i);
  return match ? `${match[1]}${match[2] || ""} Edition` : "";
}

function guessGrade(text) {
  const lower = text.toLowerCase();

  if (lower.includes("general science")) return "7-8";
  if (lower.includes("physical science")) return "8-9";
  if (lower.includes("biology")) return "9-12";
  if (lower.includes("chemistry")) return "10-12";
  if (lower.includes("kindergarten")) return "K";
  if (lower.includes("preschool")) return "PreK";

  return "";
}

async function searchGoogleBooks(query) {
  try {
    const cleanQuery = query.replace(/[^0-9Xx]/g, "");

const searchTerm =
  cleanQuery.length === 10 || cleanQuery.length === 13
    ? `isbn:${cleanQuery}`
    : query;

const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchTerm)}&maxResults=1`;
console.log("GOOGLE BOOKS URL:", url);

    const response = await fetch(url);
    const data = await response.json();
    console.log("GOOGLE BOOKS RESPONSE:", JSON.stringify(data).slice(0, 500));

    if (!data.items || data.items.length === 0) return null;

    const book = data.items[0].volumeInfo;

    return {
      title: book.title || "",
      authors: book.authors || [],
      publisher: book.publisher || "",
      publishedDate: book.publishedDate || "",
      isbn:
        book.industryIdentifiers?.find((id) => id.type === "ISBN_13")?.identifier ||
        book.industryIdentifiers?.find((id) => id.type === "ISBN_10")?.identifier ||
        "",
    };
} catch (error) {
  console.error("GOOGLE BOOKS ERROR:", error.message);
  return null;
}
}

app.get("/", (req, res) => {
  res.send("IL HRC OCR Server Running");
});

app.get("/lookup-isbn/:isbn", async (req, res) => {
  try {
    const isbn = req.params.isbn;
    const googleBook = await searchGoogleBooks(isbn);

    if (!googleBook) {
      return res.status(404).json({
        error: "No book found for that ISBN.",
      });
    }

    res.json({
      title: googleBook.title,
      curriculum: guessCurriculum(
        `${googleBook.title} ${googleBook.publisher}`
      ),
      subject: guessSubject(googleBook.title),
      grade: guessGrade(googleBook.title),
      edition: guessEdition(googleBook.title),
      isbn: googleBook.isbn || isbn,
      confidence: 0.95,
      notes: "Matched by ISBN through Google Books.",
    });
  } catch (error) {
    res.status(500).json({
      error: "ISBN lookup failed.",
      details: error.message,
    });
  }
});

app.post(
  "/analyze-book",
  upload.any(),
  async (req, res) => {
  try {
    console.log("FILES RECEIVED:", req.files?.map((file) => file.fieldname));

const coverFile =
  req.files?.find((file) => file.fieldname === "cover") ||
  req.files?.find((file) => file.fieldname === "image");

const isbnFile =
  req.files?.find((file) => file.fieldname === "isbnImage") ||
  req.files?.find((file) => file.fieldname === "isbn") ||
  req.files?.find((file) => file.fieldname === "barcode");

if (!coverFile && !isbnFile) {
  return res.status(400).json({
    error: "No images uploaded.",
  });
}

const worker = await createWorker("eng");

let visibleText = "";
let isbnText = "";

if (coverFile) {
  const coverResult = await worker.recognize(coverFile.buffer);
  visibleText = coverResult.data.text.trim();
}

if (isbnFile) {
  const isbnResult = await worker.recognize(isbnFile.buffer);
  isbnText = isbnResult.data.text.trim();
}

await worker.terminate();
    const isbnMatch =
  isbnText.match(/\b97[89]\d{10}\b/) ||
  isbnText.match(/\b\d{10}\b/);

const detectedISBN = isbnMatch ? isbnMatch[0] : "";
    const googleBook = await searchGoogleBooks(
  detectedISBN || visibleText
);

    const title =
      googleBook?.title ||
      visibleText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" ");

    res.json({
      visible_text: visibleText,
      title,
      curriculum: guessCurriculum(visibleText + " " + title),
      subject: guessSubject(visibleText + " " + title),
      grade: guessGrade(visibleText + " " + title),
      edition: guessEdition(visibleText + " " + title),
      isbn: detectedISBN || googleBook?.isbn || "",
      confidence:
  detectedISBN
    ? 0.98
    : googleBook
      ? 0.8
      : 0.55,
      notes: googleBook
        ? "Matched through OCR and Google Books lookup."
        : "Used OCR only. AI fallback may improve this later.",
    });
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