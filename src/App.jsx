import { useRef, useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import "./App.css";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

const pricingGuide = [
  { item_name: "DVD (Education/Movies)", category: "Media", price: 5 },
  { item_name: "Dollar", category: "Reading", price: 1 },
  { item_name: "Picture Book", category: "Reading", price: 2 },
  { item_name: "Readers (Early)", category: "Reading", price: 0.5 },
  { item_name: "Reading Book", category: "Reading", price: 4 },
  { item_name: "Reading Book (Premium)", category: "Reading", price: 6 },
  { item_name: "Flashcards", category: "Supplements", price: 0.5 },
  { item_name: "Games", category: "Supplements", price: 5 },
  { item_name: "Kit (Science)", category: "Supplements", price: 25 },
  { item_name: "Kit (Premium)", category: "Supplements", price: 50 },
  { item_name: "Manipulatives (Large)", category: "Supplements", price: 10 },
  { item_name: "Manipulatives (Small)", category: "Supplements", price: 5 },
  { item_name: "Reference/Skill Books (Premium)", category: "Supplements", price: 6 },
  { item_name: "Reference/Skill Books", category: "Supplements", price: 3 },
  { item_name: "Answer Key", category: "Textbooks & Teacher", price: 1 },
  { item_name: "Textbook (Hardcover)", category: "Textbooks & Teacher", price: 10 },
  { item_name: "Textbook (Premium)", category: "Textbooks & Teacher", price: 15 },
  { item_name: "Textbook (Softcover)", category: "Textbooks & Teacher", price: 5 },
  { item_name: "Box Set", category: "Workbooks (Consumable)", price: 25 },
  { item_name: "Box Set (Premium)", category: "Workbooks (Consumable)", price: 40 },
  { item_name: "Workbook - Full year/curriculum", category: "Workbooks (Consumable)", price: 8 },
  { item_name: "Workbook - Premium", category: "Workbooks (Consumable)", price: 12 },
  { item_name: "Workbook - Small", category: "Workbooks (Consumable)", price: 2 },
];

export default function App() {
  const [view, setView] = useState("add");
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  const coverInputRef = useRef(null);
  const isbnInputRef = useRef(null);

  const [coverPhoto, setCoverPhoto] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [isbnPhoto, setIsbnPhoto] = useState(null);
  const [isbnFile, setIsbnFile] = useState(null);
  const [bookData, setBookData] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [editingItem, setEditingItem] = useState(null);
  const [editData, setEditData] = useState(null);

  const [curriculumFilter, setCurriculumFilter] = useState("");
  const [subjectFilter, setSubjectFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");

  const [pendingSearchTerm, setPendingSearchTerm] = useState("");
  const [pendingCurriculumFilter, setPendingCurriculumFilter] = useState("");
  const [pendingSubjectFilter, setPendingSubjectFilter] = useState("");
  const [pendingCategoryFilter, setPendingCategoryFilter] = useState("");
  const [pendingGradeFilter, setPendingGradeFilter] = useState("");

  const [selectedCatalogItem, setSelectedCatalogItem] = useState(null);

  const [sortBy, setSortBy] = useState("title");
  const [isScanningBarcode, setIsScanningBarcode] = useState(false);

  const listingPhotoInputRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);

  const editPhotoInputRef = useRef(null);
  const [editCoverFile, setEditCoverFile] = useState(null);
  const [editCoverPreview, setEditCoverPreview] = useState(null);

  const [analysisStatus, setAnalysisStatus] = useState("");
        useEffect(() => {
        loadItems();
        loadOptionLists();
      }, []);

  const [curriculumOptions, setCurriculumOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [gradeOptions, setGradeOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [selectedItemIds, setSelectedItemIds] = useState([]);

  const [bulkCurriculum, setBulkCurriculum] = useState("");
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkGrade, setBulkGrade] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const [bulkPublicVisible, setBulkPublicVisible] = useState("");

  const [currentLocation, setCurrentLocation] = useState("");
  const [labelLocationFilter, setLabelLocationFilter] = useState("");

  const [locationFilter, setLocationFilter] = useState("");

  async function loadItems() {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      alert("Could not load inventory: " + error.message);
      return;
    }

    setItems(data || []);
  }

async function loadOptionLists() {
  const { data: curricula } = await supabase
    .from("curriculum_options")
    .select("name")
    .order("name");

  const { data: subjects } = await supabase
    .from("subject_options")
    .select("name")
    .order("name");

  const { data: grades } = await supabase
    .from("grade_options")
    .select("name")
    .order("name");
    

    const { data: categories } = await supabase
      .from("category_options")
      .select("*")
      .order("name");

  setCurriculumOptions(curricula?.map((x) => x.name) || []);
  setSubjectOptions(subjects?.map((x) => x.name) || []);
  setGradeOptions(grades?.map((x) => x.name) || []);
  setCategoryOptions(categories || []);
}

function toggleSelectedItem(id) {
  setSelectedItemIds((current) =>
    current.includes(id)
      ? current.filter((itemId) => itemId !== id)
      : [...current, id]
  );
}

async function bulkDeleteSelected() {
  if (selectedItemIds.length === 0) return;

  const confirmed = window.confirm(
    `Delete ${selectedItemIds.length} selected item(s)? This will also archive them in Square.`
  );

  if (!confirmed) return;

  try {
    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.id)
    );

    for (const item of selectedItems) {
      const squareItemId = item.square_item_id;

      if (squareItemId) {
        const archiveRes = await fetch(
          "https://ilhrc-intake-app.onrender.com/archive-square-item",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              square_item_id: squareItemId,
            }),
          }
        );

        const archiveData = await archiveRes.json();

        if (!archiveRes.ok || !archiveData.success) {
          throw new Error(
            archiveData?.error ||
              `Failed to archive Square item: ${item.title}`
          );
        }
      }
    }

    const { error } = await supabase
      .from("items")
      .delete()
      .in("id", selectedItemIds);

    if (error) throw error;

    setItems((prev) =>
      prev.filter((item) => !selectedItemIds.includes(item.id))
    );

    setSelectedItemIds([]);

    alert("Selected items archived in Square and deleted.");
  } catch (err) {
  console.error("Bulk delete failed full error:", err);

  let message = "Unknown error";

  try {
    message =
      err?.message ||
      err?.error?.message ||
      err?.errors?.[0]?.detail ||
      err?.errors?.[0]?.message ||
      JSON.stringify(err);
  } catch {
    message = String(err);
  }

  alert("Bulk delete failed: " + message);
}}


