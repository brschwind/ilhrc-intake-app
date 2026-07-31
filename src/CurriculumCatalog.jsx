import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import {
  findCurriculumInventoryMatch,
  findCurriculumInventoryMatches,
  getCurriculumMatchLabel,
  normalizeIsbn,
  normalizePublisherIdentifier,
} from "./curriculumMatching";
import {
  CURRICULUM_IMPORT_TEMPLATE,
  curriculumMaterialsToCsv,
  deduplicateCurriculumMaterials,
  partitionCurriculumMaterials,
  prepareCurriculumImport,
} from "./curriculumImport";

const EMPTY_PACKAGE = {
  publisher_name: "",
  name: "",
  package_type: "grade",
  grade_level: "",
  subject: "",
  edition_label: "",
  description: "",
  source_url: "",
  source_checked_on: "",
  status: "draft",
};

const EMPTY_MATERIAL = {
  title: "",
  author: "",
  publisher: "",
  publisher_item_number: "",
  publisher_barcode: "",
  isbn: "",
  acceptable_isbns: "",
  edition_label: "",
  material_type: "book",
  affiliate_url: "",
  affiliate_label: "",
  group_label: "",
  requirement_type: "required",
  compatibility_mode: "strict",
  audience: "family",
  quantity: 1,
  notes: "",
};

const PACKAGE_TYPE_LABELS = {
  grade: "Grade package",
  subject: "Subject package",
  family: "Family / multi-age",
  unit: "Unit study",
  age_band: "Age-band extension",
  student: "Student package",
  custom: "ILHRC custom list",
};

const MATERIAL_TYPE_LABELS = {
  book: "Book",
  teacher: "Teacher material",
  student: "Student text",
  answer_key: "Answer key",
  test: "Tests",
  workbook: "Consumable workbook",
  digital: "Digital product",
  supply: "Supply",
  other: "Other",
};

