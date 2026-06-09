import { useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import "./App.css";
import { supabase } from "./supabaseClient";

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

  function handleCoverPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setCoverPhoto(URL.createObjectURL(file));
    setCoverFile(file);
    setBookData(null);
  }

  function handleIsbnPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsbnPhoto(URL.createObjectURL(file));
    setIsbnFile(file);
    setBookData(null);
  }

async function lookupBookByIsbn(isbn) {
  try {
    const response = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`
    );

    const data = await response.json();

    if (!data.items || data.items.length === 0) {
      alert("ISBN scanned, but no book data found.");
      return;
    }

    const book = data.items[0].volumeInfo;

    setBookData({
      title: book.title || "",
      curriculum: book.publisher || "",
      subject: book.categories?.[0] || "",
      grade_level: "",
      edition: "",
      isbn,
      category: "",
      final_price: "",
      quantity: 1,
      status: "Available",
      notes: book.description || "",
      confidence: "Google Books ISBN lookup",
    });
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

  async function analyzePhoto() {
    if (!coverFile && !isbnFile) return;

    setIsAnalyzing(true);

    try {
      const formData = new FormData();

      if (coverFile) formData.append("cover", coverFile);
      if (isbnFile) formData.append("isbnImage", isbnFile);

      const response = await fetch("https://ilhrc-intake-app.onrender.com/analyze-book", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.details || data.error || "Analysis failed");
        return;
      }

      setBookData(data);
    } catch (error) {
      alert("Could not connect to the server: " + error.message);
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

  async function saveItem() {
    if (!bookData) return;

    let imageUrl = "";

    if (coverFile) {
      const fileExt = coverFile.name.split(".").pop();
      const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("book-covers")
        .upload(fileName, coverFile);

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

const itemToSave = {
  sku: newSku,
      title: bookData.title || "",
      curriculum: bookData.curriculum || "",
      subject: bookData.subject || "",
      grade_level: bookData.grade_level || bookData.grade || "",
      edition: bookData.edition || "",
      isbn: bookData.isbn || "",
      category: bookData.category || "",
      suggested_price: bookData.suggested_price || null,
      final_price: bookData.final_price ? Number(bookData.final_price) : null,
      quantity: bookData.quantity ? Number(bookData.quantity) : 1,
      status: bookData.status || "Available",
      notes: bookData.notes || "",
      image_url: imageUrl,
      ai_confidence: bookData.confidence || null,
      public_visible: true,
    };

    const { data: existingItems, error: searchError } = await supabase
      .from("items")
      .select("*")
      .eq("title", itemToSave.title)
      .eq("curriculum", itemToSave.curriculum)
      .eq("edition", itemToSave.edition)
      .eq("category", itemToSave.category)
      .eq("final_price", itemToSave.final_price)
      .limit(1);

    if (searchError) {
      alert("Could not check for existing item: " + searchError.message);
      return;
    }

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

      alert("Existing item found. Quantity updated!");
    } else {
      const { error: insertError } = await supabase
        .from("items")
        .insert([itemToSave]);

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

    const { error } = await supabase
      .from("items")
      .update({
        title: editData.title || "",
        curriculum: editData.curriculum || "",
        subject: editData.subject || "",
        grade_level: editData.grade_level || "",
        edition: editData.edition || "",
        isbn: editData.isbn || "",
        category: editData.category || "",
        final_price:
          editData.final_price === "" || editData.final_price === null
            ? null
            : Number(editData.final_price),
        quantity: editData.quantity ? Number(editData.quantity) : 1,
        status: editData.status || "Available",
        notes: editData.notes || "",
        sku: editData.sku || "",
        updated_at: new Date().toISOString(),
        public_visible: editData.public_visible !== false,
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

const filteredItems = items.filter((item) => {
  const text = `${item.title || ""} ${item.curriculum || ""} ${
    item.subject || ""
  } ${item.grade_level || ""}`.toLowerCase();

  return text.includes(searchTerm.toLowerCase());
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

const curriculumOptions = [
  ...new Set(
    items
      .map((item) => item.curriculum)
      .filter(Boolean)
      .sort()
  ),
];

const subjectOptions = [
  ...new Set(
    items
      .map((item) => item.subject)
      .filter(Boolean)
      .sort()
  ),
];

const categoryOptions = [
  ...new Set(
    items
      .map((item) => item.category)
      .filter(Boolean)
      .sort()
  ),
];

const gradeOptions = [
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
          Add Item
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

          <button className="secondary" onClick={scanIsbnBarcode}>
            {isScanningBarcode ? "Scanning..." : "Scan ISBN Barcode"}
          </button>

          <video
            id="barcode-video"
            className="barcode-video"
            hidden={!isScanningBarcode}
          />

          <button
            className="primary"
            onClick={() => coverInputRef.current.click()}
          >
            Take / Upload Cover Photo
          </button>

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCoverPhoto}
            hidden
          />

<button
  className="secondary"
  onClick={() => {
    setView("catalog");
    cancelEditing();
    setSelectedCatalogItem(null);
    loadItems();
  }}
>
  Preview Public Catalog
</button>

          <button
            className="secondary"
            onClick={() => isbnInputRef.current.click()}
          >
            Take / Upload ISBN or Barcode Photo
          </button>

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

          {(coverPhoto || isbnPhoto) && (
            <button
              className="primary"
              onClick={analyzePhoto}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? "Analyzing..." : "Analyze Book"}
            </button>
          )}

          {bookData && (
            <section className="card">
              <h2>Review & Edit Details</h2>

              <label>Title</label>
              <input
                value={bookData.title || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, title: e.target.value })
                }
              />

              <label>Curriculum</label>
              <input
                value={bookData.curriculum || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, curriculum: e.target.value })
                }
              />

              <label>Subject</label>
              <input
                value={bookData.subject || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, subject: e.target.value })
                }
              />

              <label>Grade Level</label>
              <input
                value={bookData.grade_level || bookData.grade || ""}
                onChange={(e) =>
                  setBookData({ ...bookData, grade_level: e.target.value })
                }
              />

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

              <label>Pricing Category</label>
              <select
                value={bookData.category || ""}
                onChange={(e) => {
                  const selected = pricingGuide.find(
                    (item) => item.item_name === e.target.value
                  );

                  setBookData({
                    ...bookData,
                    category: selected?.item_name || "",
                    suggested_price: selected?.price || "",
                    final_price: selected?.price || "",
                  });
                }}
              >
                <option value="">Choose a pricing category</option>
                {pricingGuide.map((item) => (
                  <option key={item.item_name} value={item.item_name}>
                    {item.item_name} — ${item.price}
                  </option>
                ))}
              </select>

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

              <button className="primary" onClick={saveItem}>
                Save Item
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
          placeholder="Search title..."
          value={pendingSearchTerm}
          onChange={(e) => setPendingSearchTerm(e.target.value)}
        />
       
          {editData && (
            <section className="card">
              <h2>Edit Item</h2>

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
              <input
                value={editData.curriculum || ""}
                onChange={(e) =>
                  setEditData({ ...editData, curriculum: e.target.value })
                }
              />

              <label>Subject</label>
              <input
                value={editData.subject || ""}
                onChange={(e) =>
                  setEditData({ ...editData, subject: e.target.value })
                }
              />

              <label>Grade Level</label>
              <input
                value={editData.grade_level || ""}
                onChange={(e) =>
                  setEditData({ ...editData, grade_level: e.target.value })
                }
              />

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

              <label>Pricing Category</label>

              <select
                value={editData.category || ""}
                onChange={(e) => {
                  const selected = pricingGuide.find(
                    (item) => item.item_name === e.target.value
                  );

                  setEditData({
                    ...editData,
                    category: selected?.item_name || "",
                    final_price: selected?.price || "",
                  });
                }}
              >
                <option value="">Choose a pricing category</option>
                {pricingGuide.map((item) => (
                  <option key={item.item_name} value={item.item_name}>
                    {item.item_name} — ${item.price}
                  </option>
                ))}
              </select>

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

          {filteredItems.length === 0 && <p>No matching items found.</p>}

          {filteredItems.map((item) => (
            <div className="inventory-item" key={item.id}>
              {item.image_url && <img src={item.image_url} alt={item.title} />}

              <div>
                <h3>{item.title}</h3>
                <p><strong>SKU:</strong> {item.sku}</p>
                <p>
                  {item.curriculum} • {item.subject} • {item.grade_level}
                </p>
                <p>
                  ${item.final_price} • Qty: {item.quantity}
                </p>
                <p>Status: {item.status}</p>
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
    {curriculumOptions.map((item) => (
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
    {subjectOptions.map((item) => (
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
    {categoryOptions.map((item) => (
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
    {gradeOptions.map((item) => (
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