async function applyBulkEdit() {
  const updates = {};

  if (bulkCurriculum) updates.curriculum = bulkCurriculum;
  if (bulkSubject) updates.subject = bulkSubject;
  if (bulkGrade) updates.grade_level = bulkGrade;
  if (bulkStatus) updates.status = bulkStatus;
  if (bulkCategory) updates.category = bulkCategory;
  if (bulkPublicVisible === "show") updates.public_visible = true;
  if (bulkPublicVisible === "hide") updates.public_visible = false;

  if (Object.keys(updates).length === 0) {
    alert("Choose at least one field to update.");
    return;
  }

  try {
    const shouldArchiveInSquare =
      bulkStatus === "Sold" || bulkStatus === "Removed";

    if (shouldArchiveInSquare) {
      const selectedItems = items.filter((item) =>
        selectedItemIds.includes(item.id)
      );

      for (const item of selectedItems) {
        if (item.square_item_id) {
          const archiveResponse = await fetch(
            "https://ilhrc-intake-app.onrender.com/archive-square-item",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                square_item_id: item.square_item_id,
              }),
            }
          );

          const archiveData = await archiveResponse.json();

          if (!archiveResponse.ok || !archiveData.success) {
            throw new Error(
              "Square archive failed for " +
                item.title +
                ": " +
                JSON.stringify(archiveData.error)
            );
          }
        }
      }
    }

    const { error } = await supabase
      .from("items")
      .update(updates)
      .in("id", selectedItemIds);

    if (error) throw error;

    alert(`Updated ${selectedItemIds.length} items.`);

    setSelectedItemIds([]);
    setBulkCurriculum("");
    setBulkSubject("");
    setBulkGrade("");
    setBulkStatus("");
    setBulkCategory("");
    setBulkPublicVisible("");

    loadItems();
  } catch (error) {
    alert("Bulk edit failed: " + error.message);
  }
}


function handleCoverPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setCoverPhoto(URL.createObjectURL(file));
  setCoverFile(file);
  setBookData(null);

  analyzePhotoWithFile(file);
}


  function handleIsbnPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsbnPhoto(URL.createObjectURL(file));
    setIsbnFile(file);
    setBookData(null);
  }

function handleListingPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setCoverPhoto(URL.createObjectURL(file));
  setCoverFile(file);
}

function handleEditCoverPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setEditCoverFile(file);
  setEditCoverPreview(URL.createObjectURL(file));
}

function suggestPricingCategory(book) {
  const text = `${book.title || ""} ${book.publisher || ""} ${
    book.categories?.join(" ") || ""
  }`.toLowerCase();

  if (!categoryOptions.length) return null;

  let suggestedName = "Reader / Chapter Book";

  if (
    text.includes("student activity") ||
    text.includes("student workbook") ||
    text.includes("workbook")
  ) {
    suggestedName = "Workbook";
  } else if (
    text.includes("answer key") ||
    text.includes("solution") ||
    text.includes("solutions manual")
  ) {
    suggestedName = "Answer Key";
  } else if (
    text.includes("teacher") ||
    text.includes("manual") ||
    text.includes("resource")
  ) {
    suggestedName = "Teacher Resource";
  } else if (
    text.includes("bible")
  ) {
    suggestedName = "Bible";
  } else if (
    text.includes("devotional") ||
    text.includes("devotion")
  ) {
    suggestedName = "Devotional";
  } else if (
    text.includes("biography") ||
    text.includes("memoir")
  ) {
    suggestedName = "Biography";
  } else if (
    text.includes("picture book")
  ) {
    suggestedName = "Picture Book";
  } else if (
    text.includes("early reader") ||
    text.includes("beginning reader")
  ) {
    suggestedName = "Early Reader";
  } else if (
    text.includes("science kit") ||
    text.includes("experiment kit")
  ) {
    suggestedName = "Science Kit";
  } else if (
    text.includes("dvd") ||
    text.includes("video")
  ) {
    suggestedName = "DVD / Media";
  } else if (
    text.includes("game")
  ) {
    suggestedName = "Game";
  } else if (
    text.includes("flashcard") ||
    text.includes("flash card")
  ) {
    suggestedName = "Flashcards";
  } else if (
    text.includes("science") ||
    text.includes("history") ||
    text.includes("math") ||
    text.includes("grammar") ||
    text.includes("textbook")
  ) {
    suggestedName = "Textbook";
  }

  return categoryOptions.find((item) => item.name === suggestedName);
}

async function lookupBookByIsbn(isbn) {
  try {
    // 1. Try Google Books first
    const googleUrl =
  `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&key=${import.meta.env.VITE_GOOGLE_BOOKS_API_KEY}`;
const googleResponse = await fetch(googleUrl);
const googleData = await googleResponse.json();

    if (googleData.items && googleData.items.length > 0) {
      const book = googleData.items[0].volumeInfo;
      const suggested = suggestPricingCategory(book);

const coverUrl =
  book.imageLinks?.thumbnail ||
  book.imageLinks?.smallThumbnail ||
  "";

setBookData({
  title: book.title || "",
  curriculum: "",
  publisher: book.publisher || "",
  subject: book.categories?.[0] || "",
  grade_level: "",
  edition: "",
  isbn,
  category: suggested?.name || "",
  suggested_price: suggested?.default_price || "",
  final_price: suggested?.default_price || "",
  quantity: 1,
  status: "Available",
  notes: book.description || "",
  confidence: "Google Books ISBN lookup",
  public_visible: true,
  image_url: "",});

      return;
    }

    // 2. Try Open Library second
    const openLibraryResponse = await fetch(
      `https://openlibrary.org/isbn/${isbn}.json`
    );

    if (openLibraryResponse.ok) {
      const openLibraryData = await openLibraryResponse.json();
      const suggested = suggestPricingCategory({
  title: openLibraryData.title || "",
  publisher: openLibraryData.publishers?.[0] || "",
  categories: [],
});

      setBookData({
        title: openLibraryData.title || "",
        curriculum: openLibraryData.publishers?.[0] || "",
        subject: "",
        grade_level: "",
        edition: "",
        isbn,
       category: suggested?.item_name || "",
        suggested_price: suggested?.price || "",
        final_price: suggested?.price || "",
        quantity: 1,
        status: "Available",
        notes: "",
        confidence: "Open Library ISBN lookup",
        public_visible: true,
      });

      return;
    }

    // 3. If neither source finds it, still fill ISBN
    setBookData({
      title: "",
      curriculum: "",
      subject: "",
      grade_level: "",
      edition: "",
      isbn,
      category: "",
      final_price: "",
      quantity: 1,
      status: "Available",
      notes: "",
      confidence: "ISBN scanned only",
      public_visible: true,
    });

    alert("ISBN scanned, but no book data was found. You can enter the details manually.");
  } catch (error) {
    alert("Book lookup failed: " + error.message);
  }
}

async function scanIsbnBarcode() {
  setIsScanningBarcode(true);

  try {
    const codeReader = new BrowserMultiFormatReader();

    const result = await codeReader.decodeOnceFromVideoDevice(
      undefined,
      "barcode-video"
    );

const scannedIsbn = result.getText();

alert(`ISBN scanned: ${scannedIsbn}`);

await lookupBookByIsbn(scannedIsbn);
  } catch (error) {
    alert("Barcode scan failed: " + error.message);
  } finally {
    setIsScanningBarcode(false);
  }
}

function improveDetectedBookData(data) {
  const text = `${data.title || ""} ${data.curriculum || ""} ${
    data.notes || ""
  }`.toLowerCase();

  let curriculum = data.curriculum || "";
  let grade_level = data.grade_level || data.grade || "";

  if (text.includes("teaching textbook")) curriculum = "Teaching Textbooks";
  if (text.includes("notgrass")) curriculum = "Notgrass";
  if (text.includes("apologia")) curriculum = "Apologia";
  if (text.includes("abeka") || text.includes("a beka")) curriculum = "Abeka";
  if (text.includes("bju") || text.includes("bob jones")) curriculum = "BJU Press";
  if (text.includes("master books")) curriculum = "Master Books";
  if (text.includes("saxon")) curriculum = "Saxon Math";
  if (text.includes("math-u-see")) curriculum = "Math-U-See";
  if (text.includes("good and beautiful")) curriculum = "The Good and the Beautiful";
  if (grade_level === "Kindergarten") grade_level = "K";
  if (grade_level === "PK") grade_level = "Pre-K";
  if (grade_level === "Preschool") grade_level = "Pre-K";

  const gradeMatch =
    text.match(/\bgrade\s*(\d{1,2})\b/) ||
    text.match(/\bmath\s*(\d{1,2})\b/) ||
    text.match(/\blevel\s*(\d{1,2}|k)\b/);

  if (!grade_level && gradeMatch) {
    grade_level = gradeMatch[1].toUpperCase();
  }

  return {
    ...data,
    curriculum,
    grade_level,
  };
}