function packageSubtitle(curriculumPackage) {
  return [
    curriculumPackage.publisher_name,
    curriculumPackage.grade_level,
    curriculumPackage.subject,
    curriculumPackage.edition_label,
  ].filter(Boolean).join(" · ");
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function getStoredChecks() {
  try {
    return JSON.parse(window.localStorage.getItem("ilhrc-curriculum-checks") || "{}");
  } catch {
    return {};
  }
}

export default function CurriculumCatalog({ inventory, isAuthenticated, userId, authFetch, onReserveBook }) {
  const [packages, setPackages] = useState([]);
  const [selectedPackage, setSelectedPackage] = useState(null);
  const [packageItems, setPackageItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [publisherFilter, setPublisherFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [checkedByPackage, setCheckedByPackage] = useState(getStoredChecks);
  const [staffMode, setStaffMode] = useState(false);
  const [packageDraft, setPackageDraft] = useState(EMPTY_PACKAGE);
  const [bulkPackageDraft, setBulkPackageDraft] = useState(EMPTY_PACKAGE);
  const [materialDraft, setMaterialDraft] = useState(EMPTY_MATERIAL);
  const [packageEditDraft, setPackageEditDraft] = useState(EMPTY_PACKAGE);
  const [editingPackage, setEditingPackage] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState(null);
  const [materialEditDraft, setMaterialEditDraft] = useState(EMPTY_MATERIAL);
  const [saving, setSaving] = useState(false);
  const [confirmedMatches, setConfirmedMatches] = useState([]);
  const [savingMatchKey, setSavingMatchKey] = useState("");
  const [bulkPreview, setBulkPreview] = useState({ rows: [], errors: [] });
  const [bulkFileName, setBulkFileName] = useState("");
  const [bulkImporting, setBulkImporting] = useState(false);
  const [sourceMode, setSourceMode] = useState("link");
  const [sourceLink, setSourceLink] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [sourcePdf, setSourcePdf] = useState(null);
  const [sourceAnalyzing, setSourceAnalyzing] = useState(false);
  const [analysisWarnings, setAnalysisWarnings] = useState([]);

  async function loadPackages() {
    setLoading(true);
    setMessage("");
    const query = isAuthenticated
      ? supabase
          .from("curriculum_packages")
          .select("*, curriculum_publishers(id,name,website_url)")
          .order("sort_order")
          .order("name")
      : supabase
          .from("public_curriculum_packages")
          .select("*")
          .order("sort_order")
          .order("name");
    const { data, error } = await query;
    setLoading(false);
    if (error) {
      setPackages([]);
      setMessage("Curriculum lists are not available yet. A staff member may still be setting them up.");
      return;
    }
    setPackages((data || []).map((row) => ({
      ...row,
      publisher_name: row.publisher_name || row.curriculum_publishers?.name || "",
    })));
  }

  useEffect(() => {
    let active = true;
    async function loadInitialPackages() {
      const query = isAuthenticated
        ? supabase
            .from("curriculum_packages")
            .select("*, curriculum_publishers(id,name,website_url)")
            .order("sort_order")
            .order("name")
        : supabase
            .from("public_curriculum_packages")
            .select("*")
            .order("sort_order")
            .order("name");
      const { data, error } = await query;
      if (!active) return;
      setLoading(false);
      if (error) {
        setPackages([]);
        setMessage("Curriculum lists are not available yet. A staff member may still be setting them up.");
        return;
      }
      setPackages((data || []).map((row) => ({
        ...row,
        publisher_name: row.publisher_name || row.curriculum_publishers?.name || "",
      })));
    }
    loadInitialPackages();
    return () => {
      active = false;
    };
  }, [isAuthenticated]);

  async function openPackage(curriculumPackage) {
    setSelectedPackage(curriculumPackage);
    setEditingPackage(false);
    setEditingEntryId(null);
    setDetailLoading(true);
    setMessage("");
    const { data, error } = await supabase
      .from("curriculum_package_items")
      .select("*, material:curriculum_materials(*)")
      .eq("package_id", curriculumPackage.id)
      .order("sort_order");
    setDetailLoading(false);
    if (error) {
      setPackageItems([]);
      setConfirmedMatches([]);
      setMessage("We could not load this curriculum list. Please try again.");
      return;
    }
    const entries = data || [];
    setPackageItems(entries);
    const materialIds = entries.map((entry) => entry.material_id).filter(Boolean);
    if (materialIds.length === 0) {
      setConfirmedMatches([]);
      return;
    }
    const { data: confirmations, error: confirmationError } = await supabase
      .from("public_curriculum_inventory_matches")
      .select("material_id,inventory_item_id")
      .in("material_id", materialIds);
    setConfirmedMatches(confirmationError ? [] : (confirmations || []));
  }

  const visiblePackages = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return packages.filter((curriculumPackage) => {
      const haystack = [
        curriculumPackage.name,
        curriculumPackage.publisher_name,
        curriculumPackage.grade_level,
        curriculumPackage.subject,
        curriculumPackage.edition_label,
      ].join(" ").toLowerCase();
      return (!needle || haystack.includes(needle)) &&
        (!publisherFilter || curriculumPackage.publisher_name === publisherFilter) &&
        (!typeFilter || curriculumPackage.package_type === typeFilter) &&
        (!gradeFilter || curriculumPackage.grade_level === gradeFilter);
    });
  }, [packages, search, publisherFilter, typeFilter, gradeFilter]);

  const publishers = [...new Set(packages.map((item) => item.publisher_name).filter(Boolean))].sort();
  const grades = [...new Set(packages.map((item) => item.grade_level).filter(Boolean))].sort();
  const checkedIds = new Set(checkedByPackage[selectedPackage?.id] || []);
  const matchedItems = packageItems.map((entry) => {
    const confirmedItemIds = new Set(confirmedMatches
      .filter((confirmation) => confirmation.material_id === entry.material_id)
      .map((confirmation) => String(confirmation.inventory_item_id)));
    const confirmedInventoryMatches = inventory
      .filter((item) => Number(item.quantity || 0) > 0 && confirmedItemIds.has(String(item.id)))
      .map((item) => ({ status: "confirmed", item }));
    const automaticMatches = findCurriculumInventoryMatches(entry.material, inventory)
      .filter(({ item }) => !confirmedItemIds.has(String(item.id)));
    const inventoryMatches = [...confirmedInventoryMatches, ...automaticMatches];
    return {
      ...entry,
      inventoryMatches,
      match: inventoryMatches[0] || findCurriculumInventoryMatch(entry.material, inventory),
    };
  });
  const availableCount = matchedItems.filter((entry) => entry.match.status !== "missing").length;
  const requiredCount = matchedItems.filter((entry) => entry.requirement_type === "required").length;
  const groupedItems = matchedItems.reduce((groups, entry) => {
    const label = entry.group_label || "Curriculum materials";
    if (!groups[label]) groups[label] = [];
    groups[label].push(entry);
    return groups;
  }, {});

  function toggleChecked(itemId) {
    if (!selectedPackage) return;
    const current = new Set(checkedByPackage[selectedPackage.id] || []);
    if (current.has(itemId)) current.delete(itemId);
    else current.add(itemId);
    const next = { ...checkedByPackage, [selectedPackage.id]: [...current] };
    setCheckedByPackage(next);
    window.localStorage.setItem("ilhrc-curriculum-checks", JSON.stringify(next));
  }

  function clearChecks() {
    if (!selectedPackage) return;
    const next = { ...checkedByPackage, [selectedPackage.id]: [] };
    setCheckedByPackage(next);
    window.localStorage.setItem("ilhrc-curriculum-checks", JSON.stringify(next));
  }

  async function confirmInventoryMatch(material, item) {
    const matchKey = `${material.id}:${item.id}`;
    setSavingMatchKey(matchKey);
    setMessage("");
    const confirmation = {
      material_id: material.id,
      inventory_item_id: String(item.id),
      confirmed_by: userId || null,
    };
    const { data, error } = await supabase
      .from("curriculum_inventory_matches")
      .upsert(confirmation, { onConflict: "material_id,inventory_item_id" })
      .select("material_id,inventory_item_id")
      .single();
    setSavingMatchKey("");
    if (error) {
      setMessage("Could not confirm this match: " + error.message);
      return;
    }
    setConfirmedMatches((current) => [
      ...current.filter((match) => !(match.material_id === data.material_id && String(match.inventory_item_id) === String(data.inventory_item_id))),
      data,
    ]);
    setMessage(`Confirmed “${item.title}” as a match for “${material.title}.”`);
  }

  async function removeConfirmedInventoryMatch(material, item) {
    const matchKey = `${material.id}:${item.id}`;
    setSavingMatchKey(matchKey);
    setMessage("");
    const { error } = await supabase
      .from("curriculum_inventory_matches")
      .delete()
      .eq("material_id", material.id)
      .eq("inventory_item_id", String(item.id));
    setSavingMatchKey("");
    if (error) {
      setMessage("Could not remove this confirmation: " + error.message);
      return;
    }
    setConfirmedMatches((current) => current.filter((match) => !(
      match.material_id === material.id && String(match.inventory_item_id) === String(item.id)
    )));
    setMessage("Match confirmation removed.");
  }

  async function savePackage(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const publisherName = packageDraft.publisher_name.trim();
    let publisherId = null;
    if (publisherName) {
      const { data: publisher, error: publisherError } = await supabase
        .from("curriculum_publishers")
        .upsert({ name: publisherName }, { onConflict: "name" })
        .select("id")
        .single();
      if (publisherError) {
        setSaving(false);
        setMessage("Could not save the publisher: " + publisherError.message);
        return;
      }
      publisherId = publisher.id;
    }
    const { data, error } = await supabase.from("curriculum_packages").insert([{
      publisher_id: publisherId,
      name: packageDraft.name.trim(),
      package_type: packageDraft.package_type,
      grade_level: packageDraft.grade_level.trim() || null,
      subject: packageDraft.subject.trim() || null,
      edition_label: packageDraft.edition_label.trim() || null,
      description: packageDraft.description.trim() || null,
      source_url: packageDraft.source_url.trim() || null,
      source_checked_on: packageDraft.source_checked_on || null,
      status: packageDraft.status,
      created_by: userId || null,
    }]).select("*, curriculum_publishers(id,name,website_url)").single();
    setSaving(false);
    if (error) {
      setMessage("Could not save the curriculum list: " + error.message);
      return;
    }
    const saved = { ...data, publisher_name: data.curriculum_publishers?.name || "" };
    setPackageDraft(EMPTY_PACKAGE);
    await loadPackages();
    await openPackage(saved);
    setMessage("Curriculum list created. Add its books and materials below.");
  }

  function beginPackageEdit() {
    setPackageEditDraft({
      ...EMPTY_PACKAGE,
      publisher_name: selectedPackage.publisher_name || "",
      name: selectedPackage.name || "",
      package_type: selectedPackage.package_type || EMPTY_PACKAGE.package_type,
      grade_level: selectedPackage.grade_level || "",
      subject: selectedPackage.subject || "",
      edition_label: selectedPackage.edition_label || "",
      description: selectedPackage.description || "",
      source_url: selectedPackage.source_url || "",
      source_checked_on: selectedPackage.source_checked_on || "",
    });
    setEditingPackage(true);
  }

  async function savePackageEdits(event) {
    event.preventDefault();
    if (!selectedPackage) return;
    setSaving(true);
    setMessage("");
    const publisherName = cleanText(packageEditDraft.publisher_name);
    let publisherId = null;
    if (publisherName) {
      const { data: publisher, error: publisherError } = await supabase
        .from("curriculum_publishers")
        .upsert({ name: publisherName }, { onConflict: "name" })
        .select("id,name,website_url")
        .single();
      if (publisherError) {
        setSaving(false);
        setMessage("Could not save the publisher: " + publisherError.message);
        return;
      }
      publisherId = publisher.id;
    }
    const updates = {
      publisher_id: publisherId,
      name: cleanText(packageEditDraft.name),
      package_type: packageEditDraft.package_type,
      grade_level: cleanText(packageEditDraft.grade_level) || null,
      subject: cleanText(packageEditDraft.subject) || null,
      edition_label: cleanText(packageEditDraft.edition_label) || null,
      description: cleanText(packageEditDraft.description) || null,
      source_url: cleanText(packageEditDraft.source_url) || null,
      source_checked_on: packageEditDraft.source_checked_on || null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("curriculum_packages")
      .update(updates)
      .eq("id", selectedPackage.id)
      .select("*, curriculum_publishers(id,name,website_url)")
      .single();
    setSaving(false);
    if (error) {
      setMessage("Could not update the curriculum list: " + error.message);
      return;
    }
    const updated = { ...data, publisher_name: data.curriculum_publishers?.name || publisherName };
    setSelectedPackage(updated);
    setEditingPackage(false);
    await loadPackages();
    setMessage("Curriculum list information updated.");
  }

  async function saveMaterial(event) {
    event.preventDefault();
    if (!selectedPackage) return;
    setSaving(true);
    setMessage("");
    const cleanIsbn = normalizeIsbn(materialDraft.isbn);
    const cleanPublisher = materialDraft.publisher.trim();
    const cleanPublisherItemNumber = materialDraft.publisher_item_number.trim();
    let material = null;
    if (cleanIsbn) {
      const { data } = await supabase
        .from("curriculum_materials")
        .select("*")
        .eq("isbn", cleanIsbn)
        .maybeSingle();
      material = data;
    }
    if (!material && cleanPublisher && cleanPublisherItemNumber) {
      const { data } = await supabase
        .from("curriculum_materials")
        .select("*")
        .eq("publisher_item_number", cleanPublisherItemNumber);
      material = (data || []).find((candidate) =>
        normalizePublisherIdentifier(candidate.publisher) === normalizePublisherIdentifier(cleanPublisher)
      ) || null;
    }
    if (!material) {
      const { data, error } = await supabase.from("curriculum_materials").insert([{
        title: materialDraft.title.trim(),
        author: materialDraft.author.trim() || null,
        publisher: cleanPublisher || null,
        publisher_item_number: cleanPublisherItemNumber || null,
        publisher_barcode: materialDraft.publisher_barcode.trim() || null,
        isbn: cleanIsbn || null,
        acceptable_isbns: materialDraft.acceptable_isbns.split(",").map(normalizeIsbn).filter(Boolean),
        edition_label: materialDraft.edition_label.trim() || null,
        material_type: materialDraft.material_type,
        affiliate_url: materialDraft.affiliate_url.trim() || null,
        affiliate_label: materialDraft.affiliate_label.trim() || null,
      }]).select("*").single();
      if (error) {
        setSaving(false);
        setMessage("Could not save the material: " + error.message);
        return;
      }
      material = data;
    }
    const { error } = await supabase.from("curriculum_package_items").insert([{
      package_id: selectedPackage.id,
      material_id: material.id,
      group_label: materialDraft.group_label.trim() || null,
      requirement_type: materialDraft.requirement_type,
      compatibility_mode: materialDraft.compatibility_mode,
      audience: materialDraft.audience,
      quantity: Number(materialDraft.quantity) || 1,
      notes: materialDraft.notes.trim() || null,
      sort_order: packageItems.length,
    }]);
    setSaving(false);
    if (error) {
      setMessage(error.code === "23505" ? "That material is already on this list." : "Could not add the material: " + error.message);
      return;
    }
    setMaterialDraft(EMPTY_MATERIAL);
    await openPackage(selectedPackage);
    setMessage("Material added to the curriculum list.");
  }

  function beginMaterialEdit(entry) {
    const material = entry.material || {};
    setEditingEntryId(entry.id);
    setMaterialEditDraft({
      ...EMPTY_MATERIAL,
      title: material.title || "",
      author: material.author || "",
      publisher: material.publisher || "",
      publisher_item_number: material.publisher_item_number || "",
      publisher_barcode: material.publisher_barcode || "",
      isbn: material.isbn || "",
      acceptable_isbns: (material.acceptable_isbns || []).join(", "),
      edition_label: material.edition_label || "",
      material_type: material.material_type || EMPTY_MATERIAL.material_type,
      affiliate_url: material.affiliate_url || "",
      affiliate_label: material.affiliate_label || "",
      group_label: entry.group_label || "",
      requirement_type: entry.requirement_type || EMPTY_MATERIAL.requirement_type,
      compatibility_mode: entry.compatibility_mode || EMPTY_MATERIAL.compatibility_mode,
      audience: entry.audience || EMPTY_MATERIAL.audience,
      quantity: entry.quantity || 1,
      notes: entry.notes || "",
    });
  }

  async function saveMaterialEdits(event, entry) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    const materialUpdates = {
      title: cleanText(materialEditDraft.title),
      author: cleanText(materialEditDraft.author) || null,
      publisher: cleanText(materialEditDraft.publisher) || null,
      publisher_item_number: cleanText(materialEditDraft.publisher_item_number) || null,
      publisher_barcode: cleanText(materialEditDraft.publisher_barcode) || null,
      isbn: normalizeIsbn(cleanText(materialEditDraft.isbn)) || null,
      acceptable_isbns: cleanText(materialEditDraft.acceptable_isbns).split(",").map(normalizeIsbn).filter(Boolean),
      edition_label: cleanText(materialEditDraft.edition_label) || null,
      material_type: materialEditDraft.material_type,
      affiliate_url: cleanText(materialEditDraft.affiliate_url) || null,
      affiliate_label: cleanText(materialEditDraft.affiliate_label) || null,
      updated_at: new Date().toISOString(),
    };
    const { error: materialError } = await supabase
      .from("curriculum_materials")
      .update(materialUpdates)
      .eq("id", entry.material.id);
    if (materialError) {
      setSaving(false);
      setMessage("Could not update the material: " + materialError.message);
      return;
    }
    const { error: entryError } = await supabase
      .from("curriculum_package_items")
      .update({
        group_label: cleanText(materialEditDraft.group_label) || null,
        requirement_type: materialEditDraft.requirement_type,
        compatibility_mode: materialEditDraft.compatibility_mode,
        audience: materialEditDraft.audience,
        quantity: Number(materialEditDraft.quantity) || 1,
        notes: cleanText(materialEditDraft.notes) || null,
      })
      .eq("id", entry.id);
    setSaving(false);
    if (entryError) {
      setMessage("The book information was saved, but its list settings could not be updated: " + entryError.message);
      return;
    }
    setEditingEntryId(null);
    setMaterialEditDraft(EMPTY_MATERIAL);
    await openPackage(selectedPackage);
    setMessage("Curriculum material updated.");
  }

  async function updatePackageStatus(status) {
    const { error } = await supabase
      .from("curriculum_packages")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", selectedPackage.id);
    if (error) {
      setMessage("Could not update this list: " + error.message);
      return;
    }
    const updated = { ...selectedPackage, status };
    setSelectedPackage(updated);
    await loadPackages();
    setMessage(status === "published" ? "This curriculum list is now visible to customers." : "This curriculum list is now a staff-only draft.");
  }

  async function removePackageItem(entry) {
    if (!window.confirm(`Remove “${entry.material.title}” from this curriculum list?`)) return;
    const { error } = await supabase.from("curriculum_package_items").delete().eq("id", entry.id);
    if (error) setMessage("Could not remove the material: " + error.message);
    else await openPackage(selectedPackage);
  }

  function downloadImportTemplate() {
    const blob = new Blob([CURRICULUM_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "curriculum-materials-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function previewImportFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBulkFileName(file.name);
    setAnalysisWarnings([]);
    try {
      const initialPreview = prepareCurriculumImport(await file.text(), inventory);
      const partitioned = partitionCurriculumMaterials(initialPreview.rows.map((row) => row.data));
      const preview = partitioned.excluded.length
        ? prepareCurriculumImport(curriculumMaterialsToCsv(partitioned.materials), inventory)
        : initialPreview;
      setBulkPreview(preview);
      if (partitioned.excluded.length) {
        setAnalysisWarnings([`Excluded ${partitioned.excluded.length} kit, enrollment, or bundled purchase offer${partitioned.excluded.length === 1 ? "" : "s"} from the CSV. Only individual materials will be saved.`]);
      }
      setMessage(preview.errors[0] || (partitioned.excluded.length
        ? `Review ${preview.rows.length} individual materials. ${partitioned.excluded.length} package offer${partitioned.excluded.length === 1 ? " was" : "s were"} excluded.`
        : "Review the materials below before importing them."));
    } catch (error) {
      setBulkPreview({ rows: [], errors: [error.message] });
      setMessage("Could not read this CSV: " + error.message);
    }
    event.target.value = "";
  }

  function chooseSourceMode(mode) {
    setSourceMode(mode);
    setBulkPreview({ rows: [], errors: [] });
    setBulkFileName("");
    setBulkPackageDraft(EMPTY_PACKAGE);
    setAnalysisWarnings([]);
    setMessage("");
  }

  async function analyzeCurriculumSource() {
    if (sourceMode === "link" && !sourceLink.trim()) {
      setMessage("Paste a publisher link first.");
      return;
    }
    if (sourceMode === "text" && sourceText.trim().length < 30) {
      setMessage("Paste more of the curriculum list before analyzing it.");
      return;
    }
    if (sourceMode === "pdf" && !sourcePdf) {
      setMessage("Choose a PDF first.");
      return;
    }
    if (sourcePdf && sourcePdf.size > 8 * 1024 * 1024) {
      setMessage("Choose a PDF smaller than 8 MB.");
      return;
    }

    setSourceAnalyzing(true);
    setMessage("Analyzing the curriculum source…");
    try {
      const formData = new FormData();
      formData.append("source_type", sourceMode);
      if (sourceMode === "link") formData.append("url", sourceLink.trim());
      if (sourceMode === "text") formData.append("text", sourceText.trim());
      if (sourceMode === "pdf") formData.append("file", sourcePdf);
      const response = await authFetch("/analyze-curriculum", { method: "POST", body: formData });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not analyze that curriculum source.");

      const partitioned = partitionCurriculumMaterials(result.materials);
      const uniqueMaterials = deduplicateCurriculumMaterials(partitioned.materials);
      const duplicateCount = Math.max(0, partitioned.materials.length - uniqueMaterials.length);
      const excludedOffers = [...(result.excluded_offers || []), ...partitioned.excluded]
        .filter((offer, index, offers) => {
          const key = String(offer.publisher_item_number || "").trim() || String(offer.title || "").trim().toLowerCase();
          return key && offers.findIndex((candidate) =>
            (String(candidate.publisher_item_number || "").trim() || String(candidate.title || "").trim().toLowerCase()) === key
          ) === index;
        });
      const preview = prepareCurriculumImport(curriculumMaterialsToCsv(uniqueMaterials), inventory);
      preview.rows = preview.rows.map((row, index) => {
        const analyzed = uniqueMaterials[index] || {};
        const aiWarnings = [];
        if (analyzed.review_reason) aiWarnings.push(analyzed.review_reason);
        if (Number(analyzed.confidence) < 0.75) aiWarnings.push("AI confidence is low; verify this row.");
        return { ...row, aiWarnings };
      });
      setBulkPackageDraft({ ...EMPTY_PACKAGE, ...result.package, status: "draft" });
      setBulkPreview(preview);
      setBulkFileName(sourceMode === "pdf" ? sourcePdf.name : sourceMode === "link" ? sourceLink.trim() : "Pasted text");
      setAnalysisWarnings([
        ...(result.warnings || []),
        ...(excludedOffers.length ? [
          `Excluded ${excludedOffers.length} kit, enrollment, or bundled purchase offer${excludedOffers.length === 1 ? "" : "s"}. Only individual materials will be saved.${excludedOffers.slice(0, 5).map((offer) => ` ${offer.publisher_item_number ? `${offer.publisher_item_number} ` : ""}${offer.title}`).join(";")}${excludedOffers.length > 5 ? "; …" : ""}`,
        ] : []),
        ...(duplicateCount ? [`Consolidated ${duplicateCount} repeated material${duplicateCount === 1 ? "" : "s"} from the publisher list.`] : []),
      ]);
      setMessage(`Found ${preview.rows.length} individual materials${excludedOffers.length ? ` and excluded ${excludedOffers.length} package offer${excludedOffers.length === 1 ? "" : "s"}` : ""}. Review the package details and flagged rows before creating the draft.`);
    } catch (error) {
      setMessage(error.message || "Could not analyze that curriculum source.");
    } finally {
      setSourceAnalyzing(false);
    }
  }

  function updateBulkPreviewRow(rowNumber, field, value) {
    setBulkPreview((current) => {
      const materials = current.rows.map((row) => row.rowNumber === rowNumber
        ? { ...row.data, [field]: value }
        : row.data);
      const next = prepareCurriculumImport(curriculumMaterialsToCsv(materials), inventory);
      next.rows = next.rows.map((row, index) => ({
        ...row,
        aiWarnings: current.rows[index]?.aiWarnings || [],
      }));
      return next;
    });
  }

  function removeBulkPreviewRow(rowNumber) {
    setBulkPreview((current) => {
      const keptRows = current.rows.filter((row) => row.rowNumber !== rowNumber);
      const next = prepareCurriculumImport(curriculumMaterialsToCsv(keptRows.map((row) => row.data)), inventory);
      next.rows = next.rows.map((row, index) => ({
        ...row,
        aiWarnings: keptRows[index]?.aiWarnings || [],
      }));
      return next;
    });
  }

  function removeBulkDuplicateRows() {
    setBulkPreview((current) => {
      const keptMaterials = deduplicateCurriculumMaterials(current.rows.map((row) => row.data));
      const keptRows = keptMaterials.map((material) =>
        current.rows.find((row) => row.data === material)
      );
      const next = prepareCurriculumImport(curriculumMaterialsToCsv(keptMaterials), inventory);
      next.rows = next.rows.map((row, index) => ({
        ...row,
        aiWarnings: keptRows[index]?.aiWarnings || [],
      }));
      return next;
    });
  }

  async function importPreviewedMaterials() {
    if (bulkPreview.rows.length === 0) return;
    if (bulkPreview.errors.length || bulkPreview.rows.some((row) => row.errors.length > 0)) {
      setMessage("Fix the highlighted CSV rows before importing.");
      return;
    }
    if (!bulkPackageDraft.publisher_name.trim() || !bulkPackageDraft.name.trim()) {
      setMessage("Enter the publisher and curriculum list name before importing.");
      return;
    }

    setBulkImporting(true);
    setMessage("");

    const { data: publisher, error: publisherError } = await supabase
      .from("curriculum_publishers")
      .upsert({ name: bulkPackageDraft.publisher_name.trim() }, { onConflict: "name" })
      .select("id,name,website_url")
      .single();
    if (publisherError) {
      setBulkImporting(false);
      setMessage("Could not save the publisher: " + publisherError.message);
      return;
    }

    let existingPackageQuery = supabase
      .from("curriculum_packages")
      .select("id")
      .eq("publisher_id", publisher.id)
      .eq("name", bulkPackageDraft.name.trim());
    existingPackageQuery = bulkPackageDraft.edition_label.trim()
      ? existingPackageQuery.eq("edition_label", bulkPackageDraft.edition_label.trim())
      : existingPackageQuery.is("edition_label", null);
    const { data: existingPackage } = await existingPackageQuery.limit(1).maybeSingle();
    if (existingPackage) {
      setBulkImporting(false);
      setMessage("That publisher, list name, and edition already exist. Open the existing package instead.");
      return;
    }

    const { data: createdPackage, error: packageError } = await supabase
      .from("curriculum_packages")
      .insert([{
        publisher_id: publisher.id,
        name: bulkPackageDraft.name.trim(),
        package_type: bulkPackageDraft.package_type,
        grade_level: bulkPackageDraft.grade_level.trim() || null,
        subject: bulkPackageDraft.subject.trim() || null,
        edition_label: bulkPackageDraft.edition_label.trim() || null,
        description: bulkPackageDraft.description.trim() || null,
        source_url: bulkPackageDraft.source_url.trim() || null,
        source_checked_on: bulkPackageDraft.source_checked_on || null,
        status: "draft",
        created_by: userId || null,
      }])
      .select("*")
      .single();
    if (packageError) {
      setBulkImporting(false);
      setMessage("Could not create the curriculum list: " + packageError.message);
      return;
    }

    const savedPackage = {
      ...createdPackage,
      publisher_name: publisher.name,
      curriculum_publishers: publisher,
    };
    let imported = 0;

    for (const row of bulkPreview.rows) {
      const item = row.data;
      const materialPublisher = item.publisher || bulkPackageDraft.publisher_name;
      let material;
      if (item.isbn) {
        const { data } = await supabase
          .from("curriculum_materials")
          .select("*")
          .eq("isbn", item.isbn)
          .limit(1)
          .maybeSingle();
        material = data;
      } else if (materialPublisher && item.publisher_item_number) {
        const { data } = await supabase
          .from("curriculum_materials")
          .select("*")
          .eq("publisher_item_number", item.publisher_item_number);
        material = (data || []).find((candidate) =>
          normalizePublisherIdentifier(candidate.publisher) === normalizePublisherIdentifier(materialPublisher)
        ) || null;
      } else {
        const { data } = await supabase
          .from("curriculum_materials")
          .select("*")
          .eq("title", item.title)
          .limit(1)
          .maybeSingle();
        material = data;
      }

      if (!material) {
        const { data, error } = await supabase.from("curriculum_materials").insert([{
          title: item.title,
          author: item.author || null,
          publisher: materialPublisher || null,
          publisher_item_number: item.publisher_item_number || null,
          publisher_barcode: item.publisher_barcode || null,
          isbn: item.isbn || null,
          acceptable_isbns: item.acceptable_isbns,
          edition_label: item.edition_label || null,
          material_type: item.material_type,
          affiliate_url: item.affiliate_url || null,
          affiliate_label: item.affiliate_label || null,
        }]).select("*").single();
        if (error) {
          setBulkImporting(false);
          await loadPackages();
          await openPackage(savedPackage);
          setMessage(`The draft was created with ${imported} materials, then stopped at CSV row ${row.rowNumber}: ${error.message}`);
          return;
        }
        material = data;
      }

      const { error } = await supabase.from("curriculum_package_items").insert([{
        package_id: savedPackage.id,
        material_id: material.id,
        group_label: item.group_label || null,
        requirement_type: item.requirement_type,
        compatibility_mode: item.compatibility_mode,
        audience: item.audience,
        quantity: item.quantity,
        notes: item.notes || null,
        sort_order: row.rowNumber - 2,
      }]);
      if (error) {
        setBulkImporting(false);
        await loadPackages();
        await openPackage(savedPackage);
        setMessage(`The draft was created with ${imported} materials, then stopped at CSV row ${row.rowNumber}: ${error.message}`);
        return;
      }
      imported += 1;
    }

    setBulkImporting(false);
    setBulkPreview({ rows: [], errors: [] });
    setBulkFileName("");
    setBulkPackageDraft(EMPTY_PACKAGE);
    setSourceLink("");
    setSourceText("");
    setSourcePdf(null);
    setAnalysisWarnings([]);
    await loadPackages();
    await openPackage(savedPackage);
    setMessage(`New draft created with ${imported} materials.`);
  }

  if (selectedPackage) {
    return (
      <section className="card curriculum-shell curriculum-detail-shell">
        <div className="curriculum-toolbar no-print">
          <button className="secondary" type="button" onClick={() => { setSelectedPackage(null); setPackageItems([]); setMessage(""); }}>
            ← All curriculum lists
          </button>
          <div>
            {isAuthenticated && (
              <button className="secondary" type="button" onClick={() => setStaffMode((current) => !current)}>
                {staffMode ? "Close curriculum tools" : "Curriculum List Tools"}
              </button>
            )}
            <button className="secondary" type="button" onClick={clearChecks}>Clear checks</button>
            <button className="primary" type="button" onClick={() => window.print()}>Print checklist</button>
          </div>
        </div>

        <header className="curriculum-detail-heading">
          <span className="curriculum-type">{PACKAGE_TYPE_LABELS[selectedPackage.package_type]}</span>
          <h2>{selectedPackage.name}</h2>
          <p>{packageSubtitle(selectedPackage)}</p>
          {selectedPackage.description && <p>{selectedPackage.description}</p>}
          {selectedPackage.source_url && (
            <p className="curriculum-source no-print">
              Source: <a href={selectedPackage.source_url} target="_blank" rel="noreferrer">publisher information</a>
              {selectedPackage.source_checked_on && ` · Checked ${selectedPackage.source_checked_on}`}
            </p>
          )}
        </header>

        {!detailLoading && (
          <div className="curriculum-summary">
            <div><strong>{packageItems.length}</strong><span>listed materials</span></div>
            <div><strong>{requiredCount}</strong><span>required</span></div>
            <div><strong>{availableCount}</strong><span>found in store</span></div>
            <div><strong>{checkedIds.size}</strong><span>checked off</span></div>
          </div>
        )}

        {message && <p className="status-message no-print">{message}</p>}
        {detailLoading && <p>Loading curriculum materials…</p>}
        {!detailLoading && packageItems.length === 0 && <p>No materials have been added to this list yet.</p>}

        {Object.entries(groupedItems).map(([group, entries]) => (
          <section className="curriculum-group" key={group}>
            <h3>{group}</h3>
            {entries.map((entry) => {
              const { material, match, inventoryMatches } = entry;
              const isChecked = checkedIds.has(entry.id);
              return (
                <article className={`curriculum-row ${isChecked ? "is-checked" : ""}`} key={entry.id}>
                  <label className="curriculum-check">
                    <input type="checkbox" checked={isChecked} onChange={() => toggleChecked(entry.id)} />
                    <span className="sr-only">Check off {material.title}</span>
                  </label>
                  <div className="curriculum-book-info">
                    <div className="curriculum-book-heading">
                      <h4>{material.title}</h4>
                    </div>
                    <p>{[
                      material.author,
                      material.edition_label,
                      material.isbn && `ISBN ${material.isbn}`,
                      material.publisher_item_number && `${material.publisher || "Publisher"} item ${material.publisher_item_number}`,
                    ].filter(Boolean).join(" · ")}</p>
                    <p className="curriculum-meta">
                      {entry.requirement_type !== "required" && `${entry.requirement_type} · `}
                      {MATERIAL_TYPE_LABELS[material.material_type]}
                      {entry.quantity > 1 && ` · Qty ${entry.quantity}`}
                      {entry.audience !== "family" && ` · Per ${entry.audience.replace("_", " ")}`}
                    </p>
                    {entry.notes && <p className="curriculum-note">{entry.notes}</p>}
                    {inventoryMatches.length > 0 && (
                      <div className="curriculum-store-copies">
                        <strong>{inventoryMatches.length} in-store {inventoryMatches.length === 1 ? "listing" : "listings"}</strong>
                        <div className="curriculum-store-copy-grid">
                          {inventoryMatches.map(({ item, status }) => {
                            const matchKey = `${material.id}:${item.id}`;
                            const matchSaving = savingMatchKey === matchKey;
                            return (
                            <article className="curriculum-store-copy-card" key={item.id || item.sku || `${item.title}-${item.final_price}`}>
                              {item.image_url && <img src={item.image_url} alt="" />}
                              <div>
                                <strong>{item.title}</strong>
                                <span>{[item.edition, item.sku && `SKU ${item.sku}`].filter(Boolean).join(" · ")}</span>
                                <span>${Number(item.final_price || 0).toFixed(2)} · {item.quantity} available</span>
                                {isAuthenticated && staffMode && status === "possible" && (
                                  <button className="secondary curriculum-confirm-button no-print" type="button" disabled={matchSaving} onClick={() => confirmInventoryMatch(material, item)}>
                                    {matchSaving ? "Confirming…" : "Confirm match"}
                                  </button>
                                )}
                                {isAuthenticated && staffMode && status === "confirmed" && (
                                  <button className="secondary curriculum-confirm-button no-print" type="button" disabled={matchSaving} onClick={() => removeConfirmedInventoryMatch(material, item)}>
                                    {matchSaving ? "Removing…" : "Undo confirmation"}
                                  </button>
                                )}
                                {!isAuthenticated && onReserveBook && (
                                  <button className="primary curriculum-reserve-button no-print" type="button" onClick={() => onReserveBook(item)}>
                                    Reserve this copy
                                  </button>
                                )}
                              </div>
                            </article>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {match.status === "missing" && material.affiliate_url && (
                      <a className="affiliate-link no-print" href={material.affiliate_url} target="_blank" rel="sponsored noreferrer">
                        Find at {material.affiliate_label || "partner retailer"} ↗
                      </a>
                    )}
                    {isAuthenticated && staffMode && editingEntryId === entry.id && (
                      <form className="curriculum-editor curriculum-inline-editor no-print" onSubmit={(event) => saveMaterialEdits(event, entry)}>
                        <h4>Edit this list item</h4>
                        <p className="curriculum-edit-note">Book identity fields update this material anywhere it is used. Section, requirement, quantity, audience, and notes apply only to this list.</p>
                        <div className="curriculum-form-grid">
                          <label>Title<input required value={materialEditDraft.title} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, title: e.target.value })} /></label>
                          <label>Author<input value={materialEditDraft.author} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, author: e.target.value })} /></label>
                          <label>Publisher<input value={materialEditDraft.publisher} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, publisher: e.target.value })} /></label>
                          <label>Publisher item number<input value={materialEditDraft.publisher_item_number} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, publisher_item_number: e.target.value })} /></label>
                          <label>Publisher barcode<input value={materialEditDraft.publisher_barcode} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, publisher_barcode: e.target.value })} /></label>
                          <label>ISBN<input value={materialEditDraft.isbn} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, isbn: e.target.value })} /></label>
                          <label>Approved alternate ISBNs<input placeholder="Separate with commas" value={materialEditDraft.acceptable_isbns} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, acceptable_isbns: e.target.value })} /></label>
                          <label>Edition<input value={materialEditDraft.edition_label} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, edition_label: e.target.value })} /></label>
                          <label>Section / subject<input value={materialEditDraft.group_label} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, group_label: e.target.value })} /></label>
                          <label>Material type<select value={materialEditDraft.material_type} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, material_type: e.target.value })}>{Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                          <label>Requirement<select value={materialEditDraft.requirement_type} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, requirement_type: e.target.value })}><option value="required">Required</option><option value="optional">Optional</option><option value="choice">Choose one</option></select></label>
                          <label>Used-edition matching<select value={materialEditDraft.compatibility_mode} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, compatibility_mode: e.target.value })}><option value="strict">Strict edition</option><option value="flexible">Flexible</option></select></label>
                          <label>Who needs it?<select value={materialEditDraft.audience} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, audience: e.target.value })}><option value="family">One per family</option><option value="student">One per student</option><option value="teacher">Teacher / parent</option><option value="age_band">Per age band</option></select></label>
                          <label>Quantity<input type="number" min="1" value={materialEditDraft.quantity} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, quantity: e.target.value })} /></label>
                          <label>Affiliate URL<input type="url" value={materialEditDraft.affiliate_url} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, affiliate_url: e.target.value })} /></label>
                          <label>Affiliate retailer<input value={materialEditDraft.affiliate_label} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, affiliate_label: e.target.value })} /></label>
                        </div>
                        <label>Notes<textarea value={materialEditDraft.notes} onChange={(e) => setMaterialEditDraft({ ...materialEditDraft, notes: e.target.value })} /></label>
                        <div className="curriculum-edit-actions">
                          <button className="primary" disabled={saving}>{saving ? "Saving…" : "Save item changes"}</button>
                          <button className="secondary" type="button" onClick={() => setEditingEntryId(null)}>Cancel</button>
                        </div>
                      </form>
                    )}
                  </div>
                  <div className="curriculum-row-actions">
                    <span className={`match-badge match-${match.status}`}>{getCurriculumMatchLabel(match.status)}</span>
                    {isAuthenticated && staffMode && (
                      <div className="curriculum-item-buttons no-print">
                        <button className="secondary" type="button" onClick={() => beginMaterialEdit(entry)}>Edit</button>
                        <button className="text-danger" type="button" onClick={() => removePackageItem(entry)}>Remove</button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ))}

        <p className="affiliate-disclosure">External links may be affiliate links. ILHRC may earn a commission from qualifying purchases.</p>

        {isAuthenticated && staffMode && (
          <section className="curriculum-staff-panel no-print">
            <div className="curriculum-staff-heading">
              <div><span className="eyebrow">Staff tools</span><h3>Manage this curriculum list</h3></div>
              <button className="secondary" type="button" onClick={() => setStaffMode((current) => !current)}>{staffMode ? "Close tools" : "Open tools"}</button>
            </div>
            {staffMode && (
              <>
                <div className="curriculum-publish-row">
                  <span>Status: <strong>{selectedPackage.status}</strong></span>
                  <div className="curriculum-edit-actions">
                    <button className="secondary" type="button" onClick={beginPackageEdit}>Edit list information</button>
                    {selectedPackage.status === "published" ?
                      <button className="secondary" type="button" onClick={() => updatePackageStatus("draft")}>Return to draft</button> :
                      <button className="primary" type="button" onClick={() => updatePackageStatus("published")}>Publish list</button>}
                  </div>
                </div>
                {editingPackage && (
                  <form className="curriculum-editor curriculum-package-editor" onSubmit={savePackageEdits}>
                    <h3>Edit list information</h3>
                    <div className="curriculum-form-grid">
                      <label>Publisher<input required value={packageEditDraft.publisher_name} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, publisher_name: e.target.value })} /></label>
                      <label>List name<input required value={packageEditDraft.name} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, name: e.target.value })} /></label>
                      <label>List type<select value={packageEditDraft.package_type} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, package_type: e.target.value })}>{Object.entries(PACKAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label>Grade / level<input value={packageEditDraft.grade_level} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, grade_level: e.target.value })} /></label>
                      <label>Subject<input value={packageEditDraft.subject} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, subject: e.target.value })} /></label>
                      <label>Edition / school year<input value={packageEditDraft.edition_label} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, edition_label: e.target.value })} /></label>
                      <label>Publisher source URL<input type="url" value={packageEditDraft.source_url} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, source_url: e.target.value })} /></label>
                      <label>Source checked on<input type="date" value={packageEditDraft.source_checked_on} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, source_checked_on: e.target.value })} /></label>
                    </div>
                    <label>Description<textarea value={packageEditDraft.description} onChange={(e) => setPackageEditDraft({ ...packageEditDraft, description: e.target.value })} /></label>
                    <div className="curriculum-edit-actions">
                      <button className="primary" disabled={saving}>{saving ? "Saving…" : "Save list changes"}</button>
                      <button className="secondary" type="button" onClick={() => setEditingPackage(false)}>Cancel</button>
                    </div>
                  </form>
                )}
                <form className="curriculum-editor" onSubmit={saveMaterial}>
                  <h3>Add a book or material</h3>
                  <div className="curriculum-form-grid">
                    <label>Title<input required value={materialDraft.title} onChange={(e) => setMaterialDraft({ ...materialDraft, title: e.target.value })} /></label>
                    <label>Author<input value={materialDraft.author} onChange={(e) => setMaterialDraft({ ...materialDraft, author: e.target.value })} /></label>
                    <label>Publisher<input value={materialDraft.publisher} onChange={(e) => setMaterialDraft({ ...materialDraft, publisher: e.target.value })} /></label>
                    <label>Publisher item number<input value={materialDraft.publisher_item_number} onChange={(e) => setMaterialDraft({ ...materialDraft, publisher_item_number: e.target.value })} /></label>
                    <label>Publisher barcode<input value={materialDraft.publisher_barcode} onChange={(e) => setMaterialDraft({ ...materialDraft, publisher_barcode: e.target.value })} /></label>
                    <label>ISBN<input value={materialDraft.isbn} onChange={(e) => setMaterialDraft({ ...materialDraft, isbn: e.target.value })} /></label>
                    <label>Approved alternate ISBNs<input placeholder="Separate with commas" value={materialDraft.acceptable_isbns} onChange={(e) => setMaterialDraft({ ...materialDraft, acceptable_isbns: e.target.value })} /></label>
                    <label>Edition<input value={materialDraft.edition_label} onChange={(e) => setMaterialDraft({ ...materialDraft, edition_label: e.target.value })} /></label>
                    <label>Section / subject<input placeholder="Language Arts, Family Core…" value={materialDraft.group_label} onChange={(e) => setMaterialDraft({ ...materialDraft, group_label: e.target.value })} /></label>
                    <label>Material type<select value={materialDraft.material_type} onChange={(e) => setMaterialDraft({ ...materialDraft, material_type: e.target.value })}>{Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Requirement<select value={materialDraft.requirement_type} onChange={(e) => setMaterialDraft({ ...materialDraft, requirement_type: e.target.value })}><option value="required">Required</option><option value="optional">Optional</option><option value="choice">Choose one</option></select></label>
                    <label>Used-edition matching<select value={materialDraft.compatibility_mode} onChange={(e) => setMaterialDraft({ ...materialDraft, compatibility_mode: e.target.value })}><option value="strict">Strict edition</option><option value="flexible">Flexible</option></select></label>
                    <label>Who needs it?<select value={materialDraft.audience} onChange={(e) => setMaterialDraft({ ...materialDraft, audience: e.target.value })}><option value="family">One per family</option><option value="student">One per student</option><option value="teacher">Teacher / parent</option><option value="age_band">Per age band</option></select></label>
                    <label>Quantity<input type="number" min="1" value={materialDraft.quantity} onChange={(e) => setMaterialDraft({ ...materialDraft, quantity: e.target.value })} /></label>
                    <label>Affiliate URL<input type="url" value={materialDraft.affiliate_url} onChange={(e) => setMaterialDraft({ ...materialDraft, affiliate_url: e.target.value })} /></label>
                    <label>Affiliate retailer<input placeholder="Bookshop.org, publisher…" value={materialDraft.affiliate_label} onChange={(e) => setMaterialDraft({ ...materialDraft, affiliate_label: e.target.value })} /></label>
                  </div>
                  <label>Notes<textarea value={materialDraft.notes} onChange={(e) => setMaterialDraft({ ...materialDraft, notes: e.target.value })} /></label>
                  <button className="primary" disabled={saving}>{saving ? "Adding…" : "Add to list"}</button>
                </form>
              </>
            )}
          </section>
        )}
      </section>
    );
  }

  return (
    <section className="card curriculum-shell">
      <div className="curriculum-hero">
        <span className="eyebrow">Curriculum library</span>
        <h2>Find the books for your studies</h2>
        <p>Choose a curriculum list to see every required book, what ILHRC currently has in store, and options for anything still missing.</p>
      </div>

      <div className="curriculum-browser">
        <div className="curriculum-filters">
          <label>Search<input type="search" placeholder="Publisher, program, subject…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Publisher<select value={publisherFilter} onChange={(e) => setPublisherFilter(e.target.value)}><option value="">All publishers</option>{publishers.map((publisher) => <option key={publisher}>{publisher}</option>)}</select></label>
          <label>Package type<select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}><option value="">All types</option>{Object.entries(PACKAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Grade / level<select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}><option value="">All levels</option>{grades.map((grade) => <option key={grade}>{grade}</option>)}</select></label>
        </div>

        {message && <p className="status-message">{message}</p>}
        {loading && <p>Loading curriculum lists…</p>}
        {!loading && visiblePackages.length === 0 && <div className="curriculum-empty"><h3>No curriculum lists found</h3><p>{isAuthenticated ? "Create the first list with the staff tools below." : "Please check back as our curriculum library grows."}</p></div>}
        <div className="curriculum-card-grid">
          {visiblePackages.map((curriculumPackage) => (
            <article className="curriculum-card" key={curriculumPackage.id}>
              <div>
                <span className="curriculum-type">{PACKAGE_TYPE_LABELS[curriculumPackage.package_type]}</span>
                {isAuthenticated && curriculumPackage.status !== "published" && <span className="draft-badge">{curriculumPackage.status}</span>}
                <h3>{curriculumPackage.name}</h3>
                <p>{packageSubtitle(curriculumPackage)}</p>
                {curriculumPackage.description && <p>{curriculumPackage.description}</p>}
              </div>
              <button className="primary" type="button" onClick={() => openPackage(curriculumPackage)}>View checklist</button>
            </article>
          ))}
        </div>
      </div>

      {isAuthenticated && (
        <section className="curriculum-staff-panel">
          <div className="curriculum-staff-heading">
            <div><span className="eyebrow">Staff tools</span><h3>Create a curriculum list</h3></div>
            <button className="secondary" type="button" onClick={() => setStaffMode((current) => !current)}>{staffMode ? "Close tools" : "Open tools"}</button>
          </div>
          {staffMode && (
            <div className="curriculum-staff-tools-body">
            <form className="curriculum-editor curriculum-manual-create" onSubmit={savePackage}>
              <h3>Create a blank package manually</h3>
              <div className="curriculum-form-grid">
                <label>Publisher<input required value={packageDraft.publisher_name} onChange={(e) => setPackageDraft({ ...packageDraft, publisher_name: e.target.value })} /></label>
                <label>List name<input required placeholder="Grade 4 Complete Package" value={packageDraft.name} onChange={(e) => setPackageDraft({ ...packageDraft, name: e.target.value })} /></label>
                <label>Package type<select value={packageDraft.package_type} onChange={(e) => setPackageDraft({ ...packageDraft, package_type: e.target.value })}>{Object.entries(PACKAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Grade / level<input value={packageDraft.grade_level} onChange={(e) => setPackageDraft({ ...packageDraft, grade_level: e.target.value })} /></label>
                <label>Subject<input value={packageDraft.subject} onChange={(e) => setPackageDraft({ ...packageDraft, subject: e.target.value })} /></label>
                <label>Edition / year<input value={packageDraft.edition_label} onChange={(e) => setPackageDraft({ ...packageDraft, edition_label: e.target.value })} /></label>
                <label>Publisher source URL<input type="url" value={packageDraft.source_url} onChange={(e) => setPackageDraft({ ...packageDraft, source_url: e.target.value })} /></label>
                <label>Source checked on<input type="date" value={packageDraft.source_checked_on} onChange={(e) => setPackageDraft({ ...packageDraft, source_checked_on: e.target.value })} /></label>
                <label>Initial status<select value={packageDraft.status} onChange={(e) => setPackageDraft({ ...packageDraft, status: e.target.value })}><option value="draft">Draft</option><option value="published">Published</option></select></label>
              </div>
              <label>Description<textarea value={packageDraft.description} onChange={(e) => setPackageDraft({ ...packageDraft, description: e.target.value })} /></label>
              <button className="primary" disabled={saving}>{saving ? "Creating…" : "Create curriculum list"}</button>
            </form>
            <section className="curriculum-importer">
              <div className="curriculum-import-heading">
                <div>
                  <span className="eyebrow">Assisted import</span>
                  <h3>Create a package from a source</h3>
                </div>
              </div>
              <p>Start with whatever the publisher gives you. AI reads complete grade catalogs, including continued materials pages, and organizes links, pasted lists, and PDFs; CSV remains available when you already have structured data.</p>
              <div className="curriculum-source-options" role="group" aria-label="Curriculum source type">
                {[['link', 'Publisher link'], ['text', 'Pasted text'], ['pdf', 'PDF'], ['csv', 'CSV']].map(([value, label]) => (
                  <button className={sourceMode === value ? "source-option active" : "source-option"} type="button" onClick={() => chooseSourceMode(value)} key={value}>{label}</button>
                ))}
              </div>

              <div className="curriculum-source-panel">
                {sourceMode === "link" && <label>Publisher package link<input type="url" placeholder="https://publisher.com/package" value={sourceLink} onChange={(e) => setSourceLink(e.target.value)} /></label>}
                {sourceMode === "text" && <label>Paste the publisher’s package list<textarea placeholder="Paste the package description and included materials here…" value={sourceText} onChange={(e) => setSourceText(e.target.value)} /></label>}
                {sourceMode === "pdf" && <label>Publisher PDF<input type="file" accept="application/pdf,.pdf" onChange={(e) => setSourcePdf(e.target.files?.[0] || null)} /></label>}
                {sourceMode === "csv" && (
                  <div className="curriculum-csv-source">
                    <label>Curriculum materials CSV<input type="file" accept=".csv,text/csv" onChange={previewImportFile} /></label>
                    <button className="secondary" type="button" onClick={downloadImportTemplate}>Download CSV template</button>
                  </div>
                )}
                {sourceMode !== "csv" && <button className="primary" type="button" disabled={sourceAnalyzing} onClick={analyzeCurriculumSource}>{sourceAnalyzing ? "Analyzing…" : "Analyze source"}</button>}
              </div>

              {bulkFileName && <p><strong>Previewing:</strong> {bulkFileName}</p>}
              {analysisWarnings.map((warning) => <p className="import-warning" key={warning}>{warning}</p>)}
              {bulkPreview.errors.map((error) => <p className="import-error" key={error}>{error}</p>)}
              {bulkPreview.rows.length > 0 && (
                <>
                  <h4 className="curriculum-review-heading">Review the new package</h4>
                  <div className="curriculum-form-grid">
                    <label>Publisher<input required value={bulkPackageDraft.publisher_name} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, publisher_name: e.target.value })} /></label>
                    <label>List name<input required value={bulkPackageDraft.name} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, name: e.target.value })} /></label>
                    <label>Package type<select value={bulkPackageDraft.package_type} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, package_type: e.target.value })}>{Object.entries(PACKAGE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label>Grade / level<input value={bulkPackageDraft.grade_level} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, grade_level: e.target.value })} /></label>
                    <label>Subject<input value={bulkPackageDraft.subject} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, subject: e.target.value })} /></label>
                    <label>Edition / year<input value={bulkPackageDraft.edition_label} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, edition_label: e.target.value })} /></label>
                    <label>Publisher source URL<input type="url" value={bulkPackageDraft.source_url} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, source_url: e.target.value })} /></label>
                    <label>Source checked on<input type="date" value={bulkPackageDraft.source_checked_on} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, source_checked_on: e.target.value })} /></label>
                  </div>
                  <label className="curriculum-import-description">Description<textarea value={bulkPackageDraft.description} onChange={(e) => setBulkPackageDraft({ ...bulkPackageDraft, description: e.target.value })} /></label>
                  <div className="curriculum-import-summary">
                    <span><strong>{bulkPreview.rows.length}</strong> materials</span>
                    <span><strong>{bulkPreview.rows.filter((row) => row.data.publisher_item_number).length}</strong> publisher numbers</span>
                    <span><strong>{bulkPreview.rows.filter((row) => row.match.status !== "missing").length}</strong> store matches</span>
                    <span><strong>{bulkPreview.rows.filter((row) => row.errors.length > 0).length}</strong> rows to fix</span>
                    {bulkPreview.rows.some((row) => row.errors.some((error) => error.startsWith("Duplicates row"))) && <button className="secondary" type="button" onClick={removeBulkDuplicateRows}>Remove duplicate rows</button>}
                  </div>
                  <div className="curriculum-import-table-wrap">
                    <table className="curriculum-import-table">
                      <thead><tr><th>Material</th><th>Section</th><th>Type</th><th>Requirement</th><th>Store match</th><th>Review</th><th></th></tr></thead>
                      <tbody>
                        {bulkPreview.rows.map((row) => (
                          <tr className={row.errors.length ? "has-error" : ""} key={row.rowNumber}>
                            <td><input aria-label={`Title row ${row.rowNumber}`} value={row.data.title} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "title", e.target.value)} /><input aria-label={`ISBN row ${row.rowNumber}`} placeholder="ISBN" value={row.data.isbn} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "isbn", e.target.value)} /><input aria-label={`Publisher item number row ${row.rowNumber}`} placeholder="Publisher item #" value={row.data.publisher_item_number} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "publisher_item_number", e.target.value)} /></td>
                            <td><input aria-label={`Section row ${row.rowNumber}`} value={row.data.group_label} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "group_label", e.target.value)} /></td>
                            <td><select aria-label={`Material type row ${row.rowNumber}`} value={row.data.material_type} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "material_type", e.target.value)}>{Object.entries(MATERIAL_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                            <td><select aria-label={`Requirement row ${row.rowNumber}`} value={row.data.requirement_type} onChange={(e) => updateBulkPreviewRow(row.rowNumber, "requirement_type", e.target.value)}><option value="required">Required</option><option value="optional">Optional</option><option value="choice">Choose one</option></select></td>
                            <td><span className={`match-badge match-${row.match.status}`}>{getCurriculumMatchLabel(row.match.status)}</span></td>
                            <td>{row.errors.map((error) => <small className="import-error" key={error}>{error}</small>)}{row.warnings.map((warning) => <small className="import-warning" key={warning}>{warning}</small>)}{(row.aiWarnings || []).map((warning) => <small className="import-warning" key={warning}>{warning}</small>)}</td>
                            <td><button className="text-danger" type="button" onClick={() => removeBulkPreviewRow(row.rowNumber)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button
                    className="primary"
                    type="button"
                    disabled={bulkImporting || bulkPreview.errors.length > 0 || bulkPreview.rows.some((row) => row.errors.length > 0) || !bulkPackageDraft.publisher_name.trim() || !bulkPackageDraft.name.trim()}
                    onClick={importPreviewedMaterials}
                  >
                    {bulkImporting ? "Creating package…" : `Create draft with ${bulkPreview.rows.length} materials`}
                  </button>
                </>
              )}
            </section>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
