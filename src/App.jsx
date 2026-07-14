import { useRef, useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import "./App.css";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "https://ilhrc-intake-app.onrender.com";

const PUBLIC_CATALOG_COLUMNS = [
  "id",
  "title",
  "curriculum",
  "subject",
  "grade_level",
  "category",
  "edition",
  "isbn",
  "final_price",
  "quantity",
  "image_url",
  "created_at",
].join(",");

const INTERNAL_VIEWS = new Set(["add", "inventory", "labels", "options", "users"]);
const PASSWORD_MIN_LENGTH = 10;

function getAuthUrlType() {
  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return searchParams.get("type") || hashParams.get("type") || "";
}

function sessionRequiresPasswordSetup(nextSession) {
  const appMetadata = nextSession?.user?.app_metadata || {};

  if (appMetadata.password_setup_required === true) return true;
  if (appMetadata.password_setup_required === false) return false;

  return getAuthUrlType() === "invite";
}

async function shrinkImageFile(file, maxSize = 1400, quality = 0.82) {
  if (!file?.type?.startsWith("image/")) return file;

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageUrl;
    });

    const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
    if (scale >= 1 && file.size < 900_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);

    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );

    if (!blob) return file;

    const cleanName = file.name.replace(/\.[^.]+$/, "") || "book-cover";
    return new File([blob], `${cleanName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function getOptimizedImageUrl(url, width = 240, height = 320) {
  if (!url) return "";

  const cleanUrl = String(url).replace(/^http:\/\//i, "https://");

  if (!cleanUrl.includes("/storage/v1/object/public/book-covers/")) {
    return cleanUrl;
  }

  const [baseUrl, existingQuery = ""] = cleanUrl.split("?");
  const renderUrl = baseUrl.replace(
    "/storage/v1/object/public/",
    "/storage/v1/render/image/public/"
  );
  const params = new URLSearchParams(existingQuery);

  params.set("width", String(width));
  params.set("height", String(height));
  params.set("resize", "contain");
  params.set("quality", "72");

  return `${renderUrl}?${params.toString()}`;
}

function BookCoverImage({
  src,
  alt,
  className = "",
  width = 240,
  height = 320,
  eager = false,
}) {
  if (!src) return null;

  return (
    <img
      src={getOptimizedImageUrl(src, width, height)}
      alt={alt || "Book cover"}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "low"}
    />
  );
}

export default function App() {
  const [view, setView] = useState(() => {
    const hashView = window.location.hash.replace("#", "");
    return hashView === "catalog" ? "catalog" : "add";
  });
  const [items, setItems] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [authLoading, setAuthLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordSetupRequired, setPasswordSetupRequired] = useState(false);
  const [setupPassword, setSetupPassword] = useState("");
  const [setupConfirmPassword, setSetupConfirmPassword] = useState("");
  const [passwordSetupLoading, setPasswordSetupLoading] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState("");
  const [passwordSetupMessage, setPasswordSetupMessage] = useState("");
  const [passwordSetupSaved, setPasswordSetupSaved] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [changePassword, setChangePassword] = useState("");
  const [changeConfirmPassword, setChangeConfirmPassword] = useState("");
  const [changePasswordLoading, setChangePasswordLoading] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState("");
  const [changePasswordMessage, setChangePasswordMessage] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [userManagementMessage, setUserManagementMessage] = useState("");
  const [inviteForm, setInviteForm] = useState({
    email: "",
    full_name: "",
    role: "team",
  });

  const coverInputRef = useRef(null);
  const isbnInputRef = useRef(null);

  const [coverPhoto, setCoverPhoto] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [isbnPhoto, setIsbnPhoto] = useState(null);
  const [bookData, setBookData] = useState(null);

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

  const [sortBy, setSortBy] = useState("newest");
  const [isScanningBarcode, setIsScanningBarcode] = useState(false);

  const listingPhotoInputRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);

  const editPhotoInputRef = useRef(null);
  const [editCoverFile, setEditCoverFile] = useState(null);
  const [editCoverPreview, setEditCoverPreview] = useState(null);

  const [analysisStatus, setAnalysisStatus] = useState("");

  const [curriculumOptions, setCurriculumOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [gradeOptions, setGradeOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [locationOptions, setLocationOptions] = useState([]);

  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const [bulkCurriculum, setBulkCurriculum] = useState("");
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkGrade, setBulkGrade] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const [bulkPublicVisible, setBulkPublicVisible] = useState("");

  const [currentLocation, setCurrentLocation] = useState("");
  const [labelLocationFilter, setLabelLocationFilter] = useState("");
  const [labelDateFrom, setLabelDateFrom] = useState("");
  const [labelDateTo, setLabelDateTo] = useState("");

  const [locationFilter, setLocationFilter] = useState("");
  const [inventoryDateFrom, setInventoryDateFrom] = useState("");
  const [inventoryDateTo, setInventoryDateTo] = useState("");
  const [newLocationName, setNewLocationName] = useState("");
  const [newLocationTemporary, setNewLocationTemporary] = useState(false);
  const [renameLocationId, setRenameLocationId] = useState("");
  const [renameLocationName, setRenameLocationName] = useState("");
  const [deactivateLocationId, setDeactivateLocationId] = useState("");
  const [mergeFromLocationId, setMergeFromLocationId] = useState("");
  const [mergeToLocationId, setMergeToLocationId] = useState("");
  const [locationListFilter, setLocationListFilter] = useState("all");
  const [optionAddNames, setOptionAddNames] = useState({
    curriculum: "",
    subject: "",
    grade: "",
  });
  const [optionRenameSelections, setOptionRenameSelections] = useState({
    curriculum: "",
    subject: "",
    grade: "",
  });
  const [optionRenameNames, setOptionRenameNames] = useState({
    curriculum: "",
    subject: "",
    grade: "",
  });
  const [optionDeleteSelections, setOptionDeleteSelections] = useState({
    curriculum: "",
    subject: "",
    grade: "",
  });
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryPrice, setNewCategoryPrice] = useState("");
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editCategoryNewName, setEditCategoryNewName] = useState("");
  const [editCategoryPrice, setEditCategoryPrice] = useState("");
  const [deleteCategoryName, setDeleteCategoryName] = useState("");

  const isAuthenticated = Boolean(session && profile && profile.is_active !== false);
  const isAdmin = profile?.role === "admin";
  const isInternalView = INTERNAL_VIEWS.has(view);
  const shouldShowPasswordSetup = Boolean(session && passwordSetupRequired);

  useEffect(() => {
    let mounted = true;

    async function initializeAuth() {
      const { data } = await supabase.auth.getSession();

      if (!mounted) return;

      setSession(data.session || null);
      setPasswordSetupRequired(sessionRequiresPasswordSetup(data.session));

      if (data.session) {
        await refreshProfile(data.session);
      } else {
        setProfile(null);
      }

      setAuthLoading(false);
    }

    initializeAuth();

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_event, nextSession) => {
        setSession(nextSession);
        setPasswordSetupRequired(sessionRequiresPasswordSetup(nextSession));

        if (nextSession) {
          await refreshProfile(nextSession);
        } else {
          setProfile(null);
          setProfileLoading(false);
          setPasswordSetupRequired(false);
          setPasswordSetupSaved(false);
          if (INTERNAL_VIEWS.has(view)) setView("catalog");
        }
      }
    );

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    window.location.hash = view === "catalog" ? "catalog" : "";
  }, [view]);

  useEffect(() => {
    if (authLoading || profileLoading || shouldShowPasswordSetup) return;

    if (isInternalView && !isAuthenticated) {
      setView("catalog");
      if (!session) {
        setAuthMessage("Please sign in to use internal tools.");
      }
      return;
    }

    if (view === "users" && !isAdmin) {
      setView("inventory");
      setAuthMessage("Admin access is required for user management.");
    }
  }, [
    authLoading,
    profileLoading,
    shouldShowPasswordSetup,
    isAuthenticated,
    isAdmin,
    isInternalView,
    session,
    view,
  ]);

  useEffect(() => {
    if (authLoading || shouldShowPasswordSetup) return;
    loadItems();
    loadOptionLists();
  }, [authLoading, shouldShowPasswordSetup, isAuthenticated]);

  useEffect(() => {
    if (view === "users" && isAdmin) {
      loadUsers();
      loadAuditLogs();
    }
  }, [view, isAdmin]);

  async function refreshProfile(nextSession = session) {
    const accessToken = nextSession?.access_token;

    if (!accessToken) {
      setProfile(null);
      setProfileLoading(false);
      setAuthMessage("Please sign in to use internal tools.");
      return null;
    }

    setProfileLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        setProfile(null);
        setAuthMessage(data.error || "Your session has expired. Please sign in again.");
        await supabase.auth.signOut();
        return null;
      }

      if (response.status === 403) {
        setProfile(null);
        setAuthMessage(
          data.error || "This account is not active or is missing a team profile."
        );
        return null;
      }

      if (!response.ok) {
        setProfile(null);
        setAuthMessage(data.error || "Could not verify account access.");
        return null;
      }

      if (!data.profile) {
        setProfile(null);
        setAuthMessage("This account is missing a team profile.");
        return null;
      }

      setProfile(data.profile);
      setAuthMessage("");

      if (view === "catalog") setView("add");

      return data.profile;
    } catch {
      setProfile(null);
      setAuthMessage("Could not reach the authentication server. Please try again.");
      return null;
    } finally {
      setProfileLoading(false);
    }
  }

  async function authFetch(path, options = {}) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;

    if (!accessToken) {
      throw new Error("Please sign in to continue.");
    }

    const headers = {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
      Authorization: `Bearer ${accessToken}`,
    };

    return fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  }

  async function logAudit(action, entityType, entityId, details = {}) {
    if (!isAuthenticated) return;

    const safeDetails = { ...details };
    delete safeDetails.password;
    delete safeDetails.token;
    delete safeDetails.access_token;

    await supabase.from("audit_logs").insert([
      {
        user_id: profile?.id || null,
        action,
        entity_type: entityType,
        entity_id: entityId ? String(entityId) : null,
        details: safeDetails,
      },
    ]);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginLoading(true);
    setAuthMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    if (error) {
      setAuthMessage("Invalid email or password.");
      setLoginLoading(false);
      return;
    }

    const nextProfile = await refreshProfile(data.session);
    setLoginLoading(false);

    if (!nextProfile) {
      setLoginLoading(false);
      return;
    }

    if (nextProfile.is_active === false) {
      setAuthMessage("This account is inactive. Please contact an Admin.");
      return;
    }

    setLoginPassword("");
    setView("add");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setPasswordSetupRequired(false);
    setPasswordSetupSaved(false);
    setSetupPassword("");
    setSetupConfirmPassword("");
    setChangePasswordOpen(false);
    setView("catalog");
  }

  function validatePasswordPair(password, confirmPassword) {
    if (password.length < PASSWORD_MIN_LENGTH) {
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    }

    if (password !== confirmPassword) {
      return "Passwords do not match.";
    }

    return "";
  }

  async function refreshSessionAndProfile() {
    const { data: refreshData, error: refreshError } =
      await supabase.auth.refreshSession();

    if (refreshError) {
      setAuthMessage("Password saved, but the session could not refresh. Please sign in again.");
      await supabase.auth.signOut();
      return null;
    }

    const nextSession = refreshData.session;
    setSession(nextSession);
    setPasswordSetupRequired(sessionRequiresPasswordSetup(nextSession));
    await refreshProfile(nextSession);
    return nextSession;
  }

  async function completePasswordSetup(event) {
    event.preventDefault();
    if (passwordSetupLoading) return;

    setPasswordSetupError("");
    setPasswordSetupMessage("");
    setPasswordSetupLoading(true);

    try {
      if (!passwordSetupSaved) {
        const validationError = validatePasswordPair(
          setupPassword,
          setupConfirmPassword
        );

        if (validationError) {
          setPasswordSetupError(validationError);
          return;
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: setupPassword,
        });

        if (updateError) {
          setPasswordSetupError(updateError.message || "Could not save password.");
          return;
        }

        setSetupPassword("");
        setSetupConfirmPassword("");
        setPasswordSetupSaved(true);
        setPasswordSetupMessage("Password saved. Finishing account setup...");
      }

      const response = await authFetch("/auth/complete-password-setup", {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setPasswordSetupError(
          data.error ||
            "Password was saved, but setup could not be completed. Try again."
        );
        setPasswordSetupMessage("Password saved. You can retry without re-entering it.");
        return;
      }

      await refreshSessionAndProfile();
      setPasswordSetupRequired(false);
      setPasswordSetupSaved(false);
      setPasswordSetupMessage("");
      setView("add");
    } finally {
      setPasswordSetupLoading(false);
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    if (changePasswordLoading) return;

    setChangePasswordError("");
    setChangePasswordMessage("");

    const validationError = validatePasswordPair(
      changePassword,
      changeConfirmPassword
    );

    if (validationError) {
      setChangePasswordError(validationError);
      return;
    }

    const confirmed = confirm("Change your account password?");
    if (!confirmed) return;

    setChangePasswordLoading(true);

    const { error } = await supabase.auth.updateUser({
      password: changePassword,
    });

    setChangePasswordLoading(false);

    if (error) {
      setChangePasswordError(error.message || "Could not change password.");
      return;
    }

    setChangePassword("");
    setChangeConfirmPassword("");
    setChangePasswordMessage("Password changed.");
    await refreshSessionAndProfile();
  }

  async function loadUsers() {
    const response = await authFetch("/admin/users");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setUserManagementMessage(data.error || "Could not load users.");
      return;
    }

    setUsers(data.users || []);
  }

  async function loadAuditLogs() {
    const response = await authFetch("/admin/audit-logs");
    const data = await response.json().catch(() => ({}));

    if (response.ok) {
      setAuditLogs(data.audit_logs || []);
    }
  }

  async function inviteUser(event) {
    event.preventDefault();
    setUserManagementMessage("");

    const response = await authFetch("/admin/users/invite", {
      method: "POST",
      body: JSON.stringify(inviteForm),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setUserManagementMessage(data.error || "Failed invitation.");
      return;
    }

    setInviteForm({ email: "", full_name: "", role: "team" });
    setUserManagementMessage("Invitation sent.");
    loadUsers();
    loadAuditLogs();
  }

  async function updateUserProfile(user, updates) {
    const action =
      updates.role && updates.role !== user.role
        ? `Change ${user.email} to ${updates.role}?`
        : updates.is_active === false
          ? `Deactivate ${user.email}?`
          : updates.is_active === true
            ? `Reactivate ${user.email}?`
            : `Update ${user.email}?`;

    if (!confirm(action)) return;

    if (user.id === profile?.id && updates.is_active === false) {
      const selfConfirmed = confirm(
        "This is your current account. Deactivating it will sign you out and block internal access. Continue?"
      );

      if (!selfConfirmed) return;
    }

    const response = await authFetch(`/admin/users/${user.id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setUserManagementMessage(data.error || "User update failed.");
      return;
    }

    setUserManagementMessage("User updated.");
    setUsers((current) =>
      current.map((currentUser) =>
        currentUser.id === data.user.id ? data.user : currentUser
      )
    );
    loadAuditLogs();
  }

  async function loadItems() {
    const tableName = isAuthenticated ? "items" : "public_catalog_items";
    const columns = isAuthenticated ? "*" : PUBLIC_CATALOG_COLUMNS;

    const { data, error } = await supabase
      .from(tableName)
      .select(columns)
      .order("created_at", { ascending: false });

    if (error) {
      alert(
        isAuthenticated
          ? "Could not load inventory: " + error.message
          : "Could not load the public catalog."
      );
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
      .select(isAuthenticated ? "*" : "name")
      .order("name");

    const { data: locations } = isAuthenticated
      ? await supabase.from("location_options").select("*").order("name")
      : { data: [], error: null };

  setCurriculumOptions(curricula?.map((x) => x.name) || []);
  setSubjectOptions(subjects?.map((x) => x.name) || []);
  setGradeOptions(grades?.map((x) => x.name) || []);
  setCategoryOptions(categories || []);
  setLocationOptions(locations || []);
}

function normalizeLocationName(value) {
  return (value || "").trim().toLowerCase();
}

function cleanLocationName(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

function getLocationOptionById(id) {
  return locationOptions.find((location) => location.id === id);
}

function getLocationOptionByName(name) {
  const normalizedName = normalizeLocationName(name);
  return locationOptions.find(
    (location) => normalizeLocationName(location.name) === normalizedName
  );
}

function isTemporaryLocationName(name) {
  return getLocationOptionByName(name)?.temporary === true;
}

function buildLocationList(values) {
  const byNormalizedName = new Map();

  values.forEach((value) => {
    const name = cleanLocationName(value);
    const normalizedName = normalizeLocationName(name);

    if (!normalizedName || byNormalizedName.has(normalizedName)) return;

    byNormalizedName.set(normalizedName, name);
  });

  return [...byNormalizedName.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function getActiveLocationNames(extraValues = []) {
  return buildLocationList([
    ...locationOptions
      .filter((location) => location.active !== false)
      .map((location) => location.name),
    ...extraValues,
  ]);
}

function locationMatches(value, selectedValue) {
  if (!selectedValue) return true;
  return normalizeLocationName(value) === normalizeLocationName(selectedValue);
}

function optionNameMatches(value, selectedValue) {
  return normalizeLocationName(value) === normalizeLocationName(selectedValue);
}

function getDateOnly(value) {
  if (!value) return "";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toISOString().slice(0, 10);
}

function formatDateAdded(value) {
  if (!value) return "Unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";

  return date.toLocaleDateString();
}

function dateAddedMatches(item, fromDate, toDate) {
  const itemDate = getDateOnly(item.created_at);

  if (!itemDate && (fromDate || toDate)) return false;
  if (fromDate && itemDate < fromDate) return false;
  if (toDate && itemDate > toDate) return false;

  return true;
}

function getManagedOptionConfig(optionType) {
  const configs = {
    curriculum: {
      tableName: "curriculum_options",
      itemColumn: "curriculum",
      options: curriculumOptions,
      label: "Curriculum",
    },
    subject: {
      tableName: "subject_options",
      itemColumn: "subject",
      options: subjectOptions,
      label: "Subject",
    },
    grade: {
      tableName: "grade_options",
      itemColumn: "grade_level",
      options: gradeOptions,
      label: "Grade Level",
    },
  };

  return configs[optionType];
}

function getItemIdsByOptionValue(itemColumn, oldValue) {
  const normalizedValue = normalizeLocationName(oldValue);

  return items
    .filter((item) => normalizeLocationName(item[itemColumn]) === normalizedValue)
    .map((item) => item.id);
}

async function updateItemsOptionValue(itemColumn, oldValue, newValue) {
  const ids = getItemIdsByOptionValue(itemColumn, oldValue);

  if (ids.length === 0) return;

  const { error } = await supabase
    .from("items")
    .update({
      [itemColumn]: cleanLocationName(newValue),
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) throw error;
}

function optionExists(options, name) {
  return options.some((option) => optionNameMatches(option, name));
}

async function addManagedTextOption(optionType) {
  const config = getManagedOptionConfig(optionType);
  const cleanedName = cleanLocationName(optionAddNames[optionType]);

  if (!cleanedName) {
    alert(`Enter a ${config.label.toLowerCase()} name.`);
    return;
  }

  if (optionExists(config.options, cleanedName)) {
    alert(`${config.label} already exists.`);
    return;
  }

  const { error } = await supabase
    .from(config.tableName)
    .insert([{ name: cleanedName }]);

  if (error) {
    alert(`Could not add ${config.label.toLowerCase()}: ` + error.message);
    return;
  }

  setOptionAddNames((current) => ({ ...current, [optionType]: "" }));
  await loadOptionLists();
}

async function renameManagedTextOption(optionType) {
  const config = getManagedOptionConfig(optionType);
  const oldName = optionRenameSelections[optionType];
  const newName = cleanLocationName(optionRenameNames[optionType]);

  if (!oldName || !newName) {
    alert(`Choose a ${config.label.toLowerCase()} and enter the new name.`);
    return;
  }

  const duplicate = config.options.some(
    (option) => !optionNameMatches(option, oldName) && optionNameMatches(option, newName)
  );

  if (duplicate) {
    alert(`${config.label} already exists. Choose a different name.`);
    return;
  }

  try {
    const { error } = await supabase
      .from(config.tableName)
      .update({ name: newName })
      .eq("name", oldName);

    if (error) throw error;

    await updateItemsOptionValue(config.itemColumn, oldName, newName);

    setOptionRenameSelections((current) => ({ ...current, [optionType]: "" }));
    setOptionRenameNames((current) => ({ ...current, [optionType]: "" }));
    await loadItems();
    await loadOptionLists();
    alert(`${config.label} renamed.`);
  } catch (error) {
    alert(`Could not rename ${config.label.toLowerCase()}: ` + error.message);
  }
}

async function deleteManagedTextOption(optionType) {
  const config = getManagedOptionConfig(optionType);
  const name = optionDeleteSelections[optionType];

  if (!name) {
    alert(`Choose a ${config.label.toLowerCase()} to remove.`);
    return;
  }

  const confirmed = confirm(
    `Remove "${name}" from future ${config.label.toLowerCase()} dropdowns? Existing inventory will keep this value.`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from(config.tableName)
    .delete()
    .eq("name", name);

  if (error) {
    alert(`Could not remove ${config.label.toLowerCase()}: ` + error.message);
    return;
  }

  setOptionDeleteSelections((current) => ({ ...current, [optionType]: "" }));
  await loadOptionLists();
}

async function addCategoryOption() {
  const cleanedName = cleanLocationName(newCategoryName);

  if (!cleanedName) {
    alert("Enter a category name.");
    return;
  }

  const duplicate = categoryOptions.some((category) =>
    optionNameMatches(category.name, cleanedName)
  );

  if (duplicate) {
    alert("Category already exists.");
    return;
  }

  const price =
    newCategoryPrice === "" || newCategoryPrice === null
      ? null
      : Number(newCategoryPrice);

  const { error } = await supabase.from("category_options").insert([
    {
      name: cleanedName,
      default_price: Number.isNaN(price) ? null : price,
    },
  ]);

  if (error) {
    alert("Could not add category: " + error.message);
    return;
  }

  setNewCategoryName("");
  setNewCategoryPrice("");
  await loadOptionLists();
}

async function updateCategoryOption() {
  const oldName = editCategoryName;
  const newName = cleanLocationName(editCategoryNewName);

  if (!oldName || !newName) {
    alert("Choose a category and enter its name.");
    return;
  }

  const duplicate = categoryOptions.some(
    (category) =>
      !optionNameMatches(category.name, oldName) &&
      optionNameMatches(category.name, newName)
  );

  if (duplicate) {
    alert("Another category already uses that name.");
    return;
  }

  const price =
    editCategoryPrice === "" || editCategoryPrice === null
      ? null
      : Number(editCategoryPrice);

  try {
    const { error } = await supabase
      .from("category_options")
      .update({
        name: newName,
        default_price: Number.isNaN(price) ? null : price,
      })
      .eq("name", oldName);

    if (error) throw error;

    await updateItemsOptionValue("category", oldName, newName);

    setEditCategoryName("");
    setEditCategoryNewName("");
    setEditCategoryPrice("");
    await loadItems();
    await loadOptionLists();
    alert("Category updated.");
  } catch (error) {
    alert("Could not update category: " + error.message);
  }
}

async function deleteCategoryOption() {
  if (!deleteCategoryName) {
    alert("Choose a category to remove.");
    return;
  }

  const confirmed = confirm(
    `Remove "${deleteCategoryName}" from future category dropdowns? Existing inventory will keep this category.`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("category_options")
    .delete()
    .eq("name", deleteCategoryName);

  if (error) {
    alert("Could not remove category: " + error.message);
    return;
  }

  setDeleteCategoryName("");
  await loadOptionLists();
}

function getItemIdsByLocation(locationName) {
  const normalizedName = normalizeLocationName(locationName);

  return items
    .filter((item) => normalizeLocationName(item.location) === normalizedName)
    .map((item) => item.id);
}

async function updateItemsLocationByName(oldLocationName, newLocationName) {
  const ids = getItemIdsByLocation(oldLocationName);

  if (ids.length === 0) return;

  const { error } = await supabase
    .from("items")
    .update({
      location: cleanLocationName(newLocationName),
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);

  if (error) throw error;
}

async function addLocationOption(name, temporary = false) {
  const cleanedName = cleanLocationName(name);
  const normalizedName = normalizeLocationName(cleanedName);

  if (!normalizedName) {
    alert("Enter a location name.");
    return false;
  }

  const existing = locationOptions.find(
    (location) => normalizeLocationName(location.name) === normalizedName
  );

  if (existing) {
    alert("That location already exists.");
    return false;
  }

  const { error } = await supabase.from("location_options").insert([
    {
      name: cleanedName,
      normalized_name: normalizedName,
      active: true,
      temporary,
    },
  ]);

  if (error) {
    alert("Could not add location: " + error.message);
    return false;
  }

  return true;
}

async function handleAddLocation() {
  const added = await addLocationOption(newLocationName, newLocationTemporary);

  if (!added) return;

  setNewLocationName("");
  setNewLocationTemporary(false);
  await loadOptionLists();
}

async function seedTemporaryLocations() {
  const defaults = ["Box 1", "Box 2", "Box 3", "Box 4"];

  for (const locationName of defaults) {
    const normalizedName = normalizeLocationName(locationName);
    const exists = locationOptions.some(
      (location) => normalizeLocationName(location.name) === normalizedName
    );

    if (!exists) {
      const { error } = await supabase.from("location_options").insert([
        {
          name: locationName,
          normalized_name: normalizedName,
          active: true,
          temporary: true,
        },
      ]);

      if (error && error.code !== "23505") {
        alert("Could not seed temporary locations: " + error.message);
        return;
      }
    }
  }

  await loadOptionLists();
  alert("Temporary locations are ready.");
}

async function renameLocation() {
  const location = getLocationOptionById(renameLocationId);
  const cleanedName = cleanLocationName(renameLocationName);
  const normalizedName = normalizeLocationName(cleanedName);

  if (!location || !normalizedName) {
    alert("Choose a location and enter the new name.");
    return;
  }

  const duplicate = locationOptions.find(
    (option) =>
      option.id !== location.id &&
      normalizeLocationName(option.name) === normalizedName
  );

  if (duplicate) {
    alert("Another location already uses that name. Use merge instead.");
    return;
  }

  try {
    const { error } = await supabase
      .from("location_options")
      .update({
        name: cleanedName,
        normalized_name: normalizedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", location.id);

    if (error) throw error;

    await updateItemsLocationByName(location.name, cleanedName);

    setRenameLocationId("");
    setRenameLocationName("");
    await loadItems();
    await loadOptionLists();
    alert("Location renamed.");
  } catch (error) {
    alert("Could not rename location: " + error.message);
  }
}

async function deactivateLocation() {
  const location = getLocationOptionById(deactivateLocationId);

  if (!location) {
    alert("Choose a location to deactivate.");
    return;
  }

  const confirmed = confirm(
    `Deactivate "${location.name}"? Existing inventory will keep this location, but it will be removed from future dropdowns.`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("location_options")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", location.id);

  if (error) {
    alert("Could not deactivate location: " + error.message);
    return;
  }

  if (locationMatches(currentLocation, location.name)) {
    setCurrentLocation("");
  }

  setDeactivateLocationId("");
  await loadOptionLists();
  alert("Location deactivated.");
}

async function mergeLocations() {
  const source = getLocationOptionById(mergeFromLocationId);
  const target = getLocationOptionById(mergeToLocationId);

  if (!source || !target) {
    alert("Choose both locations to merge.");
    return;
  }

  if (source.id === target.id) {
    alert("Choose two different locations.");
    return;
  }

  const confirmed = confirm(
    `Move all items from "${source.name}" to "${target.name}", then deactivate "${source.name}"?`
  );

  if (!confirmed) return;

  try {
    await updateItemsLocationByName(source.name, target.name);

    const { error } = await supabase
      .from("location_options")
      .update({
        active: false,
        merged_into_id: target.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", source.id);

    if (error) throw error;

    if (locationMatches(currentLocation, source.name)) {
      setCurrentLocation(target.name);
    }

    if (locationMatches(locationFilter, source.name)) {
      setLocationFilter(target.name);
    }

    if (locationMatches(labelLocationFilter, source.name)) {
      setLabelLocationFilter(target.name);
    }

    setMergeFromLocationId("");
    setMergeToLocationId("");
    await loadItems();
    await loadOptionLists();
    alert("Locations merged.");
  } catch (error) {
    alert("Could not merge locations: " + error.message);
  }
}

async function toggleLocationTemporary(location) {
  const { error } = await supabase
    .from("location_options")
    .update({
      temporary: !location.temporary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", location.id);

  if (error) {
    alert("Could not update location: " + error.message);
    return;
  }

  await loadOptionLists();
}

async function deactivateEmptyTemporaryLocations() {
  const emptyTemporaryLocations = locationOptions.filter(
    (location) =>
      location.temporary === true &&
      location.active !== false &&
      !locationUsageCounts[normalizeLocationName(location.name)]
  );

  if (emptyTemporaryLocations.length === 0) {
    alert("No empty temporary locations to deactivate.");
    return;
  }

  const confirmed = confirm(
    `Deactivate ${emptyTemporaryLocations.length} empty temporary location(s)?`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("location_options")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .in(
      "id",
      emptyTemporaryLocations.map((location) => location.id)
    );

  if (error) {
    alert("Could not deactivate empty temporary locations: " + error.message);
    return;
  }

  await loadOptionLists();
  alert("Empty temporary locations deactivated.");
}

async function clearTemporaryLocationsFromSelected() {
  const selectedItemsWithTemporaryLocations = items.filter(
    (item) =>
      selectedItemIds.includes(item.id) &&
      item.location &&
      isTemporaryLocationName(item.location)
  );

  if (selectedItemsWithTemporaryLocations.length === 0) {
    alert("None of the selected items are in temporary locations.");
    return;
  }

  const confirmed = confirm(
    `Clear temporary locations from ${selectedItemsWithTemporaryLocations.length} selected item(s)?`
  );

  if (!confirmed) return;

  const { error } = await supabase
    .from("items")
    .update({
      location: "",
      updated_at: new Date().toISOString(),
    })
    .in(
      "id",
      selectedItemsWithTemporaryLocations.map((item) => item.id)
    );

  if (error) {
    alert("Could not clear temporary locations: " + error.message);
    return;
  }

  await loadItems();
  alert("Temporary locations cleared from selected items.");
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

  const actionLabel = isAdmin ? "Delete" : "Remove";
  const confirmed = window.confirm(
    `${actionLabel} ${selectedItemIds.length} selected item(s)? This will also archive them in Square.`
  );

  if (!confirmed) return;

  try {
    const selectedItems = items.filter((item) =>
      selectedItemIds.includes(item.id)
    );

    for (const item of selectedItems) {
      const squareItemId = item.square_item_id;

      if (squareItemId) {
        const archiveRes = await authFetch(
          "/archive-square-item",
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

    if (isAdmin) {
      const { error } = await supabase
        .from("items")
        .delete()
        .in("id", selectedItemIds);

      if (error) throw error;

      setItems((prev) =>
        prev.filter((item) => !selectedItemIds.includes(item.id))
      );

      await logAudit("inventory_bulk_delete", "items", null, {
        count: selectedItemIds.length,
        item_ids: selectedItemIds,
      });
    } else {
      const removedAt = new Date().toISOString();
      const { error } = await supabase
        .from("items")
        .update({
          status: "Removed",
          public_visible: false,
          updated_at: removedAt,
        })
        .in("id", selectedItemIds);

      if (error) throw error;

      setItems((prev) =>
        prev.map((item) =>
          selectedItemIds.includes(item.id)
            ? { ...item, status: "Removed", public_visible: false, updated_at: removedAt }
            : item
        )
      );

      await logAudit("inventory_bulk_removed", "items", null, {
        count: selectedItemIds.length,
        item_ids: selectedItemIds,
      });
    }

    setSelectedItemIds([]);

    alert(
      isAdmin
        ? "Selected items archived in Square and deleted."
        : "Selected items archived in Square and marked Removed."
    );
  } catch (err) {
  console.error("Bulk delete failed full error:", err);

  const message = (() => {
    try {
      return (
      err?.message ||
      err?.error?.message ||
      err?.errors?.[0]?.detail ||
      err?.errors?.[0]?.message ||
      JSON.stringify(err)
      );
    } catch {
      return String(err);
    }
  })();

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
          const archiveResponse = await authFetch(
            "/archive-square-item",
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

    await logAudit("inventory_bulk_update", "items", null, {
      count: selectedItemIds.length,
      item_ids: selectedItemIds,
      fields: Object.keys(updates),
    });

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


async function handleCoverPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setCoverPhoto(URL.createObjectURL(file));
  setBookData(null);

  const optimizedFile = await shrinkImageFile(file);
  setCoverFile(optimizedFile);

  analyzePhotoWithFile(optimizedFile);
}

function startManualEntry() {
  setBookData({
    title: "",
    curriculum: "",
    publisher: "",
    subject: "",
    grade_level: "",
    edition: "",
    isbn: "",
    category: "",
    suggested_price: "",
    final_price: "",
    quantity: 1,
    weight_ounces: "",
    status: "Available",
    notes: "",
    confidence: "",
    public_visible: true,
  });
  setAnalysisStatus("");
  setIsbnPhoto(null);
}


  function handleIsbnPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsbnPhoto(URL.createObjectURL(file));
    setBookData(null);
  }

async function handleListingPhoto(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  setCoverPhoto(URL.createObjectURL(file));
  setCoverFile(await shrinkImageFile(file));
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
  const cleanIsbn = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if (!cleanIsbn) return;

  setAnalysisStatus("Looking up ISBN...");

  try {
    const googleUrl =
  `https://www.googleapis.com/books/v1/volumes?q=isbn:${cleanIsbn}&key=${import.meta.env.VITE_GOOGLE_BOOKS_API_KEY}`;

    const [googleResult, openLibraryResult] = await Promise.allSettled([
      fetch(googleUrl).then((response) => response.json()),
      fetch(`https://openlibrary.org/isbn/${cleanIsbn}.json`).then(
        async (response) => (response.ok ? response.json() : null)
      ),
    ]);

    const googleData =
      googleResult.status === "fulfilled" ? googleResult.value : null;

    if (googleData?.items && googleData.items.length > 0) {
      const book = googleData.items[0].volumeInfo;
      const suggested = suggestPricingCategory(book);
      const weightEstimate = estimateWeightFromMetadata({
        title: book.title || "",
        category: suggested?.name || "",
        categories: book.categories || [],
        pageCount: book.pageCount,
        format: book.printType || "",
      });

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
  isbn: cleanIsbn,
  category: suggested?.name || "",
  suggested_price: suggested?.default_price || "",
  final_price: suggested?.default_price || "",
  quantity: 1,
  weight_ounces: weightEstimate.weight_ounces,
  weight_note: weightEstimate.note,
  status: "Available",
  notes: book.description || "",
  confidence: "Google Books ISBN lookup",
  public_visible: true,
  image_url: coverUrl,});

      setAnalysisStatus("ISBN lookup complete!");
      setTimeout(() => setAnalysisStatus(""), 1800);
      return;
    }

    const openLibraryData =
      openLibraryResult.status === "fulfilled" ? openLibraryResult.value : null;

    if (openLibraryData) {
      const suggested = suggestPricingCategory({
  title: openLibraryData.title || "",
  publisher: openLibraryData.publishers?.[0] || "",
  categories: [],
});
      const weightEstimate = estimateWeightFromMetadata({
        title: openLibraryData.title || "",
        category: suggested?.name || suggested?.item_name || "",
        pageCount: openLibraryData.number_of_pages,
        pagination: openLibraryData.pagination,
        weight: openLibraryData.weight,
        physical_weight: openLibraryData.physical_weight,
        physical_format: openLibraryData.physical_format,
      });

      setBookData({
        title: openLibraryData.title || "",
        curriculum: openLibraryData.publishers?.[0] || "",
        subject: "",
        grade_level: "",
        edition: "",
        isbn: cleanIsbn,
       category: suggested?.item_name || "",
        suggested_price: suggested?.price || "",
        final_price: suggested?.price || "",
        quantity: 1,
        weight_ounces: weightEstimate.weight_ounces,
        weight_note: weightEstimate.note,
        status: "Available",
        notes: "",
        confidence: "Open Library ISBN lookup",
        public_visible: true,
      });

      setAnalysisStatus("ISBN lookup complete!");
      setTimeout(() => setAnalysisStatus(""), 1800);
      return;
    }

    // 3. If neither source finds it, still fill ISBN
    setBookData({
      title: "",
      curriculum: "",
      subject: "",
      grade_level: "",
      edition: "",
      isbn: cleanIsbn,
      category: "",
      final_price: "",
      quantity: 1,
      weight_ounces: "",
      status: "Available",
      notes: "",
      confidence: "ISBN scanned only",
      public_visible: true,
    });

    setAnalysisStatus("");
    alert("ISBN scanned, but no book data was found. You can enter the details manually.");
  } catch (error) {
    setAnalysisStatus("");
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
  setAnalysisStatus("Preparing image...");

  try {
    const formData = new FormData();
    formData.append("cover", file);

    setAnalysisStatus("Sending image to AI server...");

    const response = await authFetch("/analyze-book", {
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
  weight_ounces: getWeightFromBookData(improvedData) ?? "",
  weight_note:
    getWeightFromBookData(improvedData) !== null
      ? "Estimated by AI. Please adjust if needed."
      : "",
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

function cleanWeightOunces(value) {
  if (value === "" || value === null || value === undefined) return null;

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.ceil(number) : null;
}

function getWeightPounds(totalOunces) {
  const ounces = cleanWeightOunces(totalOunces);
  if (ounces === null) return "";

  const pounds = Math.floor(ounces / 16);
  return pounds === 0 ? "" : pounds;
}

function getWeightRemainingOunces(totalOunces) {
  const ounces = cleanWeightOunces(totalOunces);
  if (ounces === null) return "";

  return ounces % 16;
}

function combineWeightPoundsOunces(pounds, ounces) {
  const cleanPounds = pounds === "" ? 0 : Number(pounds);
  const cleanOunces = ounces === "" ? 0 : Number(ounces);

  if (
    !Number.isFinite(cleanPounds) ||
    !Number.isFinite(cleanOunces) ||
    cleanPounds < 0 ||
    cleanOunces < 0
  ) {
    return "";
  }

  const totalOunces = cleanPounds * 16 + cleanOunces;
  return totalOunces === 0 ? "" : Math.ceil(totalOunces);
}

function formatWeight(totalOunces) {
  const ounces = cleanWeightOunces(totalOunces);
  if (ounces === null) return "";

  const pounds = Math.floor(ounces / 16);
  const remainingOunces = ounces % 16;

  if (pounds > 0 && remainingOunces > 0) {
    return `${pounds} lb ${remainingOunces} oz`;
  }

  if (pounds > 0) {
    return `${pounds} lb`;
  }

  return `${remainingOunces} oz`;
}

function parseWeightToOunces(value) {
  if (value === "" || value === null || value === undefined) return null;

  if (typeof value === "number") {
    return cleanWeightOunces(value);
  }

  const text = String(value).toLowerCase().trim();
  const number = Number(text.match(/[\d.]+/)?.[0]);

  if (!Number.isFinite(number)) return null;

  if (text.includes("kg") || text.includes("kilogram")) {
    return Math.ceil(number * 35.274);
  }

  if (text.includes("gram") || /\bg\b/.test(text)) {
    return Math.ceil(number * 0.035274);
  }

  if (
    text.includes("lb") ||
    text.includes("pound") ||
    text.includes("lbs")
  ) {
    return Math.ceil(number * 16);
  }

  if (text.includes("oz") || text.includes("ounce")) {
    return Math.ceil(number);
  }

  return null;
}

function getPageCountFromText(value) {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : null;
}

function estimateWeightFromMetadata(metadata) {
  const listedWeight = parseWeightToOunces(
    metadata?.weight ||
      metadata?.physical_weight ||
      metadata?.shipping_weight ||
      metadata?.weight_ounces
  );

  if (listedWeight !== null) {
    return {
      weight_ounces: listedWeight,
      note: "Weight came from ISBN metadata.",
    };
  }

  const pageCount =
    Number(metadata?.pageCount || metadata?.number_of_pages) ||
    getPageCountFromText(metadata?.pagination);

  if (!pageCount) {
    return {
      weight_ounces: "",
      note: "",
    };
  }

  const text = `${metadata?.title || ""} ${metadata?.category || ""} ${
    metadata?.format || ""
  } ${metadata?.physical_format || ""} ${
    metadata?.categories?.join(" ") || ""
  }`.toLowerCase();

  let baseOunces = 4;
  let ouncesPerPage = 0.025;

  if (text.includes("hardcover") || text.includes("hardback")) {
    baseOunces = 8;
    ouncesPerPage = 0.03;
  } else if (
    text.includes("workbook") ||
    text.includes("textbook") ||
    text.includes("curriculum")
  ) {
    baseOunces = 5;
    ouncesPerPage = 0.035;
  } else if (text.includes("picture book")) {
    baseOunces = 7;
    ouncesPerPage = 0.025;
  }

  const estimatedWeight = Math.min(
    80,
    Math.max(4, baseOunces + pageCount * ouncesPerPage)
  );

  return {
    weight_ounces: Math.ceil(estimatedWeight),
    note: `Estimated from ${pageCount} pages. Please adjust if needed.`,
  };
}

function getWeightFromBookData(data) {
  return cleanWeightOunces(
    data?.weight_ounces ??
      data?.weightOunces ??
      data?.weight ??
      data?.shipping_weight_ounces
  );
}

async function saveItem() {
  if (!bookData || isSaving) return;

  setIsSaving(true);
  setAnalysisStatus("Checking inventory...");

  try {
  const itemDraft = {
    title: bookData.title || "",
    curriculum: bookData.curriculum || "",
    publisher: bookData.publisher || "",
    subject: bookData.subject || "",
    grade_level: bookData.grade_level || bookData.grade || "",
    edition: bookData.edition || "",
    isbn: bookData.isbn || "",
    category: bookData.category || "",
    location: cleanLocationName(currentLocation),
    suggested_price: bookData.suggested_price || null,
    final_price:
      bookData.final_price === "" ||
      bookData.final_price === null ||
      bookData.final_price === undefined ||
      bookData.final_price === "null"
        ? null
        : Number(bookData.final_price),
    quantity: bookData.quantity ? Number(bookData.quantity) : 1,
    weight_ounces: cleanWeightOunces(bookData.weight_ounces),
    status: bookData.status || "Available",
    notes: bookData.notes || "",
    ai_confidence:
      typeof bookData.confidence === "number" ? bookData.confidence : null,
    public_visible: true,
  };

const { data: possibleMatches, error: searchError } = await supabase
  .from("items")
  .select("*")
  .eq("curriculum", itemDraft.curriculum)
  .eq("category", itemDraft.category);

if (searchError) {
  alert("Could not check for existing item: " + searchError.message);
  return;
}

const existingItems = (possibleMatches || []).filter((item) => {
  const sameTitle =
    normalizeTitle(item.title) === normalizeTitle(itemDraft.title);

 const sameEdition =
  String(item.edition || "").trim().toLowerCase() ===
  String(itemDraft.edition || "").trim().toLowerCase();

  const samePrice =
    Number(item.final_price || 0) === Number(itemDraft.final_price || 0);

const sameGrade =
  String(item.grade_level || "").trim().toLowerCase() ===
  String(itemDraft.grade_level || "").trim().toLowerCase();

  return sameTitle && sameEdition && samePrice && sameGrade;
});


  if (existingItems && existingItems.length > 0) {
    const existingItem = existingItems[0];

    const newQuantity =
      Number(existingItem.quantity || 0) + Number(itemDraft.quantity || 1);

    const duplicateUpdates = {
      quantity: newQuantity,
      updated_at: new Date().toISOString(),
    };

    if (
      (existingItem.weight_ounces === null ||
        existingItem.weight_ounces === undefined) &&
      itemDraft.weight_ounces !== null
    ) {
      duplicateUpdates.weight_ounces = itemDraft.weight_ounces;
    }

    setAnalysisStatus("Updating quantity...");

    const { error: updateError } = await supabase
      .from("items")
      .update(duplicateUpdates)
      .eq("id", existingItem.id);

    if (updateError) {
      alert("Quantity update failed: " + updateError.message);
      return;
    }

if (existingItem.square_variation_id) {
  const squareInventoryResponse = await authFetch(
    "/update-square-inventory",
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

    await logAudit("inventory_quantity_updated", "item", existingItem.id, {
      title: existingItem.title,
      quantity: newQuantity,
    });

    alert("Existing item found. Quantity updated!");
} else {
  setAnalysisStatus("Saving new item...");

  const optionRefreshPromise = Promise.all([
    saveOptionIfNew("curriculum_options", bookData.curriculum),
    saveOptionIfNew("category_options", bookData.category),
  ])
    .then(() => loadOptionLists())
    .catch((error) => {
      console.error("Option refresh failed:", error);
    });

  const uploadCover = async () => {
    if (!coverFile) return "";

    const fileExt = coverFile.type?.split("/")[1] || "jpg";
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from("book-covers")
      .upload(fileName, coverFile, {
        contentType: coverFile.type || "image/jpeg",
      });

    if (uploadError) {
      throw new Error("Image upload failed: " + uploadError.message);
    }

    const { data } = supabase.storage
      .from("book-covers")
      .getPublicUrl(fileName);

    return data.publicUrl;
  };

  const [newSku, imageUrl] = await Promise.all([generateSku(), uploadCover()]);

  void optionRefreshPromise;

  const itemToSave = {
    ...itemDraft,
    sku: newSku,
    image_url: imageUrl || bookData.image_url || "",
  };

  const squareResponse = await authFetch(
    "/create-square-item",
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

  await logAudit("inventory_item_created", "item", itemWithSquareIds.sku, {
    title: itemWithSquareIds.title,
    sku: itemWithSquareIds.sku,
  });

  alert("New item saved!");
}

  setBookData(null);
  setCoverPhoto(null);
  setCoverFile(null);
  setIsbnPhoto(null);

  } catch (error) {
    alert("Save failed: " + error.message);
  } finally {
    setAnalysisStatus("");
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
    isAdmin
      ? `Delete "${editingItem.title}" from inventory? This cannot be undone.`
      : `Remove "${editingItem.title}" from active inventory? This will archive it in Square and keep the record.`
  );

  if (!confirmed) return;

  if (editingItem.square_item_id) {
  const squareResponse = await authFetch(
    "/archive-square-item",
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

  if (isAdmin) {
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

    await logAudit("inventory_item_deleted", "item", editingItem.id, {
      title: editingItem.title,
      square_item_id: editingItem.square_item_id || null,
    });
  } else {
    const { error } = await supabase
      .from("items")
      .update({
        status: "Removed",
        public_visible: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingItem.id);

    if (error) {
      alert("Remove failed: " + error.message);
      return;
    }

    alert("Item marked Removed!");

    await logAudit("inventory_item_removed", "item", editingItem.id, {
      title: editingItem.title,
      square_item_id: editingItem.square_item_id || null,
    });
  }

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
    const squareResponse = await authFetch(
      "/create-square-item",
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
    const squareUpdateResponse = await authFetch(
      "/update-square-item",
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
    const archiveResponse = await authFetch(
      "/archive-square-item",
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
      location: cleanLocationName(editData.location),
      final_price:
        editData.final_price === "" || editData.final_price === null
          ? null
          : Number(editData.final_price),
      quantity: Number(editData.quantity || 0),
      weight_ounces: cleanWeightOunces(editData.weight_ounces),
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

  await logAudit("inventory_item_updated", "item", editingItem.id, {
    title: editData.title || "",
    fields: [
      "title",
      "curriculum",
      "subject",
      "publisher",
      "grade_level",
      "edition",
      "isbn",
      "category",
      "location",
      "final_price",
      "quantity",
      "weight_ounces",
      "status",
      "notes",
      "sku",
      "public_visible",
      "image_url",
    ],
  });

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

const activeLocationNames = getActiveLocationNames();
const labelLocationOptions = buildLocationList([
  ...items.map((item) => item.location),
  ...locationOptions.map((location) => location.name),
]);

const inventoryLocationOptions = labelLocationOptions;
const locationUsageCounts = items.reduce((counts, item) => {
  const normalizedName = normalizeLocationName(item.location);

  if (!normalizedName) return counts;

  counts[normalizedName] = (counts[normalizedName] || 0) + Number(item.quantity || 0);
  return counts;
}, {});
const temporaryLocations = locationOptions.filter(
  (location) => location.temporary === true
);
const permanentLocations = locationOptions.filter(
  (location) => location.temporary !== true
);
const filteredManagedLocations = locationOptions.filter((location) => {
  if (locationListFilter === "temporary") return location.temporary === true;
  if (locationListFilter === "permanent") return location.temporary !== true;
  if (locationListFilter === "active") return location.active !== false;
  if (locationListFilter === "inactive") return location.active === false;
  return true;
});
const selectedTemporaryLocationItemCount = items.filter(
  (item) =>
    selectedItemIds.includes(item.id) &&
    item.location &&
    isTemporaryLocationName(item.location)
).length;
const staleTemporaryItems = items.filter((item) => {
  if (!item.location || !isTemporaryLocationName(item.location)) return false;

  const timestamp = item.updated_at || item.created_at;
  if (!timestamp) return false;

  const ageMs = Date.now() - new Date(timestamp).getTime();
  return ageMs > 14 * 24 * 60 * 60 * 1000;
});

const labelItems = items.filter(
  (item) =>
    item.label_printed !== true &&
    Number(item.quantity || 0) > 0 &&
    locationMatches(item.location, labelLocationFilter) &&
    dateAddedMatches(item, labelDateFrom, labelDateTo)
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

    const matchesLocation = locationMatches(item.location, locationFilter);
    const matchesDateAdded = dateAddedMatches(
      item,
      inventoryDateFrom,
      inventoryDateTo
    );

 return (
  matchesSearch &&
  matchesCurriculum &&
  matchesSubject &&
  matchesCategory &&
  matchesGrade &&
  matchesLocation &&
  matchesDateAdded
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

function renderManagedTextOptionPanel(optionType) {
  const config = getManagedOptionConfig(optionType);

  return (
    <section className="option-panel" key={optionType}>
      <h3>{config.label}</h3>

      <label>Add {config.label}</label>
      <input
        value={optionAddNames[optionType]}
        onChange={(e) =>
          setOptionAddNames((current) => ({
            ...current,
            [optionType]: e.target.value,
          }))
        }
      />

      <button className="primary" onClick={() => addManagedTextOption(optionType)}>
        Add
      </button>

      <label>Rename {config.label}</label>
      <select
        value={optionRenameSelections[optionType]}
        onChange={(e) => {
          setOptionRenameSelections((current) => ({
            ...current,
            [optionType]: e.target.value,
          }));
          setOptionRenameNames((current) => ({
            ...current,
            [optionType]: e.target.value,
          }));
        }}
      >
        <option value="">Choose option</option>
        {config.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <input
        value={optionRenameNames[optionType]}
        onChange={(e) =>
          setOptionRenameNames((current) => ({
            ...current,
            [optionType]: e.target.value,
          }))
        }
      />

      <button className="secondary" onClick={() => renameManagedTextOption(optionType)}>
        Rename
      </button>

      <label>Remove From Dropdown</label>
      <select
        value={optionDeleteSelections[optionType]}
        onChange={(e) =>
          setOptionDeleteSelections((current) => ({
            ...current,
            [optionType]: e.target.value,
          }))
        }
      >
        <option value="">Choose option</option>
        {config.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>

      <button className="secondary" onClick={() => deleteManagedTextOption(optionType)}>
        Remove
      </button>
    </section>
  );
}

function renderPasswordSetupPanel() {
  return (
    <section className="card auth-card">
      <h2>Finish Setting Up Your Account</h2>
      <p>Create a password before using the internal IL HRC tools.</p>

      <form onSubmit={completePasswordSetup}>
        {!passwordSetupSaved && (
          <>
            <label>Create Password</label>
            <input
              type="password"
              value={setupPassword}
              autoComplete="new-password"
              onChange={(e) => setSetupPassword(e.target.value)}
            />

            <label>Confirm Password</label>
            <input
              type="password"
              value={setupConfirmPassword}
              autoComplete="new-password"
              onChange={(e) => setSetupConfirmPassword(e.target.value)}
            />

            <p className="helper-text">
              Use at least {PASSWORD_MIN_LENGTH} characters.
            </p>
          </>
        )}

        {passwordSetupMessage && (
          <p className="status-message">{passwordSetupMessage}</p>
        )}
        {passwordSetupError && (
          <p className="warning-text">{passwordSetupError}</p>
        )}

        <div className="auth-actions">
          <button className="primary" type="submit" disabled={passwordSetupLoading}>
            {passwordSetupLoading
              ? "Saving..."
              : passwordSetupSaved
                ? "Retry Setup"
                : "Finish Setup"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={passwordSetupLoading}
            onClick={handleLogout}
          >
            Log Out
          </button>
        </div>
      </form>
    </section>
  );
}

function renderLoginPanel() {
  return (
    <section className="card auth-card">
      <h2>Staff Sign In</h2>
      <p>Sign in with your IL HRC team account to use intake and inventory tools.</p>

      <form onSubmit={handleLogin}>
        <label>Email</label>
        <input
          type="email"
          value={loginEmail}
          autoComplete="email"
          onChange={(e) => setLoginEmail(e.target.value)}
        />

        <label>Password</label>
        <input
          type="password"
          value={loginPassword}
          autoComplete="current-password"
          onChange={(e) => setLoginPassword(e.target.value)}
        />

        {authMessage && <p className="warning-text">{authMessage}</p>}

        <button className="primary" type="submit" disabled={loginLoading}>
          {loginLoading ? "Signing In..." : "Sign In"}
        </button>
      </form>
    </section>
  );
}

function renderChangePasswordPanel() {
  if (!changePasswordOpen) return null;

  return (
    <section className="card auth-card">
      <h2>Change Password</h2>

      <form onSubmit={submitPasswordChange}>
        <label>New Password</label>
        <input
          type="password"
          value={changePassword}
          autoComplete="new-password"
          onChange={(e) => setChangePassword(e.target.value)}
        />

        <label>Confirm Password</label>
        <input
          type="password"
          value={changeConfirmPassword}
          autoComplete="new-password"
          onChange={(e) => setChangeConfirmPassword(e.target.value)}
        />

        <p className="helper-text">
          Use at least {PASSWORD_MIN_LENGTH} characters.
        </p>

        {changePasswordMessage && (
          <p className="status-message">{changePasswordMessage}</p>
        )}
        {changePasswordError && (
          <p className="warning-text">{changePasswordError}</p>
        )}

        <div className="auth-actions">
          <button
            className="primary"
            type="submit"
            disabled={changePasswordLoading}
          >
            {changePasswordLoading ? "Saving..." : "Save Password"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={changePasswordLoading}
            onClick={() => {
              setChangePasswordOpen(false);
              setChangePassword("");
              setChangeConfirmPassword("");
              setChangePasswordError("");
              setChangePasswordMessage("");
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}

function renderUserManagement() {
  return (
    <section className="card">
      <h2>Team Management</h2>

      {userManagementMessage && (
        <p className="status-message">{userManagementMessage}</p>
      )}

      <form className="user-invite-form" onSubmit={inviteUser}>
        <label>Name</label>
        <input
          value={inviteForm.full_name}
          onChange={(e) =>
            setInviteForm((current) => ({
              ...current,
              full_name: e.target.value,
            }))
          }
          placeholder="Team member name"
        />

        <label>Email</label>
        <input
          type="email"
          value={inviteForm.email}
          onChange={(e) =>
            setInviteForm((current) => ({
              ...current,
              email: e.target.value,
            }))
          }
          placeholder="team@example.org"
          required
        />

        <label>Role</label>
        <select
          value={inviteForm.role}
          onChange={(e) =>
            setInviteForm((current) => ({
              ...current,
              role: e.target.value,
            }))
          }
        >
          <option value="team">Team</option>
          <option value="admin">Admin</option>
        </select>

        <button className="primary" type="submit">
          Send Invitation
        </button>
      </form>

      <div className="user-list">
        {users.map((user) => (
          <div className="user-row" key={user.id}>
            <div>
              <strong>{user.full_name || user.email}</strong>
              <p>
                {user.email} / {user.role} / {user.is_active ? "Active" : "Inactive"}
              </p>
              <p>Created {formatDateAdded(user.created_at)}</p>
            </div>

            <div className="user-actions">
              <select
                value={user.role}
                onChange={(e) =>
                  updateUserProfile(user, { role: e.target.value })
                }
              >
                <option value="team">Team</option>
                <option value="admin">Admin</option>
              </select>

              {user.is_active ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => updateUserProfile(user, { is_active: false })}
                >
                  Deactivate
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => updateUserProfile(user, { is_active: true })}
                >
                  Reactivate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <section className="options-section">
        <h3>Recent Security Activity</h3>
        {auditLogs.length === 0 && <p>No audit activity yet.</p>}
        {auditLogs.map((entry) => (
          <div className="audit-row" key={entry.id}>
            <strong>{entry.action}</strong>
            <p>
              {entry.entity_type} {entry.entity_id || ""} /{" "}
              {formatDateAdded(entry.created_at)}
            </p>
          </div>
        ))}
      </section>
    </section>
  );
}

  return (
    <main className="app">
      <h1>IL HRC Book Intake</h1>

      {authLoading && (
        <section className="card">
          <p>Checking account access...</p>
        </section>
      )}

      {!authLoading && (
        <div className="account-bar">
          {isAuthenticated ? (
            <>
              <span>
                {profile?.full_name || profile?.email || "Signed in"} /{" "}
                {profile?.role || "profile loading"}
              </span>
              <div className="account-actions">
                {!shouldShowPasswordSetup && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => {
                      setChangePasswordOpen((current) => !current);
                      setChangePasswordError("");
                      setChangePasswordMessage("");
                    }}
                  >
                    Change Password
                  </button>
                )}
                <button className="secondary" type="button" onClick={handleLogout}>
                  Log Out
                </button>
              </div>
            </>
          ) : session ? (
            <>
              <span>Account access not verified</span>
              <button className="secondary" type="button" onClick={handleLogout}>
                Log Out
              </button>
            </>
          ) : (
            <>
              <span>Public catalog access</span>
              <button
                className="secondary"
                type="button"
                onClick={() => setAuthMessage("")}
              >
                Staff Sign In
              </button>
            </>
          )}
        </div>
      )}

      {!authLoading && shouldShowPasswordSetup && renderPasswordSetupPanel()}

      {!authLoading && !shouldShowPasswordSetup && profileLoading && (
        <section className="card">
          <p>Loading account profile...</p>
        </section>
      )}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        !profileLoading &&
        !isAuthenticated &&
        renderLoginPanel()}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        isAuthenticated &&
        renderChangePasswordPanel()}

{!authLoading && !shouldShowPasswordSetup && isAuthenticated && (
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
  className={view === "options" ? "primary" : "secondary"}
  onClick={() => {
    setView("options");
    cancelEditing();
    loadItems();
    loadOptionLists();
  }}
>
  Options
</button>

        {isAdmin && (
          <button
            className={view === "users" ? "primary" : "secondary"}
            onClick={() => {
              setView("users");
              cancelEditing();
            }}
          >
            Team Management
          </button>
        )}

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

      {!authLoading && authMessage && isAuthenticated && (
        <p className="warning-text">{authMessage}</p>
      )}

   {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "add" && (
  <>
    <p>Use the cover photo and ISBN/barcode when available.</p>

    <div className="location-box">
      <label>Current Location</label>
      <select
        value={currentLocation}
        onChange={(e) => setCurrentLocation(e.target.value)}
      >
        <option value="">Choose location</option>
        {activeLocationNames.map((location) => (
          <option key={location} value={location}>
            {location}
          </option>
        ))}
      </select>
      <p className="helper-text">
        Manage locations from Options. This selection is saved with each book until you change it.
      </p>
    </div>


    <div className="intake-actions">
      <button className="secondary" onClick={scanIsbnBarcode}>
        {isScanningBarcode ? "Scanning..." : "Scan ISBN Barcode"}
      </button>

      <label htmlFor="cover-upload" className="secondary file-upload-button">
        Analyze Book Cover
      </label>

      <button className="secondary" onClick={startManualEntry}>
        Manual Entry
      </button>
    </div>

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

              <label>Weight</label>
              <div className="weight-inputs">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="lb"
                  value={getWeightPounds(bookData.weight_ounces)}
                  onChange={(e) =>
                    setBookData({
                      ...bookData,
                      weight_ounces: combineWeightPoundsOunces(
                        e.target.value,
                        getWeightRemainingOunces(bookData.weight_ounces)
                      ),
                    })
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="oz"
                  value={getWeightRemainingOunces(bookData.weight_ounces)}
                  onChange={(e) =>
                    setBookData({
                      ...bookData,
                      weight_ounces: combineWeightPoundsOunces(
                        getWeightPounds(bookData.weight_ounces),
                        e.target.value
                      ),
                    })
                  }
                />
              </div>
              <p className="helper-text">
                Optional shipping weight. AI may estimate this when it can.
              </p>
              {bookData.weight_note && (
                <p className="helper-text">{bookData.weight_note}</p>
              )}

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

              {bookData.confidence && (
                <p>
                  <strong>AI Confidence:</strong> {bookData.confidence}
                </p>
              )}

              <button className="primary" onClick={saveItem} disabled={isSaving}>
  {isSaving ? "Saving..." : "Save Item"}
</button>
            </section>
          )}
        </>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "inventory" && (
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

              <label>Location</label>
              <select
                value={editData.location || ""}
                onChange={(e) =>
                  setEditData({ ...editData, location: e.target.value })
                }
              >
                <option value="">No location</option>
                {getActiveLocationNames([editData.location]).map((location) => (
                  <option key={location} value={location}>
                    {location}
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

              <label>Weight</label>
              <div className="weight-inputs">
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="lb"
                  value={getWeightPounds(editData.weight_ounces)}
                  onChange={(e) =>
                    setEditData({
                      ...editData,
                      weight_ounces: combineWeightPoundsOunces(
                        e.target.value,
                        getWeightRemainingOunces(editData.weight_ounces)
                      ),
                    })
                  }
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="oz"
                  value={getWeightRemainingOunces(editData.weight_ounces)}
                  onChange={(e) =>
                    setEditData({
                      ...editData,
                      weight_ounces: combineWeightPoundsOunces(
                        getWeightPounds(editData.weight_ounces),
                        e.target.value
                      ),
                    })
                  }
                />
              </div>

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
              {isAdmin ? "Delete Item" : "Remove Item"}
            </button>
            </section>
          )}

          <div className="inventory-layout">
            <section className="inventory-main">
              <div className="inventory-results-header">
                <p>{filteredItems.length} matching item(s)</p>
              </div>

          {filteredItems.length === 0 && <p>No matching items found.</p>}

          <div className={`inventory-grid ${isSelectionMode ? "selection-mode" : ""}`}>
          {filteredItems.map((item) => (
            <div className="inventory-item" key={item.id}>
              {isSelectionMode && (
                <label className="item-select">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={() => toggleSelectedItem(item.id)}
                  />
                  Select
                </label>
              )}
              <BookCoverImage src={item.image_url} alt={item.title} />

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
                {item.weight_ounces !== null && item.weight_ounces !== undefined && (
                  <p><strong>Weight:</strong> {formatWeight(item.weight_ounces)}</p>
                )}
                <p>Status: {item.status}</p>
                  <p><strong>Added:</strong> {formatDateAdded(item.created_at)}</p>
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
          </div>
            </section>

            <aside className="inventory-sidebar">
              <h3>Filters</h3>

              <label>Curriculum</label>
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

              <label>Subject</label>
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

              <label>Category</label>
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

              <label>Grade</label>
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

              <label>Location</label>
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

              <label>Added From</label>
              <input
                type="date"
                value={inventoryDateFrom}
                onChange={(e) => setInventoryDateFrom(e.target.value)}
              />

              <label>Added To</label>
              <input
                type="date"
                value={inventoryDateTo}
                onChange={(e) => setInventoryDateTo(e.target.value)}
              />

              {(searchTerm ||
                curriculumFilter ||
                subjectFilter ||
                categoryFilter ||
                gradeFilter ||
                locationFilter ||
                inventoryDateFrom ||
                inventoryDateTo) && (
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
                    setInventoryDateFrom("");
                    setInventoryDateTo("");
                  }}
                >
                  Reset Filters
                </button>
              )}

              <div className="selection-panel">
                <button
                  type="button"
                  className={isSelectionMode ? "primary" : "secondary"}
                  onClick={() => {
                    setIsSelectionMode((current) => {
                      if (current) {
                        setSelectedItemIds([]);
                      }
                      return !current;
                    });
                  }}
                >
                  {isSelectionMode ? "Exit Selection" : "Select Items"}
                </button>

                {isSelectionMode && (
                  <>
                    <div className="selection-toolbar">
                      <span>
                        <strong>{selectedItemIds.length}</strong> selected
                      </span>

                      <button
                        type="button"
                        className="text-button"
                        onClick={() =>
                          setSelectedItemIds(filteredItems.map((item) => item.id))
                        }
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
                            className="secondary"
                            disabled={selectedTemporaryLocationItemCount === 0}
                            onClick={(e) => {
                              e.preventDefault();
                              clearTemporaryLocationsFromSelected();
                            }}
                          >
                            Clear Temporary Locations
                          </button>

                          <button
                            type="button"
                            className="bulk-delete-btn"
                            onClick={(e) => {
                              e.preventDefault();
                              bulkDeleteSelected();
                            }}
                          >
                            {isAdmin ? "Delete" : "Remove"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "options" && (
        <section className="card">
          <h2>Options</h2>

          <section className="options-section">
            <h3>Inventory Lists</h3>
            <div className="options-grid">
              {renderManagedTextOptionPanel("curriculum")}
              {renderManagedTextOptionPanel("subject")}
              {renderManagedTextOptionPanel("grade")}
            </div>
          </section>

          <section className="options-section">
            <h3>Categories & Pricing</h3>
            <div className="options-grid">
              <section className="option-panel">
                <h3>Add Category</h3>
                <label>Category Name</label>
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Example: Workbook"
                />

                <label>Default Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={newCategoryPrice}
                  onChange={(e) => setNewCategoryPrice(e.target.value)}
                  placeholder="0.00"
                />

                <button className="primary" onClick={addCategoryOption}>
                  Add Category
                </button>
              </section>

              <section className="option-panel">
                <h3>Edit Category</h3>
                <label>Category</label>
                <select
                  value={editCategoryName}
                  onChange={(e) => {
                    const category = categoryOptions.find(
                      (item) => item.name === e.target.value
                    );
                    setEditCategoryName(e.target.value);
                    setEditCategoryNewName(category?.name || "");
                    setEditCategoryPrice(category?.default_price ?? "");
                  }}
                >
                  <option value="">Choose category</option>
                  {categoryOptions.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <label>Name</label>
                <input
                  value={editCategoryNewName}
                  onChange={(e) => setEditCategoryNewName(e.target.value)}
                />

                <label>Default Price</label>
                <input
                  type="number"
                  step="0.01"
                  value={editCategoryPrice}
                  onChange={(e) => setEditCategoryPrice(e.target.value)}
                />

                <button className="primary" onClick={updateCategoryOption}>
                  Save Category
                </button>
              </section>

              <section className="option-panel">
                <h3>Remove Category</h3>
                <label>Category</label>
                <select
                  value={deleteCategoryName}
                  onChange={(e) => setDeleteCategoryName(e.target.value)}
                >
                  <option value="">Choose category</option>
                  {categoryOptions.map((category) => (
                    <option key={category.name} value={category.name}>
                      {category.name}
                    </option>
                  ))}
                </select>

                <button className="secondary" onClick={deleteCategoryOption}>
                  Remove
                </button>
              </section>
            </div>
          </section>

          <section className="options-section">
            <h3>Locations</h3>

          <div className="options-grid">
            <section className="option-panel">
              <h3>Add Location</h3>
              <label>Location Name</label>
              <input
                value={newLocationName}
                onChange={(e) => setNewLocationName(e.target.value)}
                placeholder="Example: Cart 2"
              />

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newLocationTemporary}
                  onChange={(e) => setNewLocationTemporary(e.target.checked)}
                />
                Temporary location
              </label>

              <button className="primary" onClick={handleAddLocation}>
                Add Location
              </button>

              <button className="secondary" onClick={seedTemporaryLocations}>
                Add Box 1-4
              </button>
            </section>

            <section className="option-panel">
              <h3>Rename Location</h3>
              <label>Location</label>
              <select
                value={renameLocationId}
                onChange={(e) => {
                  const location = getLocationOptionById(e.target.value);
                  setRenameLocationId(e.target.value);
                  setRenameLocationName(location?.name || "");
                }}
              >
                <option value="">Choose location</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>

              <label>New Name</label>
              <input
                value={renameLocationName}
                onChange={(e) => setRenameLocationName(e.target.value)}
              />

              <button className="primary" onClick={renameLocation}>
                Rename
              </button>
            </section>

            <section className="option-panel">
              <h3>Deactivate Location</h3>
              <label>Location</label>
              <select
                value={deactivateLocationId}
                onChange={(e) => setDeactivateLocationId(e.target.value)}
              >
                <option value="">Choose location</option>
                {locationOptions
                  .filter((location) => location.active !== false)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>

              <button className="secondary" onClick={deactivateLocation}>
                Deactivate
              </button>
            </section>

            <section className="option-panel">
              <h3>Merge Locations</h3>
              <label>Move Items From</label>
              <select
                value={mergeFromLocationId}
                onChange={(e) => setMergeFromLocationId(e.target.value)}
              >
                <option value="">Choose source</option>
                {locationOptions.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>

              <label>Into</label>
              <select
                value={mergeToLocationId}
                onChange={(e) => setMergeToLocationId(e.target.value)}
              >
                <option value="">Choose target</option>
                {locationOptions
                  .filter((location) => location.active !== false)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
              </select>

              <button className="primary" onClick={mergeLocations}>
                Merge
              </button>
            </section>
          </div>

          <section className="location-list">
            <h3>Managed Locations</h3>

            {locationOptions.length === 0 && (
              <p>No managed locations yet. Add locations or run the Supabase backfill SQL.</p>
            )}

            {staleTemporaryItems.length > 0 && (
              <p className="warning-text">
                {staleTemporaryItems.length} item(s) have been in temporary locations for more than 14 days.
              </p>
            )}

            <div className="location-tools">
              <select
                value={locationListFilter}
                onChange={(e) => setLocationListFilter(e.target.value)}
              >
                <option value="all">All locations</option>
                <option value="temporary">Temporary only</option>
                <option value="permanent">Permanent only</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>

              <button
                type="button"
                className="secondary"
                onClick={deactivateEmptyTemporaryLocations}
              >
                Deactivate Empty Temporary
              </button>
            </div>

            <div className="location-summary-grid">
              <div className="location-summary">
                <strong>Temporary</strong>
                <p>{temporaryLocations.length} locations</p>
              </div>
              <div className="location-summary">
                <strong>Permanent</strong>
                <p>{permanentLocations.length} locations</p>
              </div>
            </div>

            {filteredManagedLocations.map((location) => (
              <div className="location-row" key={location.id}>
                <div>
                  <strong>{location.name}</strong>
                  <p>
                    {location.active === false ? "Inactive" : "Active"}
                    {location.temporary ? " / Temporary" : ""}
                    {" / "}
                    {locationUsageCounts[normalizeLocationName(location.name)] || 0} copies
                  </p>
                </div>

                <button
                  type="button"
                  className="secondary"
                  onClick={() => toggleLocationTemporary(location)}
                >
                  {location.temporary ? "Unmark Temporary" : "Mark Temporary"}
                </button>
              </div>
            ))}
          </section>
          </section>
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "labels" && (
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

<div className="catalog-filters">
  <label className="date-filter-label">
    Added From
    <input
      type="date"
      value={labelDateFrom}
      onChange={(e) => setLabelDateFrom(e.target.value)}
    />
  </label>

  <label className="date-filter-label">
    Added To
    <input
      type="date"
      value={labelDateTo}
      onChange={(e) => setLabelDateTo(e.target.value)}
    />
  </label>

  {(labelLocationFilter || labelDateFrom || labelDateTo) && (
    <button
      type="button"
      className="filter-reset"
      onClick={() => {
        setLabelLocationFilter("");
        setLabelDateFrom("");
        setLabelDateTo("");
      }}
    >
      Reset Label Filters
    </button>
  )}
</div>

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
              <BookCoverImage src={item.image_url} alt={item.title} />

              <div>
                <h3>{item.title}</h3>
                <p><strong>SKU:</strong> {item.sku}</p>
                <p><strong>Price:</strong> ${item.final_price}</p>
                <p><strong>Quantity:</strong> {item.quantity}</p>
                <p><strong>Category:</strong> {item.category}</p>
                <p><strong>Added:</strong> {formatDateAdded(item.created_at)}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAdmin && view === "users" && renderUserManagement()}

      {!authLoading && !shouldShowPasswordSetup && view === "catalog" && (
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

    <BookCoverImage
      src={selectedCatalogItem.image_url}
      alt={selectedCatalogItem.title}
      className="catalog-detail-image"
      width={520}
      height={700}
      eager
    />

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

<div className="catalog-layout">
  <section className="catalog-main">
    <input
      placeholder="Search title, curriculum, subject, grade..."
      value={searchTerm}
      onChange={(e) => setSearchTerm(e.target.value)}
    />

    <div className="catalog-results-header">
      <p>{filteredCatalogItems.length} matching item(s)</p>
    </div>

    <div className="catalog-grid">
 {filteredCatalogItems.map((item) => (
        <div className="catalog-item" key={item.id}>
          <BookCoverImage src={item.image_url} alt={item.title} />

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
    </div>

    {filteredCatalogItems.length === 0 && <p>No matching catalog items found.</p>}
  </section>

  <aside className="catalog-sidebar">
    <h3>Filters</h3>

    <label>Curriculum</label>
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

    <label>Subject</label>
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

    <label>Category</label>
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

    <label>Grade</label>
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
  </aside>
</div>
    </>
)}
  </section>
)}
    </main>
  );
}