async function analyzePhotoWithFile(file) {
  setIsAnalyzing(true);
  setAnalysisStatus("Preparing image...");

  try {
    const formData = new FormData();
    formData.append("cover", file);

    setAnalysisStatus("Sending image to AI server...");

    const response = await fetch("https://ilhrc-intake-app.onrender.com/analyze-book", {
      method: "POST",
      body: formData,
    });

    setAnalysisStatus("Reading AI response...");

    const data = await response.json();

    if (!response.ok) {
      setAnalysisStatus("");
      alert(data.details || data.error || "Analysis failed");
      return;
    }

    setAnalysisStatus("Filling book details...");
    const improvedData = improveDetectedBookData(data);
    const suggested = suggestPricingCategory(improvedData);

setBookData({
  ...improvedData,
  category: improvedData.category || suggested?.name || "",
  suggested_price:
    improvedData.suggested_price || suggested?.default_price || "",
  final_price:
    improvedData.final_price || suggested?.default_price || "",
});


    setAnalysisStatus("Analysis complete!");
    setTimeout(() => setAnalysisStatus(""), 2500);
  } catch (error) {
    setAnalysisStatus("");
    alert(
      "Could not connect to the server. The AI server may be waking up. Try again in about 30 seconds. Details: " +
        error.message
    );
  } finally {
    setIsAnalyzing(false);
  }
}

  async function generateSku() {
  const { data, error } = await supabase
    .from("items")
    .select("sku")
    .like("sku", "ILHRC-%");

  if (error) {
    throw new Error("Could not generate SKU: " + error.message);
  }

  const highestNumber = (data || []).reduce((highest, item) => {
    const number = Number((item.sku || "").replace("ILHRC-", ""));
    return number > highest ? number : highest;
  }, 0);

  const nextNumber = highestNumber + 1;

  return `ILHRC-${String(nextNumber).padStart(6, "0")}`;
}

async function saveOptionIfNew(tableName, value) {
  const cleanedValue = (value || "").trim();

  if (!cleanedValue || cleanedValue === "Other") return;

  const { error } = await supabase
    .from(tableName)
    .insert([{ name: cleanedValue }]);

  if (error && error.code !== "23505") {
    alert(`Could not save option to ${tableName}: ${error.message}`);
  }
}

function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/\bfirst grade\b/g, "1")
    .replace(/\bsecond grade\b/g, "2")
    .replace(/\bthird grade\b/g, "3")
    .replace(/\bfourth grade\b/g, "4")
    .replace(/\bfifth grade\b/g, "5")
    .replace(/\bsixth grade\b/g, "6")
    .replace(/\bseventh grade\b/g, "7")
    .replace(/\beighth grade\b/g, "8")
    .replace(/\bgrade\b/g, "")
    .replace(/\bstudent workbook\b/g, "workbook")
    .replace(/\bstudent text\b/g, "textbook")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

async function saveItem() {
  if (!bookData || isSaving) return;

  setIsSaving(true);

  try {
    let imageUrl = "";

    if (coverFile) {
      const fileExt = coverFile.type?.split("/")[1] || "jpg";
      const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("book-covers")
        .upload(fileName, coverFile, {
          contentType: coverFile.type || "image/jpeg",
        });

      if (uploadError) {
        alert("Image upload failed: " + uploadError.message);
        return;
      }

      const { data } = supabase.storage
        .from("book-covers")
        .getPublicUrl(fileName);

      imageUrl = data.publicUrl;
    }

    const newSku = await generateSku();

    let squareItemId = "";
    let squareVariationId = "";

    await saveOptionIfNew("curriculum_options", bookData.curriculum);
    await saveOptionIfNew("category_options", bookData.category);

    await loadOptionLists();

  const itemToSave = {
    sku: newSku,
    title: bookData.title || "",
    curriculum: bookData.curriculum || "",
    publisher: bookData.publisher || "",
    subject: bookData.subject || "",
    grade_level: bookData.grade_level || bookData.grade || "",
    edition: bookData.edition || "",
    isbn: bookData.isbn || "",
    category: bookData.category || "",
    location: currentLocation || "",
    suggested_price: bookData.suggested_price || null,
    final_price:
      bookData.final_price === "" ||
      bookData.final_price === null ||
      bookData.final_price === undefined ||
      bookData.final_price === "null"
        ? null
        : Number(bookData.final_price),
    quantity: bookData.quantity ? Number(bookData.quantity) : 1,
    status: bookData.status || "Available",
    notes: bookData.notes || "",
    image_url: imageUrl || bookData.image_url || "",
    ai_confidence:
      typeof bookData.confidence === "number" ? bookData.confidence : null,
    public_visible: true,
  };

const { data: possibleMatches, error: searchError } = await supabase
  .from("items")
  .select("*")
  .eq("curriculum", itemToSave.curriculum)
  .eq("category", itemToSave.category);

if (searchError) {
  alert("Could not check for existing item: " + searchError.message);
  return;
}

const existingItems = (possibleMatches || []).filter((item) => {
  const sameTitle =
    normalizeTitle(item.title) === normalizeTitle(itemToSave.title);

 const sameEdition =
  String(item.edition || "").trim().toLowerCase() ===
  String(itemToSave.edition || "").trim().toLowerCase();

  const samePrice =
    Number(item.final_price || 0) === Number(itemToSave.final_price || 0);

const sameGrade =
  String(item.grade_level || "").trim().toLowerCase() ===
  String(itemToSave.grade_level || "").trim().toLowerCase();

  return sameTitle && sameEdition && samePrice && sameGrade;
});


  if (existingItems && existingItems.length > 0) {
    const existingItem = existingItems[0];

    const newQuantity =
      Number(existingItem.quantity || 0) + Number(itemToSave.quantity || 1);

    const { error: updateError } = await supabase
      .from("items")
      .update({
        quantity: newQuantity,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingItem.id);

    if (updateError) {
      alert("Quantity update failed: " + updateError.message);
      return;
    }

if (existingItem.square_variation_id) {
  const squareInventoryResponse = await fetch(
    "https://ilhrc-intake-app.onrender.com/update-square-inventory",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        square_variation_id: existingItem.square_variation_id,
        quantity: newQuantity,
      }),
    }
  );

const squareInventoryText = await squareInventoryResponse.text();

let squareInventoryData;
try {
  squareInventoryData = JSON.parse(squareInventoryText);
} catch {
  alert(
    "Square inventory sync returned a non-JSON response. The backend route may not be deployed yet."
  );
  return;
}
  if (!squareInventoryResponse.ok || !squareInventoryData.success) {
    alert(
      "Supabase quantity updated, but Square inventory did not sync. " +
        JSON.stringify(squareInventoryData.error)
    );
    return;
  }
}

    alert("Existing item found. Quantity updated!");
} else {
  const squareResponse = await fetch(
    "https://ilhrc-intake-app.onrender.com/create-square-item",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: itemToSave.title || "Untitled Book",
        sku: itemToSave.sku,
        final_price: itemToSave.final_price || 0,
        quantity: itemToSave.quantity || 1,
        notes: itemToSave.notes || "",
      }),
    }
  );

  const squareData = await squareResponse.json();

  if (!squareResponse.ok || !squareData.success) {
    alert(
      "Square item creation failed. Book was not saved. " +
        JSON.stringify(squareData.error)
    );
    return;
  }

  const itemWithSquareIds = {
    ...itemToSave,
    square_item_id: squareData.square_item_id,
    square_variation_id: squareData.square_variation_id,
  };

  const { error: insertError } = await supabase
    .from("items")
    .insert([itemWithSquareIds]);

  if (insertError) {
    alert("Save failed: " + insertError.message);
    return;
  }

  alert("New item saved!");
}

  setBookData(null);
  setCoverPhoto(null);
  setCoverFile(null);
  setIsbnPhoto(null);
  setIsbnFile(null);

  } catch (error) {
    alert("Save failed: " + error.message);
  } finally {
    setIsSaving(false);
  }
} 

  function startEditing(item) {
    setEditingItem(item);
    setEditData({
      ...item,
      final_price: item.final_price ?? "",
      quantity: item.quantity ?? 1,
    });
  }

  function cancelEditing() {
    setEditingItem(null);
    setEditData(null);
    setEditCoverFile(null);
    setEditCoverPreview(null);
  }

async function deleteItem() {
  if (!editingItem?.id) {
    alert("No item ID found. Cannot delete.");
    return;
  }

  const confirmed = confirm(
    `Delete "${editingItem.title}" from inventory? This cannot be undone.`
  );

  if (!confirmed) return;

  if (editingItem.square_item_id) {
  const squareResponse = await fetch(
    "https://ilhrc-intake-app.onrender.com/archive-square-item",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        square_item_id: editingItem.square_item_id,
      }),
    }
  );

  const squareData = await squareResponse.json();

  if (!squareResponse.ok || !squareData.success) {
    alert(
      "Square archive failed. Item was NOT deleted. " +
        JSON.stringify(squareData.error)
    );
    return;
  }
}

  const { data, error } = await supabase
    .from("items")
    .delete()
    .eq("id", editingItem.id)
    .select();

  if (error) {
    alert("Delete failed: " + error.message);
    return;
  }

  if (!data || data.length === 0) {
    alert(
      "Delete did not remove anything. This is usually a Supabase Row Level Security policy issue."
    );
    return;
  }

  alert("Item deleted!");

  setEditingItem(null);
  setEditData(null);
  loadItems();
}

async function updateItem() {
  if (!editingItem || !editData) return;

  await saveOptionIfNew("category_options", editData.category);

  await loadOptionLists();

  let updatedImageUrl = editData.image_url || "";

  if (editCoverFile) {
    const fileExt = editCoverFile.type?.split("/")[1] || "jpg";
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("book-covers")
      .upload(fileName, editCoverFile, {
        contentType: editCoverFile.type || "image/jpeg",
      });

    if (uploadError) {
      alert("Image upload failed: " + uploadError.message);
      return;
    }

    const { data } = supabase.storage
      .from("book-covers")
      .getPublicUrl(fileName);

    updatedImageUrl = data.publicUrl;
  }

  let squareItemId = editingItem.square_item_id || "";
  let squareVariationId = editingItem.square_variation_id || "";

  const isRestoringToAvailable =
    editData.status === "Available" &&
    editingItem.status !== "Available";

  const shouldArchive =
    editData.status === "Sold" ||
    editData.status === "Removed" ||
    Number(editData.quantity || 0) <= 0;

  // If restoring, create a NEW Square item instead of unarchiving
  if (isRestoringToAvailable) {
    const squareResponse = await fetch(
      "https://ilhrc-intake-app.onrender.com/create-square-item",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editData.title || "Untitled Book",
          sku: editData.sku || "",
          final_price: editData.final_price || 0,
          quantity: editData.quantity || 1,
          notes: editData.notes || "",
        }),
      }
    );

    const squareData = await squareResponse.json();

    if (!squareResponse.ok || !squareData.success) {
      alert(
        "Could not recreate item in Square. Supabase was not updated. " +
          JSON.stringify(squareData.error)
      );
      return;
    }

    squareItemId = squareData.square_item_id;
    squareVariationId = squareData.square_variation_id;
  }

  // Normal Square update, but skip this when restoring because we just created a fresh item
  if (
    !isRestoringToAvailable &&
    squareItemId &&
    squareVariationId
  ) {
    const squareUpdateResponse = await fetch(
      "https://ilhrc-intake-app.onrender.com/update-square-item",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          square_item_id: squareItemId,
          square_variation_id: squareVariationId,
          title: editData.title || "",
          sku: editData.sku || "",
          final_price: editData.final_price || 0,
          quantity: editData.quantity || 0,
          notes: editData.notes || "",
        }),
      }
    );

    const squareUpdateData = await squareUpdateResponse.json();

    if (!squareUpdateResponse.ok || !squareUpdateData.success) {
      alert(
        "Square update failed. Supabase was not updated. " +
          JSON.stringify(squareUpdateData.error)
      );
      return;
    }
  }

  // Archive if marked Sold/Removed or quantity is 0
  if (shouldArchive && squareItemId) {
    const archiveResponse = await fetch(
      "https://ilhrc-intake-app.onrender.com/archive-square-item",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          square_item_id: squareItemId,
        }),
      }
    );

    const archiveData = await archiveResponse.json();

    if (!archiveResponse.ok || !archiveData.success) {
      alert(
        "Square archive failed. Supabase was not updated. " +
          JSON.stringify(archiveData.error)
      );
      return;
    }

    if (Number(editData.quantity || 0) <= 0) {
      editData.status = "Sold";
    }
  }

  const { error } = await supabase
    .from("items")
    .update({
      title: editData.title || "",
      curriculum: editData.curriculum || "",
      subject: editData.subject || "",
      publisher: editData.publisher || "",
      grade_level: editData.grade_level || "",
      edition: editData.edition || "",
      isbn: editData.isbn || "",
      category: editData.category || "",
      final_price:
        editData.final_price === "" || editData.final_price === null
          ? null
          : Number(editData.final_price),
      quantity: Number(editData.quantity || 0),
      status: editData.status || "Available",
      notes: editData.notes || "",
      sku: editData.sku || "",
      updated_at: new Date().toISOString(),
      public_visible: editData.public_visible !== false,
      image_url: updatedImageUrl,
      square_item_id: squareItemId,
      square_variation_id: squareVariationId,
    })
    .eq("id", editingItem.id);

  if (error) {
    alert("Update failed: " + error.message);
    return;
  }

  alert("Item updated!");

  setEditingItem(null);
  setEditData(null);
  loadItems();
}


async function markLabelsPrinted() {
  if (labelItems.length === 0) {
    alert("No labels to mark printed.");
    return;
  }

  const confirmed = confirm(
    `Mark ${labelItems.length} titles as printed?`
  );

  if (!confirmed) return;

  const ids = labelItems.map((item) => item.id);

  const { error } = await supabase
    .from("items")
    .update({
      label_printed: true,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) {
    alert("Could not mark labels printed: " + error.message);
    return;
  }

  alert("Labels marked as printed!");
  loadItems();
}

function generateLabels(itemsToPrint) {
  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "in",
    format: [2, 1],
  });

  let firstLabel = true;

  itemsToPrint.forEach((item) => {
    const quantity = Number(item.quantity || 1);

    for (let i = 0; i < quantity; i++) {
      if (!firstLabel) {
        pdf.addPage([2, 1], "landscape");
      }

      firstLabel = false;

      const title = item.title || "Untitled";
      const price =
        item.final_price !== null && item.final_price !== undefined
          ? `$${Number(item.final_price).toFixed(2)}`
          : "";

      const sku = item.sku || "";
      const barcodeValue = sku;
      const barcodeCanvas = document.createElement("canvas");

      JsBarcode(barcodeCanvas, barcodeValue, {
        format: "CODE128",
        displayValue: false,
        margin: 10,
        width: 2,
        height: 42,
      });

      const barcodeImage = barcodeCanvas.toDataURL("image/png");

      // Tiny label branding
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(5.5);
      pdf.text("Illinois Homeschool Resource Center", 0.08, 0.14);

      // Title
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.text(title.substring(0, 30), 0.08, 0.28);

      // Price
      pdf.setFontSize(11);
      pdf.text(price, 0.08, 0.43);

      // Optimized barcode      
      pdf.addImage(barcodeImage, "PNG", 0.08, 0.49, 1.84, 0.34);

      // Human-readable barcode number
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(barcodeValue, 1.0, 0.93, { align: "center" });    }
  });

  pdf.save("ILHRC-labels.pdf");
}

const labelLocationOptions = [
  ...new Set(
    items
      .map((item) => item.location)
      .filter(Boolean)
      .sort()
  ),
];

const inventoryLocationOptions = [
  ...new Set(
    items
      .map((item) => item.location)
      .filter(Boolean)
      .sort()
  ),
];

const labelItems = items.filter(
  (item) =>
    item.label_printed !== true &&
    Number(item.quantity || 0) > 0 &&
    (!labelLocationFilter ||
      item.location === labelLocationFilter)
);

const filteredItems = items.filter((item) => {
  const text = `
    ${item.title || ""}
    ${item.curriculum || ""}
    ${item.subject || ""}
    ${item.grade_level || ""}
    ${item.isbn || ""}
    ${item.sku || ""}
    ${item.category || ""}
  `.toLowerCase();

  const matchesSearch = text.includes(searchTerm.toLowerCase());

  const matchesCurriculum =
    !curriculumFilter || item.curriculum === curriculumFilter;

  const matchesSubject =
    !subjectFilter || item.subject === subjectFilter;

  const matchesCategory =
    !categoryFilter || item.category === categoryFilter;

  const matchesGrade =
    !gradeFilter || item.grade_level === gradeFilter;

    const matchesLocation =
  !locationFilter || item.location === locationFilter;

 return (
  matchesSearch &&
  matchesCurriculum &&
  matchesSubject &&
  matchesCategory &&
  matchesGrade &&
  matchesLocation
);
});



const publicItems = items.filter(
  (item) =>
    (item.status || "Available") === "Available" &&
    item.public_visible !== false
);

const filteredCatalogItems = publicItems
  .filter((item) => {
    const matchesSearch = (item.title || "")
      .toLowerCase()
      .includes(searchTerm.toLowerCase());

    const matchesCurriculum =
      !curriculumFilter || item.curriculum === curriculumFilter;

    const matchesSubject =
      !subjectFilter || item.subject === subjectFilter;

    const matchesCategory =
      !categoryFilter || item.category === categoryFilter;

    const matchesGrade =
      !gradeFilter || item.grade_level === gradeFilter;

    return (
      matchesSearch &&
      matchesCurriculum &&
      matchesSubject &&
      matchesCategory &&
      matchesGrade
    );
  })
  .sort((a, b) => {
    if (sortBy === "title") {
      return (a.title || "").localeCompare(b.title || "");
    }

    if (sortBy === "curriculum") {
      return (a.curriculum || "").localeCompare(b.curriculum || "");
    }

    if (sortBy === "priceLow") {
      return Number(a.final_price || 0) - Number(b.final_price || 0);
    }

    if (sortBy === "priceHigh") {
      return Number(b.final_price || 0) - Number(a.final_price || 0);
    }

    if (sortBy === "newest") {
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    }

    return 0;
  });

const catalogCurriculumOptions = [
  ...new Set(
    items
      .map((item) => item.curriculum)
      .filter(Boolean)
      .sort()
  ),
];

const catalogSubjectOptions = [
  ...new Set(
    items
      .map((item) => item.subject)
      .filter(Boolean)
      .sort()
  ),
];

const catalogCategoryOptions = [
  ...new Set(
    items
      .map((item) => item.category)
      .filter(Boolean)
      .sort()
  ),
];

const catalogGradeOptions = [
  ...new Set(
    items
      .map((item) => item.grade_level)
      .filter(Boolean)
      .sort()
  ),
];

const totalTitles = items.length;

const totalCopies = items.reduce(
  (sum, item) => sum + Number(item.quantity || 0),
  0
);

const totalValue = items.reduce(
  (sum, item) =>
    sum + Number(item.final_price || 0) * Number(item.quantity || 0),
  0
);

const availableCopies = items.reduce((sum, item) => {
  if ((item.status || "Available") === "Available") {
    return sum + Number(item.quantity || 0);
  }
  return sum;
}, 0);

const soldCopies = items.reduce((sum, item) => {
  if ((item.status || "") === "Sold") {
    return sum + Number(item.quantity || 0);
  }
  return sum;
}, 0);

function applyCatalogFilters() {
  setSearchTerm(pendingSearchTerm);
  setCurriculumFilter(pendingCurriculumFilter);
  setSubjectFilter(pendingSubjectFilter);
  setCategoryFilter(pendingCategoryFilter);
  setGradeFilter(pendingGradeFilter);
}

function clearCatalogFilters() {
  setPendingSearchTerm("");
  setPendingCurriculumFilter("");
  setPendingSubjectFilter("");
  setPendingCategoryFilter("");
  setPendingGradeFilter("");

  setSearchTerm("");
  setCurriculumFilter("");
  setSubjectFilter("");
  setCategoryFilter("");
  setGradeFilter("");
  setLocationFilter("");
}

  return (
    <main className="app">
      <h1>IL HRC Book Intake</h1>

{view !== "catalog" && (
  <div className="nav-buttons">        <button
          className={view === "add" ? "primary" : "secondary"}
          onClick={() => {
            setView("add");
            cancelEditing();
          }}
        >
          <label>Add Item</label>
        </button>

        <button
          className={view === "inventory" ? "primary" : "secondary"}
          onClick={() => {
            setView("inventory");
            cancelEditing();
            loadItems();
          }}
        >
          Inventory
        </button>

        <button
  className={view === "labels" ? "primary" : "secondary"}
  onClick={() => {
    setView("labels");
    cancelEditing();
    loadItems();
  }}
>
  Print Labels
</button>

        <button
  className={view === "catalog" ? "primary" : "secondary"}
onClick={() => {
  setView("catalog");
  cancelEditing();
  setSelectedCatalogItem(null);
  loadItems();
}}
>
  Public Catalog
</button>

      </div>
)}
   {view === "add" && (
  <>
    <p>Use the cover photo and ISBN/barcode when available.</p>

    <div className="location-box">
      <label>Current Location</label>
      <input
        placeholder="Example: Box 1, Tub A, Cart 2"
        value={currentLocation}
        onChange={(e) => setCurrentLocation(e.target.value)}
      />
      <p className="helper-text">
        This location will be saved with each book until you change it.
      </p>
    </div>


          <button className="secondary" onClick={scanIsbnBarcode}>
  {isScanningBarcode ? "Scanning..." : "Scan ISBN Barcode"}
</button>

<video
  id="barcode-video"
  className="barcode-video"
  hidden={!isScanningBarcode}
/>

<input
  id="cover-upload"
  ref={coverInputRef}
  type="file"
  accept="image/*"
  capture="environment"
  onChange={handleCoverPhoto}
  className="visually-hidden-file"
/>

<label htmlFor="cover-upload" className="secondary file-upload-button">
  Analyze Book Cover
</label>

{analysisStatus && (
  <p className="status-message">{analysisStatus}</p>
)}


          <input
            ref={isbnInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleIsbnPhoto}
            hidden
          />

          {coverPhoto && (
            <section className="preview">
              <h2>Cover</h2>
              <img src={coverPhoto} alt="Book cover" />
            </section>
          )}

          {isbnPhoto && (
            <section className="preview">
              <h2>ISBN / Barcode</h2>
              <img src={isbnPhoto} alt="ISBN or barcode" />
            </section>
          )}


          {bookData && (
            <section className="card">
  <h2>Review & Edit Details</h2>

<button
  className="secondary"
  onClick={() => listingPhotoInputRef.current.click()}
>
  Add Actual Cover Photo to Listing
</button>

<input
  ref={listingPhotoInputRef}
  type="file"
  accept="image/*"
  capture="environment"
  onChange={handleListingPhoto}
  hidden
/>


              <label>Title</label>
              <input
                value={bookData.title || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, title: e.target.value })
                }
              />

              <label>Curriculum</label>
              <select
              value={
                curriculumOptions.includes(bookData.curriculum)
                  ? bookData.curriculum
                  : "Other"
              }
              onChange={(e) =>
                setBookData({
                  ...bookData,
                  curriculum: e.target.value === "Other" ? "" : e.target.value,
                })
              }
            >
              <option value="">Choose curriculum</option>
              {curriculumOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

            {(!curriculumOptions.includes(bookData.curriculum) ||
              bookData.curriculum === "") && (
              <>
                <input
                  placeholder="Add new curriculum"
                  value={bookData.curriculum || ""}
                  onChange={(e) =>
                    setBookData({ ...bookData, curriculum: e.target.value })
                  }
                />

                <p className="helper-text">
                  This will be added to your curriculum list when you save.
                </p>
              </>
            )}

<label>Publisher</label>
<input
  value={bookData.publisher || ""}
  onChange={(e) =>
    setBookData({
      ...bookData,
      publisher: e.target.value,
    })
  }
/>


              <label>Subject</label>
              <select
              value={bookData.subject || ""}
              onChange={(e) =>
                  setBookData({
                    ...bookData,
                    subject: e.target.value,
                  })
                }
            >
              <option value="">Choose subject</option>
              {subjectOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

           
              <label>Grade Level</label>
              <select
              value={
                gradeOptions.includes(bookData.grade_level || bookData.grade)
                  ? (bookData.grade_level || bookData.grade)
                  : "Other"
              }
              onChange={(e) =>
                setBookData({
                  ...bookData,
                  grade_level: e.target.value === "Other" ? "" : e.target.value,
                })
              }
            >
              <option value="">Choose grade level</option>
              {gradeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>

          
              <label>Edition</label>
              <input
                value={bookData.edition || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, edition: e.target.value })
                }
              />

              <label>ISBN</label>
              <input
                value={bookData.isbn || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, isbn: e.target.value })
                }
              />

              <label>Category</label>
              <select
                value={bookData.category || ""}
                onChange={(e) => {
                  const selected = categoryOptions.find(
                    (item) => item.name === e.target.value
                  );

                 setBookData({
                ...bookData,
                category: selected?.name || "",
                suggested_price: selected?.default_price || "",
                final_price: selected?.default_price || "",
              });
                }}
              >
                <option value="">Choose a category</option>
 
                {categoryOptions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>

                {bookData.category && (
                  <p>
                    <strong>Suggested Price:</strong> $
                    {
                      categoryOptions.find(
                        (item) => item.name === bookData.category
                      )?.default_price
                    }
                  </p>
                )} 

              <label>Final Price</label>
              <input
                type="number"
                step="0.01"
                value={bookData.final_price || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, final_price: e.target.value })
                }
              />

              <label>Quantity</label>
              <input
                type="number"
                min="1"
                value={bookData.quantity || 1}
                onChange={(e) =>
                  setBookData({ ...bookData, quantity: e.target.value })
                }
              />

              <label>Status</label>
              <select
                value={bookData.status || "Available"}
                onChange={(e) =>
                  setBookData({ ...bookData, status: e.target.value })
                }
              >
                <option>Available</option>
                <option>Sold</option>
                <option>Hold</option>
                <option>Removed</option>
              </select>

              

              <label>Notes</label>
              <textarea
                value={bookData.notes || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, notes: e.target.value })
                }
              />

              <p>
                <strong>AI Confidence:</strong> {bookData.confidence}
              </p>

              <button className="primary" onClick={saveItem} disabled={isSaving}>
  {isSaving ? "Saving..." : "Save Item"}
</button>
            </section>
          )}
        </>
      )}

      {view === "inventory" && (
        <section className="card">
          <h2>Inventory</h2>
        <div className="stats-grid">
  <div className="stat-card">
    <strong>Total Titles</strong>
    <span>{totalTitles}</span>
  </div>

  <div className="stat-card">
    <strong>Total Copies</strong>
    <span>{totalCopies}</span>
  </div>

  <div className="stat-card">
    <strong>Inventory Value</strong>
    <span>${totalValue.toFixed(2)}</span>
  </div>

  <div className="stat-card">
    <strong>Available Copies</strong>
    <span>{availableCopies}</span>
  </div>

  <div className="stat-card">
    <strong>Sold Copies</strong>
    <span>{soldCopies}</span>
  </div>
</div>


<input
  placeholder="Search title, curriculum, subject, grade, ISBN, SKU..."
  value={searchTerm}
  onChange={(e) => setSearchTerm(e.target.value)}
/>

<div className="catalog-filters">
  <select
    value={curriculumFilter}
    onChange={(e) => setCurriculumFilter(e.target.value)}
  >
    <option value="">All Curricula</option>
    {catalogCurriculumOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={subjectFilter}
    onChange={(e) => setSubjectFilter(e.target.value)}
  >
    <option value="">All Subjects</option>
    {catalogSubjectOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={categoryFilter}
    onChange={(e) => setCategoryFilter(e.target.value)}
  >
    <option value="">All Categories</option>
    {catalogCategoryOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={gradeFilter}
    onChange={(e) => setGradeFilter(e.target.value)}
  >
    <option value="">All Grades</option>
    {catalogGradeOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={locationFilter}
    onChange={(e) => setLocationFilter(e.target.value)}
  >
    <option value="">All Locations</option>
    {inventoryLocationOptions.map((location) => (
      <option key={location} value={location}>
        {location}
      </option>
    ))}
  </select>

</div>
       
          {editData && (
            <section className="card">
              <h2>Edit Item</h2>

              <label>Cover Photo</label>

            {(editCoverPreview || editData.image_url) && (
              <section className="preview">
                <img
                  src={editCoverPreview || editData.image_url}
                  alt="Book cover"
                />
              </section>
            )}

            <button
              className="secondary"
              onClick={() => editPhotoInputRef.current.click()}
            >
              Add / Replace Cover Photo
            </button>

            <input
              ref={editPhotoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleEditCoverPhoto}
              hidden
            />
              
              <label>SKU</label>
              <input
                value={editData.sku || ""}
                onChange={(e) =>
                  setEditData({ ...editData, sku: e.target.value })
                }
              />

              <label>Title</label>
              <input
                value={editData.title || ""}
                onChange={(e) =>
                  setEditData({ ...editData, title: e.target.value })
                }
              />

<label>Curriculum</label>
<select
  value={
    curriculumOptions.includes(editData.curriculum)
      ? editData.curriculum
      : "Other"
  }
  onChange={(e) =>
    setEditData({
      ...editData,
      curriculum: e.target.value === "Other" ? "" : e.target.value,
    })
  }
>
  <option value="">Choose curriculum</option>
  {curriculumOptions.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ))}
</select>

{(!curriculumOptions.includes(editData.curriculum) ||
  editData.curriculum === "") && (
  <input
    placeholder="Enter curriculum"
    value={editData.curriculum || ""}
    onChange={(e) =>
      setEditData({ ...editData, curriculum: e.target.value })
    }
  />
)}

<label>Subject</label>
<select
  value={editData.subject || ""}
  onChange={(e) =>
  setEditData({
    ...editData,
    subject: e.target.value,
  })
}
>
  <option value="">Choose subject</option>
  {subjectOptions.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ))}
</select>

<label>Grade Level</label>
<select
  value={
    gradeOptions.includes(editData.grade_level)
      ? editData.grade_level
      : "Other"
  }
  onChange={(e) =>
    setEditData({
      ...editData,
      grade_level: e.target.value === "Other" ? "" : e.target.value,
    })
  }
>
  <option value="">Choose grade level</option>
  {gradeOptions.map((option) => (
    <option key={option} value={option}>
      {option}
    </option>
  ))}
</select>

              <label>Edition</label>
              <input
                value={editData.edition || ""}
                onChange={(e) =>
                  setEditData({ ...editData, edition: e.target.value })
                }
              />

              <label>ISBN</label>
              <input
                value={editData.isbn || ""}
                onChange={(e) =>
                  setEditData({ ...editData, isbn: e.target.value })
                }
              />

              <label>Category</label>
              <select
                value={editData.category || ""}
                onChange={(e) => {
                  const selected = categoryOptions.find(
                    (item) => item.name === e.target.value
                  );

                  setEditData({
                    ...editData,
                    category: selected?.name || "",
                    final_price: editData.final_price || selected?.default_price || "",
                  });
                }}
              >
                <option value="">Choose a category</option>
                {categoryOptions.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>

              {editData.category && (
                <p>
                  <strong>Suggested Price:</strong> $
                  {categoryOptions.find((item) => item.name === editData.category)
                    ?.default_price || ""}
                </p>
              )}

              <label>Final Price</label>
              <input
                type="number"
                step="0.01"
                value={editData.final_price || ""}
                onChange={(e) =>
                  setEditData({ ...editData, final_price: e.target.value })
                }
              />

              <label>Quantity</label>
              <input
                type="number"
                min="1"
                value={editData.quantity || 1}
                onChange={(e) =>
                  setEditData({ ...editData, quantity: e.target.value })
                }
              />

              <label>Status</label>
              <select
                value={editData.status || "Available"}
                onChange={(e) =>
                  setEditData({ ...editData, status: e.target.value })
                }
              >
                <option>Available</option>
                <option>Sold</option>
                <option>Hold</option>
                <option>Removed</option>
</select>

<label className="checkbox-label">
  <input
    type="checkbox"
    checked={editData.public_visible !== false}
    onChange={(e) =>
      setEditData({
        ...editData,
        public_visible: e.target.checked,
      })
    }
  />
  Show in Public Catalog
</label>

<label>Notes</label>
<textarea
                value={editData.notes || ""}
                onChange={(e) =>
                  setEditData({ ...editData, notes: e.target.value })
                }
              />

            <button className="primary" onClick={updateItem}>
              Save Changes
            </button>

            <button className="secondary" onClick={cancelEditing}>
              Cancel
            </button>

            <button className="danger" onClick={deleteItem}>
              Delete Item
            </button>
            </section>
          )}

              {(searchTerm ||
                curriculumFilter ||
                subjectFilter ||
                categoryFilter ||
                gradeFilter) && (
                <button
                  type="button"
                  className="filter-reset"
                  onClick={() => {
                    setSearchTerm("");
                    setCurriculumFilter("");
                    setSubjectFilter("");
                    setCategoryFilter("");
                    setGradeFilter("");
                    setLocationFilter("");
                  }}
                >
                  Reset Filters
                </button>
              )}

              <div className="selection-toolbar">
              <span>
                <strong>{selectedItemIds.length}</strong> selected
              </span>

              <button
                type="button"
                className="text-button"
                onClick={() => setSelectedItemIds(filteredItems.map((item) => item.id))}
              >
                Select visible
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => setSelectedItemIds(items.map((item) => item.id))}
              >
                Select all
              </button>

              <button
                type="button"
                className="text-button"
                onClick={() => setSelectedItemIds([])}
              >
                Clear
              </button>
            </div>

            {(searchTerm ||
            curriculumFilter ||
            subjectFilter ||
            categoryFilter ||
            gradeFilter) && (
            <button
              type="button"
              className="filter-reset"
              onClick={() => {
                setSearchTerm("");
                setCurriculumFilter("");
                setSubjectFilter("");
                setCategoryFilter("");
                setGradeFilter("");
                setLocationFilter("");
              }}
            >
              Reset Filters
            </button>
          )}

{selectedItemIds.length > 0 && (
 <div className="bulk-edit-bar">
    <div className="bulk-edit-field">
  <label>Curriculum</label>
  <select
    value={bulkCurriculum}
    onChange={(e) => setBulkCurriculum(e.target.value)}
  >
    <option value="">No Change</option>
    {curriculumOptions.map((option) => (
      <option key={option} value={option}>
        {option}
      </option>
    ))}
  </select>
</div>

    <div className="bulk-edit-field">
  <label>Subject</label>
  <select
    value={bulkSubject}
    onChange={(e) => setBulkSubject(e.target.value)}
  >
    <option value="">No Change</option>
    {subjectOptions.map((option) => (
      <option key={option} value={option}>
        {option}
      </option>
    ))}
  </select>
</div>

   <div className="bulk-edit-field">
  <label>Grade Level</label>
  <select
    value={bulkGrade}
    onChange={(e) => setBulkGrade(e.target.value)}
  >
    <option value="">No Change</option>
    {gradeOptions.map((option) => (
      <option key={option} value={option}>
        {option}
      </option>
    ))}
  </select>
</div>

<div className="bulk-edit-field">
  <label>Category</label>
  <select
    value={bulkCategory}
    onChange={(e) => setBulkCategory(e.target.value)}
  >
    <option value="">No Change</option>
    {categoryOptions.map((option) => (
      <option key={option.name} value={option.name}>
        {option.name}
      </option>
    ))}
  </select>
</div>

    <div className="bulk-edit-field">
  <label>Status</label>
  <select
    value={bulkStatus}
    onChange={(e) => setBulkStatus(e.target.value)}
  >
    <option value="">No Change</option>
    <option value="Available">Available</option>
    <option value="Sold">Sold</option>
    <option value="Hold">Hold</option>
    <option value="Removed">Removed</option>
  </select>
</div>

<div className="bulk-edit-field">
  <label>Public Catalog</label>
  <select
    value={bulkPublicVisible}
    onChange={(e) => setBulkPublicVisible(e.target.value)}
  >
    <option value="">No Change</option>
    <option value="show">Show</option>
    <option value="hide">Hide</option>
  </select>
</div>

    <div className="bulk-actions">
  <button
    type="button"
    className="primary"
    onClick={applyBulkEdit}
  >
    Apply to Selected
  </button>

 <button
  type="button"
  className="secondary"
  disabled={selectedItemIds.length === 0}
  onClick={(e) => {
    e.preventDefault();

    const itemsToPrint = items.filter((item) =>
      selectedItemIds.includes(item.id)
    );

    if (itemsToPrint.length === 0) {
      alert("No selected items to print.");
      return;
    }

    generateLabels(itemsToPrint);
  }}
>
  Print Labels
</button>

<button
  type="button"
  className="bulk-delete-btn"
  onClick={(e) => {
    e.preventDefault();
    bulkDeleteSelected();
  }}
>
  Delete
</button>
</div>
  </div>
)}

          {filteredItems.length === 0 && <p>No matching items found.</p>}

          {filteredItems.map((item) => (
            <div className="inventory-item" key={item.id}>
              <input
                type="checkbox"
                checked={selectedItemIds.includes(item.id)}
                onChange={() => toggleSelectedItem(item.id)}
              />
              {item.image_url && <img src={item.image_url} alt={item.title} />}

              <div>
                <h3>{item.title}</h3>
                <p><strong>SKU:</strong> {item.sku}</p>

<p><strong>Publisher:</strong> {item.publisher || "Unknown"}</p>

<p>
  {item.curriculum} • {item.subject} • {item.grade_level}
</p>
                <p>
                  ${item.final_price} • Qty: {item.quantity}
                </p>
                <p>Status: {item.status}</p>
                  <p><strong>Location:</strong> {item.location || "Not set"}</p>
                  <p>
                    Public: {item.public_visible !== false ? "Yes" : "No"}
                  </p>
                <button
                  className="secondary"
                  onClick={() => startEditing(item)}
                >
                  Edit
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {view === "labels" && (
        <section className="card">
          <h2>Print Labels</h2>

          <p>
            These are items that have not been marked as label printed yet.
          </p>

<label>Storage Location</label>

<select
  value={labelLocationFilter}
  onChange={(e) => setLabelLocationFilter(e.target.value)}
>
  <option value="">All Locations</option>

  {labelLocationOptions.map((location) => (
    <option key={location} value={location}>
      {location}
    </option>
  ))}
</select>

          <button
  className="primary"
  onClick={() => {
    generateLabels(labelItems);
  }}
>
  Generate Labels
</button>

<button
  className="secondary"
  onClick={markLabelsPrinted}
>
  Mark Labels Printed
</button>

          <p>
  {labelItems.length} titles waiting for labels
</p>



          {labelItems.length === 0 && (
            <p>No labels waiting to print.</p>
          )}

          {labelItems.map((item) => (
            <div className="inventory-item" key={item.id}>
              {item.image_url && (
                <img src={item.image_url} alt={item.title} />
              )}

              <div>
                <h3>{item.title}</h3>
                <p><strong>SKU:</strong> {item.sku}</p>
                <p><strong>Price:</strong> ${item.final_price}</p>
                <p><strong>Quantity:</strong> {item.quantity}</p>
                <p><strong>Category:</strong> {item.category}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {view === "catalog" && (
  <section className="card">
    <h2>Public Catalog Preview</h2>
    <p>
      These are the items families would see in the public searchable catalog.
    </p>

{selectedCatalogItem && (
  <section className="catalog-detail">
    <button
      className="secondary"
      onClick={() => setSelectedCatalogItem(null)}
    >
      ← Back to Catalog
    </button>

    {selectedCatalogItem.image_url && (
      <img
        src={selectedCatalogItem.image_url}
        alt={selectedCatalogItem.title}
        className="catalog-detail-image"
      />
    )}

    <h2>{selectedCatalogItem.title}</h2>

    <p><strong>Curriculum:</strong> {selectedCatalogItem.curriculum || "N/A"}</p>
    <p><strong>Subject:</strong> {selectedCatalogItem.subject || "N/A"}</p>
    <p><strong>Grade Level:</strong> {selectedCatalogItem.grade_level || "N/A"}</p>
    <p><strong>Category:</strong> {selectedCatalogItem.category || "N/A"}</p>
    <p><strong>Edition:</strong> {selectedCatalogItem.edition || "N/A"}</p>
    <p><strong>ISBN:</strong> {selectedCatalogItem.isbn || "N/A"}</p>
    <p><strong>Price:</strong> ${selectedCatalogItem.final_price}</p>
    <p><strong>Available:</strong> {selectedCatalogItem.quantity || 1}</p>

    <p className="catalog-note">Available in store</p>
  </section>
)}

{!selectedCatalogItem && (
  <>

    <input
      placeholder="Search title, curriculum, subject, grade..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />

<div className="catalog-filters">

  <select
    value={pendingCurriculumFilter}
    onChange={(e) => setPendingCurriculumFilter(e.target.value)}
  >
    <option value="">All Curricula</option>
    {catalogCurriculumOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={pendingSubjectFilter}
    onChange={(e) => setPendingSubjectFilter(e.target.value)}
  >
    <option value="">All Subjects</option>
    {catalogSubjectOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={pendingCategoryFilter}
    onChange={(e) => setPendingCategoryFilter(e.target.value)}
  >
    <option value="">All Categories</option>
    {catalogCategoryOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

  <select
    value={pendingGradeFilter}
    onChange={(e) => setPendingGradeFilter(e.target.value)}
  >
    <option value="">All Grades</option>
    {catalogGradeOptions.map((item) => (
      <option key={item} value={item}>
        {item}
      </option>
    ))}
  </select>

</div>

<label>Sort By</label>
<select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
  <option value="title">Title A-Z</option>
  <option value="curriculum">Curriculum</option>
  <option value="priceLow">Price Low-High</option>
  <option value="priceHigh">Price High-Low</option>
  <option value="newest">Newest Added</option>
</select>

<button className="primary" onClick={applyCatalogFilters}>
  Apply Filters
</button>

<button className="secondary" onClick={clearCatalogFilters}>
  Clear Filters
</button>

{filteredCatalogItems.map((item) => (
        <div className="catalog-item" key={item.id}>
          {item.image_url && <img src={item.image_url} alt={item.title} />}

          <div>
            <h3>{item.title}</h3>

            {item.curriculum && <p>{item.curriculum}</p>}

            <p>
              {item.subject} {item.grade_level && `• ${item.grade_level}`}
            </p>

            <p>
              <strong>${item.final_price}</strong>
            </p>

            <p className="catalog-note">Available in store</p>
            <button
            className="secondary"
            onClick={() => setSelectedCatalogItem(item)}
          >
            View Details
          </button>
          </div>
        </div>
      ))}

    {filteredCatalogItems.length === 0 && <p>No matching catalog items found.</p>}
    </>
)}
  </section>
)}
    </main>
  );
}