import { useRef, useState, useEffect } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import "./App.css";
import { supabase } from "./supabaseClient";
import jsPDF from "jspdf";
import JsBarcode from "jsbarcode";
import {
  RULE_INPUT_FIELDS,
  RULE_OUTPUT_FIELDS,
  applyIntakeRules,
  mergeExactIsbnMemory,
} from "./intakeRules";
import { findIsbnInconsistencies, generateRuleSuggestions } from "./ruleSuggestions";
import CurriculumCatalog from "./CurriculumCatalog";
import {
  identifyBookBarcode,
  inferPublisherItemNumber,
  normalizePublisher,
  normalizePublisherItemNumber,
} from "./barcodeIdentification";
import {
  buildDuplicateLabelQueueUpdate,
  getQueuedLabelQuantity,
} from "./labelQueue";
import {
  EMPTY_BUNDLE_DRAFT,
  buildBundleContentsNote,
  getBundleComponentQuantity,
  getBundleComponentRows,
  getBundleIndividualValue,
  getBundlePieceCount,
} from "./bundleInventory";

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
  "item_type",
  "bundle_piece_count",
  "bundle_contents",
].join(",");

const INTERNAL_VIEWS = new Set(["add", "inventory", "labels", "options", "requests", "users"]);
const PASSWORD_MIN_LENGTH = 10;
const INTAKE_LEARNING_FIELDS = [
  "title",
  "author",
  "publisher",
  "curriculum",
  "subject",
  "grade_level",
  "category",
  "isbn",
  "final_price",
];
const EMPTY_INTAKE_RULE = {
  name: "",
  description: "",
  match_mode: "all",
  priority: 0,
  active: true,
  conditions: [{ field: "curriculum", operator: "contains", value: "" }],
  actions: { curriculum: "", subject: "", grade_level: "", category: "", final_price: "" },
};
const EMPTY_CUSTOMER_REQUEST = {
  customer_name: "", email: "", phone: "", preferred_contact: "email",
  isbn: "", title: "", author: "", curriculum: "", subject: "", grade_level: "", notes: "",
};
const EMPTY_BOOK_RESERVATION = {
  customer_name: "",
  email: "",
  phone: "",
  preferred_contact: "email",
  website: "",
};
const BUNDLE_DRAFT_STORAGE_KEY = "ilhrc-active-bundle-draft";

function loadSavedBundleDraft() {
  try {
    const saved = JSON.parse(localStorage.getItem(BUNDLE_DRAFT_STORAGE_KEY) || "null");
    return saved?.active
      ? { ...EMPTY_BUNDLE_DRAFT, ...saved, components: saved.components || [] }
      : { ...EMPTY_BUNDLE_DRAFT };
  } catch {
    return { ...EMPTY_BUNDLE_DRAFT };
  }
}

function StaffNavIcon({ name }) {
  const paths = {
    add: (
      <>
        <path d="M12 5v14M5 12h14" />
        <circle cx="12" cy="12" r="9" />
      </>
    ),
    inventory: (
      <>
        <path d="m4 7 8-4 8 4-8 4-8-4Z" />
        <path d="m4 7 8 4 8-4v10l-8 4-8-4V7Z" />
        <path d="M12 11v10" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M3.5 19c.4-3.5 2.2-5.5 5.5-5.5s5.1 2 5.5 5.5M14 14.3c.8-.5 1.7-.8 2.8-.8 2.7 0 4.2 1.8 4.5 4.8" />
      </>
    ),
    lists: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </>
    ),
    requests: (
      <>
        <path d="M5 4h14v16H5z" />
        <path d="M8 8h8M8 12h5M8 16h3" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m16 16 5 5" />
      </>
    ),
    filters: (
      <>
        <path d="M4 6h16M7 12h10M10 18h4" />
      </>
    ),
  };

  return (
    <svg className="staff-mobile-nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

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

function canvasToJpegFile(canvas, file, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("The browser could not prepare this photo."));
          return;
        }

        const cleanName = file.name.replace(/\.[^.]+$/, "") || "book-cover";
        resolve(new File([blob], `${cleanName}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      quality
    );
  });
}

function drawImageToJpegFile(image, file, maxSize, quality) {
  const width = image.width || image.naturalWidth;
  const height = image.height || image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement("canvas");

  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("The browser could not prepare this photo.");

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvasToJpegFile(canvas, file, quality);
}

async function shrinkImageFile(
  file,
  maxSize = 1400,
  quality = 0.82,
  { requireReadableImage = false } = {}
) {
  if (!file?.type?.startsWith("image/")) return file;

  const browserReadyTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (browserReadyTypes.has(file.type.toLowerCase()) && file.size < 900_000) {
    return file;
  }

  if (typeof createImageBitmap === "function") {
    let bitmap;

    try {
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
        resizeWidth: maxSize,
        resizeQuality: "high",
      });

      return await drawImageToJpegFile(bitmap, file, maxSize, quality);
    } catch (error) {
      console.warn("Low-memory image preparation failed; trying compatibility mode.", error);
    } finally {
      bitmap?.close?.();
    }
  }

  const imageUrl = URL.createObjectURL(file);
  const image = new Image();

  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imageUrl;
    });

    return await drawImageToJpegFile(image, file, maxSize, quality);
  } catch (error) {
    if (requireReadableImage) {
      throw new Error(
        "This camera photo could not be read. Try turning off High efficiency pictures in Camera settings, or upload a screenshot of the photo.",
        { cause: error }
      );
    }

    console.warn("Image preparation failed; using the original file.", error);
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
  const originalSrc = src ? String(src).replace(/^http:\/\//i, "https://") : "";
  const optimizedSrc = getOptimizedImageUrl(src, width, height);

  if (!src) return null;

  return (
    <img
      src={optimizedSrc}
      alt={alt || "Book cover"}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "low"}
      onError={(event) => {
        if (event.currentTarget.src !== originalSrc) {
          event.currentTarget.src = originalSrc;
        }
      }}
    />
  );
}

export default function App() {
  const [view, setView] = useState(() => {
    const hashView = window.location.hash.replace("#", "");
    if (hashView === "curricula") return "curricula";
    return hashView === "catalog" ? "catalog" : "add";
  });
  const [items, setItems] = useState([]);
  const [bundleComponents, setBundleComponents] = useState([]);
  const [bundleDraft, setBundleDraft] = useState(loadSavedBundleDraft);
  const [bundleReviewOpen, setBundleReviewOpen] = useState(false);
  const [bundleActionLoading, setBundleActionLoading] = useState(false);
  const [bundleCoverFile, setBundleCoverFile] = useState(null);
  const [bundleCoverPreview, setBundleCoverPreview] = useState("");
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
  const [staffSignInOpen, setStaffSignInOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [forgotPasswordLoading, setForgotPasswordLoading] = useState(false);
  const [forgotPasswordMessage, setForgotPasswordMessage] = useState("");
  const [forgotPasswordError, setForgotPasswordError] = useState("");
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(
    () => getAuthUrlType() === "recovery"
  );
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoveryPasswordLoading, setRecoveryPasswordLoading] = useState(false);
  const [recoveryPasswordError, setRecoveryPasswordError] = useState("");
  const [users, setUsers] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [optionsSection, setOptionsSection] = useState("lists");
  const [userManagementMessage, setUserManagementMessage] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
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
  const [inventorySortBy, setInventorySortBy] = useState("newest");
  const [inventoryToolsPanel, setInventoryToolsPanel] = useState("");
  const [catalogToolsPanel, setCatalogToolsPanel] = useState("");
  const [isScanningBarcode, setIsScanningBarcode] = useState(false);

  const listingPhotoInputRef = useRef(null);
  const handledCoverFilesRef = useRef(new WeakSet());
  const inventoryEditorRef = useRef(null);
  const inventoryEditorTitleRef = useRef(null);
  const inventorySearchInputRef = useRef(null);
  const catalogSearchInputRef = useRef(null);
  const reservationPanelRef = useRef(null);
  const intakeRuleEditorRef = useRef(null);
  const intakeRuleNameRef = useRef(null);
  const isbnMergePanelRef = useRef(null);
  const isbnMergeKeeperRef = useRef(null);

  const [isSaving, setIsSaving] = useState(false);

  const editPhotoInputRef = useRef(null);
  const [editCoverFile, setEditCoverFile] = useState(null);
  const [editCoverPreview, setEditCoverPreview] = useState(null);

  const [analysisStatus, setAnalysisStatus] = useState("");
  const [intakeRules, setIntakeRules] = useState([]);
  const [ruleSources, setRuleSources] = useState({});
  const [ruleConflicts, setRuleConflicts] = useState({});
  const [intakeContext, setIntakeContext] = useState(null);
  const [intakeRuleDraft, setIntakeRuleDraft] = useState(EMPTY_INTAKE_RULE);
  const [editingIntakeRuleId, setEditingIntakeRuleId] = useState(null);
  const [intakeRuleMessage, setIntakeRuleMessage] = useState("");
  const [intakeHistories, setIntakeHistories] = useState([]);
  const [suggestionReviews, setSuggestionReviews] = useState([]);
  const [isbnInconsistencyReviews, setIsbnInconsistencyReviews] = useState([]);
  const [reviewingSuggestionKey, setReviewingSuggestionKey] = useState(null);
  const [isbnMergeIssue, setIsbnMergeIssue] = useState(null);
  const [isbnMergeKeeperId, setIsbnMergeKeeperId] = useState("");
  const [isbnMergeDraft, setIsbnMergeDraft] = useState(null);
  const [isbnMergePrintLabels, setIsbnMergePrintLabels] = useState(true);
  const [isbnMergeLoading, setIsbnMergeLoading] = useState(false);
  const [isbnMergeMessage, setIsbnMergeMessage] = useState("");
  const [expandedIsbnReview, setExpandedIsbnReview] = useState("");

  const [curriculumOptions, setCurriculumOptions] = useState([]);
  const [subjectOptions, setSubjectOptions] = useState([]);
  const [gradeOptions, setGradeOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);

  const [selectedItemIds, setSelectedItemIds] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const [bulkCurriculum, setBulkCurriculum] = useState("");
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkGrade, setBulkGrade] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");

  const [bulkPublicVisible, setBulkPublicVisible] = useState("");

  const [labelDateFrom, setLabelDateFrom] = useState("");
  const [labelDateTo, setLabelDateTo] = useState("");

  const [inventoryDateFrom, setInventoryDateFrom] = useState("");
  const [inventoryDateTo, setInventoryDateTo] = useState("");
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
  const [customerRequests, setCustomerRequests] = useState([]);
  const [customerRequestMatches, setCustomerRequestMatches] = useState([]);
  const [customerRequestDraft, setCustomerRequestDraft] = useState(EMPTY_CUSTOMER_REQUEST);
  const [customerRequestFilter, setCustomerRequestFilter] = useState("active");
  const [customerRequestMessage, setCustomerRequestMessage] = useState("");
  const [customerRequestLoading, setCustomerRequestLoading] = useState(false);
  const [expandedCustomerMatchId, setExpandedCustomerMatchId] = useState("");
  const [publicRequestOpen, setPublicRequestOpen] = useState(false);
  const [publicRequestDraft, setPublicRequestDraft] = useState({ ...EMPTY_CUSTOMER_REQUEST, website: "" });
  const [publicRequestMessage, setPublicRequestMessage] = useState("");
  const [publicRequestSubmitting, setPublicRequestSubmitting] = useState(false);
  const [bookReservations, setBookReservations] = useState([]);
  const [reservationFilter, setReservationFilter] = useState("active");
  const [reservationItem, setReservationItem] = useState(null);
  const [reservationDraft, setReservationDraft] = useState(EMPTY_BOOK_RESERVATION);
  const [reservationMessage, setReservationMessage] = useState("");
  const [reservationResult, setReservationResult] = useState(null);
  const [reservationSubmitting, setReservationSubmitting] = useState(false);

  const isAuthenticated = Boolean(session && profile && profile.is_active !== false);
  const isAdmin = profile?.role === "admin";
  const isInternalView = INTERNAL_VIEWS.has(view);
  const shouldShowPasswordSetup = Boolean(session && passwordSetupRequired);
  const shouldShowPasswordRecovery = Boolean(session && passwordRecoveryMode);
  const showStaffShell =
    isAuthenticated && !shouldShowPasswordSetup && !shouldShowPasswordRecovery;

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
      async (event, nextSession) => {
        if (event === "PASSWORD_RECOVERY") {
          setPasswordRecoveryMode(true);
          setRecoveryPasswordError("");
        }

        setSession(nextSession);
        setPasswordSetupRequired(sessionRequiresPasswordSetup(nextSession));

        if (nextSession) {
          await refreshProfile(nextSession);
        } else {
          setProfile(null);
          setProfileLoading(false);
          setPasswordSetupRequired(false);
          setPasswordSetupSaved(false);
          if (event !== "PASSWORD_RECOVERY") setPasswordRecoveryMode(false);
          setStaffSignInOpen(false);
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
    if (passwordRecoveryMode) return;
    window.location.hash = view === "catalog" || view === "curricula" ? view : "";
  }, [passwordRecoveryMode, view]);

  useEffect(() => {
    if (bundleDraft.active) {
      localStorage.setItem(BUNDLE_DRAFT_STORAGE_KEY, JSON.stringify(bundleDraft));
    } else {
      localStorage.removeItem(BUNDLE_DRAFT_STORAGE_KEY);
    }
  }, [bundleDraft]);

  useEffect(() => {
    if (inventoryToolsPanel === "search") {
      inventorySearchInputRef.current?.focus();
    }
  }, [inventoryToolsPanel]);

  useEffect(() => {
    if (catalogToolsPanel === "search") {
      catalogSearchInputRef.current?.focus();
    }
  }, [catalogToolsPanel]);

  useEffect(() => {
    if (reservationItem) {
      reservationPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [reservationItem]);

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
    if (isAuthenticated) {
      loadIntakeRules();
      loadCustomerRequestData();
    }
  }, [authLoading, shouldShowPasswordSetup, isAuthenticated]);

  useEffect(() => {
    if (view === "users" && isAdmin) {
      loadUsers();
      loadAuditLogs();
    }
  }, [view, isAdmin]);

  useEffect(() => {
    if (view === "options" && isAdmin) loadRuleSuggestionData();
  }, [view, isAdmin]);

  useEffect(() => {
    if (view === "requests" && isAuthenticated) loadCustomerRequestData();
  }, [view, isAuthenticated]);

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
    setStaffSignInOpen(false);
    setView("add");
  }

  async function requestPasswordReset(event) {
    event.preventDefault();
    if (forgotPasswordLoading) return;

    const email = loginEmail.trim();
    if (!email || !email.includes("@")) {
      setForgotPasswordError("Enter the account email address first.");
      return;
    }

    setForgotPasswordLoading(true);
    setForgotPasswordMessage("");
    setForgotPasswordError("");

    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    setForgotPasswordLoading(false);

    if (error) {
      const message = String(error.message || "").toLowerCase();
      setForgotPasswordError(
        error.status === 429 || message.includes("rate limit")
          ? "Too many recovery emails were requested. Please wait before trying again."
          : "Could not send the recovery email. Please contact an Admin."
      );
      return;
    }

    setForgotPasswordMessage(
      "If an account exists for that email, a password reset link has been sent."
    );
  }

  async function completePasswordRecovery(event) {
    event.preventDefault();
    if (recoveryPasswordLoading) return;

    setRecoveryPasswordError("");
    const validationError = validatePasswordPair(
      recoveryPassword,
      recoveryConfirmPassword
    );

    if (validationError) {
      setRecoveryPasswordError(validationError);
      return;
    }

    setRecoveryPasswordLoading(true);
    const { error } = await supabase.auth.updateUser({
      password: recoveryPassword,
    });

    if (error) {
      setRecoveryPasswordLoading(false);
      setRecoveryPasswordError(error.message || "Could not reset password.");
      return;
    }

    await supabase.auth.signOut();
    window.history.replaceState({}, document.title, window.location.pathname);
    setRecoveryPassword("");
    setRecoveryConfirmPassword("");
    setRecoveryPasswordLoading(false);
    setPasswordRecoveryMode(false);
    setSession(null);
    setProfile(null);
    setLoginPassword("");
    setStaffSignInOpen(true);
    setAuthMessage("Password reset. Sign in with your new password.");
    setView("catalog");
  }

  async function handleLogout() {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setPasswordSetupRequired(false);
    setPasswordSetupSaved(false);
    setSetupPassword("");
    setSetupConfirmPassword("");
    setPasswordRecoveryMode(false);
    setRecoveryPassword("");
    setRecoveryConfirmPassword("");
    setRecoveryPasswordError("");
    setChangePasswordOpen(false);
    setStaffSignInOpen(false);
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
    if (inviteLoading) return;

    setUserManagementMessage("");
    setInviteLoading(true);

    try {
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
    } catch {
      setUserManagementMessage(
        "Could not reach the invitation service. Please try again."
      );
    } finally {
      setInviteLoading(false);
    }
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

    if (isAuthenticated) {
      const { data: componentRows, error: componentError } = await supabase
        .from("bundle_components")
        .select("*");

      if (componentError) {
        console.error("Could not load bundle contents:", componentError);
        setBundleComponents([]);
        setItems(data || []);
      } else {
        const links = componentRows || [];
        setBundleComponents(links);
        setItems(
          (data || []).map((item) => ({
            ...item,
            bundle_contents:
              item.item_type === "bundle"
                ? links
                    .filter((link) => String(link.bundle_item_id) === String(item.id))
                    .map((link) => {
                      const component = (data || []).find(
                        (candidate) => String(candidate.id) === String(link.component_item_id)
                      );
                      return `${link.piece_quantity || 1}× ${component?.title || "Untitled item"}`;
                    })
                : [],
          }))
        );
      }
    } else {
      setBundleComponents([]);
      setItems(data || []);
    }
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

  setCurriculumOptions(curricula?.map((x) => x.name) || []);
  setSubjectOptions(subjects?.map((x) => x.name) || []);
  setGradeOptions(grades?.map((x) => x.name) || []);
  setCategoryOptions(categories || []);
}

async function loadIntakeRules() {
  const { data, error } = await supabase
    .from("intake_rules")
    .select("*")
    .order("priority", { ascending: false })
    .order("name");

  if (error) {
    console.error("Could not load intake rules:", error);
    setIntakeRules([]);
    return;
  }

  setIntakeRules(data || []);
}

async function loadRuleSuggestionData() {
  if (!isAdmin) return;
  const [historyResult, reviewResult, isbnReviewResult] = await Promise.all([
    supabase
      .from("intake_history")
      .select("id, imported_values, final_values, manual_corrections, applied_rules, matched_rule_ids, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("intake_rule_suggestion_reviews").select("*"),
    supabase.from("isbn_inconsistency_reviews").select("*"),
  ]);
  if (historyResult.error) console.error("Could not load intake history for suggestions:", historyResult.error);
  if (reviewResult.error) console.error("Could not load suggestion reviews:", reviewResult.error);
  if (isbnReviewResult.error) console.error("Could not load ISBN review decisions:", isbnReviewResult.error);
  setIntakeHistories(historyResult.data || []);
  setSuggestionReviews(reviewResult.data || []);
  setIsbnInconsistencyReviews(isbnReviewResult.data || []);
}

function getIntakeLearningValues(book) {
  return Object.fromEntries(
    INTAKE_LEARNING_FIELDS.map((field) => [field, book?.[field] || ""])
  );
}

async function loadExactIsbnMemory(isbn) {
  const normalizedIsbn = String(isbn || "").toLowerCase().replace(/[^0-9x]/g, "");
  if (normalizedIsbn.length < 10) return null;

  const { data, error } = await supabase.rpc("get_exact_isbn_memory", {
    lookup_isbn: normalizedIsbn,
  });
  if (error) {
    console.error("Could not load exact ISBN memory:", error);
    return null;
  }
  return data || null;
}

async function applyRulesToImportedBook(importedBook, sourceType) {
  const ruleResult = applyIntakeRules(importedBook, intakeRules);
  const isbnMemory = await loadExactIsbnMemory(importedBook.isbn);
  const result = mergeExactIsbnMemory(ruleResult, isbnMemory);
  setRuleSources(result.sources);
  setRuleConflicts(result.conflicts);
  setIntakeContext({
    source_type: sourceType,
    imported_values: getIntakeLearningValues(importedBook),
    rule_values: getIntakeLearningValues(result.book),
    applied_rules: Object.entries(result.sources).map(([field, source]) => ({
      field,
      rule_id: source.ruleId,
      rule_name: source.ruleName,
      source_type: source.sourceType || "rule",
      previous_value: source.previousValue,
      applied_value: result.book[field] || "",
    })),
    matched_rule_ids: result.matchingRules.map((rule) => rule.id),
    initial_conflicts: result.conflicts,
    isbn_memory: result.isbnMemory || null,
    manual_fields: [],
  });
  return result.book;
}

function updateIntakeField(field, value, additionalChanges = {}) {
  setBookData((current) => ({ ...current, [field]: value, ...additionalChanges }));
  const changedLearningFields = [field, ...Object.keys(additionalChanges)].filter((item) =>
    INTAKE_LEARNING_FIELDS.includes(item)
  );
  if (changedLearningFields.length > 0) {
    setIntakeContext((current) => ({
      ...(current || {
        source_type: "manual",
        imported_values: getIntakeLearningValues({}),
        rule_values: getIntakeLearningValues({}),
        applied_rules: [],
        matched_rule_ids: [],
        initial_conflicts: {},
        manual_fields: [],
      }),
      manual_fields: [...new Set([...(current?.manual_fields || []), ...changedLearningFields])],
    }));
  }
  setRuleSources((current) => {
    const next = { ...current };
    delete next[field];
    return next;
  });
  setRuleConflicts((current) => {
    const next = { ...current };
    delete next[field];
    return next;
  });
}

function getIntakeSourceLabel(source) {
  return source?.sourceType === "isbn_memory" || source?.sourceType === "isbn_inventory"
    ? `Remembered from ${source.ruleName}`
    : `Filled by rule: ${source?.ruleName || "Unknown rule"}`;
}

function clearRuleFeedback() {
  setRuleSources({});
  setRuleConflicts({});
  setIntakeContext(null);
}

async function recordIntakeHistory(itemId, finalBook, duplicateItem) {
  const context = intakeContext || {
    source_type: "manual",
    imported_values: getIntakeLearningValues({}),
    rule_values: getIntakeLearningValues({}),
    applied_rules: [],
    matched_rule_ids: [],
    initial_conflicts: {},
    manual_fields: INTAKE_LEARNING_FIELDS,
  };
  const finalValues = getIntakeLearningValues(finalBook);
  const manualCorrections = Object.fromEntries(
    (context.manual_fields || []).map((field) => [field, {
      before: context.rule_values?.[field] ?? context.imported_values?.[field] ?? "",
      after: finalValues[field] || "",
    }])
  );
  const appliedRules = context.applied_rules || [];

  const { error } = await supabase.from("intake_history").insert([{
    item_id: itemId ? String(itemId) : null,
    isbn: finalValues.isbn,
    source_type: context.source_type || "manual",
    imported_values: context.imported_values,
    rule_values: context.rule_values,
    final_values: finalValues,
    manual_corrections: manualCorrections,
    applied_rules: appliedRules,
    matched_rule_ids: context.matched_rule_ids || [],
    unresolved_conflicts: ruleConflicts,
    duplicate_item: duplicateItem,
    created_by: profile?.id,
  }]);

  if (error) {
    console.error("Could not record intake history:", error);
  }
}

function getIntakeRulePerformance(ruleId) {
  let applied = 0;
  let accepted = 0;
  let corrected = 0;

  for (const history of intakeHistories) {
    const applications = (history.applied_rules || []).filter(
      (application) => application.rule_id === ruleId
    );
    if (applications.length === 0) continue;
    applied += 1;
    const wasCorrected = applications.some(
      (application) => history.manual_corrections?.[application.field]
    );
    if (wasCorrected) corrected += 1;
    else accepted += 1;
  }

  return {
    applied,
    accepted,
    corrected,
    acceptanceRate: applied ? Math.round((accepted / applied) * 100) : null,
  };
}

function resetIntakeRuleDraft() {
  setEditingIntakeRuleId(null);
  setReviewingSuggestionKey(null);
  setIntakeRuleDraft({
    ...EMPTY_INTAKE_RULE,
    conditions: [{ ...EMPTY_INTAKE_RULE.conditions[0] }],
    actions: { ...EMPTY_INTAKE_RULE.actions },
  });
}

function editIntakeRule(rule) {
  setEditingIntakeRuleId(rule.id);
  setReviewingSuggestionKey(null);
  setIntakeRuleDraft({
    name: rule.name || "",
    description: rule.description || "",
    match_mode: rule.match_mode || "all",
    priority: Number(rule.priority || 0),
    active: rule.active !== false,
    conditions: (rule.conditions || []).map((condition) => ({ ...condition })),
    actions: { ...EMPTY_INTAKE_RULE.actions, ...(rule.actions || {}) },
  });
  setIntakeRuleMessage("");
  window.setTimeout(() => {
    intakeRuleEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    intakeRuleNameRef.current?.focus({ preventScroll: true });
  }, 0);
}

async function saveIntakeRule() {
  if (!isAdmin) return;

  const conditions = intakeRuleDraft.conditions.filter(
    (condition) => condition.field && condition.operator && condition.value.trim()
  );
  const actions = Object.fromEntries(
    Object.entries(intakeRuleDraft.actions).filter(([, value]) => value.trim())
  );

  if (!intakeRuleDraft.name.trim() || conditions.length === 0 || Object.keys(actions).length === 0) {
    setIntakeRuleMessage("Add a rule name, at least one complete condition, and at least one result.");
    return;
  }

  const suggestionKeyToApprove = reviewingSuggestionKey;
  const payload = {
    name: intakeRuleDraft.name.trim(),
    description: intakeRuleDraft.description.trim(),
    match_mode: intakeRuleDraft.match_mode,
    priority: Number(intakeRuleDraft.priority || 0),
    active: intakeRuleDraft.active,
    conditions,
    actions,
    created_by: profile?.id || null,
  };

  const query = editingIntakeRuleId
    ? supabase.from("intake_rules").update(payload).eq("id", editingIntakeRuleId)
    : supabase.from("intake_rules").insert([payload]);
  const { error } = await query;

  if (error) {
    setIntakeRuleMessage("Could not save rule: " + error.message);
    return;
  }

  await logAudit(
    editingIntakeRuleId ? "intake_rule_updated" : "intake_rule_created",
    "intake_rule",
    editingIntakeRuleId,
    { name: payload.name }
  );
  if (suggestionKeyToApprove) {
    await reviewRuleSuggestion(
      { key: suggestionKeyToApprove, sample_count: 0, actions: payload.actions },
      "approved"
    );
  }
  setIntakeRuleMessage(editingIntakeRuleId ? "Rule updated." : "Rule created.");
  resetIntakeRuleDraft();
  await loadIntakeRules();
}

function approveRuleSuggestion(suggestion) {
  setEditingIntakeRuleId(null);
  setReviewingSuggestionKey(suggestion.key);
  setIntakeRuleDraft({
    ...EMPTY_INTAKE_RULE,
    name: `${RULE_INPUT_FIELDS.find(([field]) => field === suggestion.input_field)?.[1] || suggestion.input_field}: ${suggestion.input_value}`,
    description: `Suggested from ${suggestion.sample_count} consistent intake records.`,
    conditions: [{
      field: suggestion.input_field,
      operator: suggestion.input_field === "title" ? "equals" : "contains",
      value: suggestion.input_value,
    }],
    actions: { ...EMPTY_INTAKE_RULE.actions, ...suggestion.actions },
  });
  setIntakeRuleMessage("Review the suggested rule, then select Create Rule to approve it.");
  setOptionsSection("rules");
  window.setTimeout(() => {
    intakeRuleEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    intakeRuleNameRef.current?.focus({ preventScroll: true });
  }, 0);
}

async function reviewRuleSuggestion(suggestion, status) {
  if (!isAdmin) return;
  const payload = {
    suggestion_key: suggestion.key,
    status,
    sample_count_at_review: suggestion.sample_count || 0,
    details: {
      input_field: suggestion.input_field,
      input_value: suggestion.input_value,
      actions: suggestion.actions,
    },
    reviewed_by: profile?.id,
    reviewed_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("intake_rule_suggestion_reviews")
    .upsert([payload], { onConflict: "suggestion_key" });
  if (error) {
    setIntakeRuleMessage("Could not update suggestion: " + error.message);
    return;
  }
  await loadRuleSuggestionData();
}

async function dismissIsbnInconsistency(issue) {
  if (!isAdmin) return;
  const confirmed = confirm(
    `Dismiss this ISBN match for "${issue.title}"? It will return if these records change or another matching ISBN is added.`
  );
  if (!confirmed) return;

  const { error } = await supabase.from("isbn_inconsistency_reviews").upsert([{
    isbn: issue.isbn,
    record_signature: issue.record_signature,
    status: "dismissed",
    reviewed_by: profile?.id,
    reviewed_at: new Date().toISOString(),
  }], { onConflict: "isbn" });
  if (error) {
    setIsbnMergeMessage("Could not dismiss ISBN match: " + error.message);
    return;
  }

  setExpandedIsbnReview("");
  if (isbnMergeIssue?.isbn === issue.isbn) closeIsbnMerge();
  await logAudit("isbn_inconsistency_dismissed", "isbn", issue.isbn, {
    title: issue.title,
    record_count: issue.record_count,
  });
  await loadRuleSuggestionData();
}

function getIsbnMergeCandidates(issue) {
  return items.filter(
    (item) => String(item.isbn || "").toLowerCase().replace(/[^0-9x]/g, "") === issue.isbn
  );
}

function buildIsbnMergeDraft(keeper, candidates) {
  return {
    title: keeper.title || "",
    publisher: keeper.publisher || "",
    curriculum: keeper.curriculum || "",
    subject: keeper.subject || "",
    grade_level: keeper.grade_level || "",
    category: keeper.category || "",
    edition: keeper.edition || "",
    final_price: keeper.final_price ?? "",
    quantity: candidates.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
  };
}

function openIsbnMerge(issue, preferredKeeperId = "") {
  const candidates = getIsbnMergeCandidates(issue);
  const keeper = candidates.find((item) => String(item.id) === String(preferredKeeperId)) || candidates.find(
    (item) => (item.status || "Available") === "Available" && item.square_item_id
  ) || candidates.find((item) => (item.status || "Available") === "Available") || candidates[0];
  if (!keeper) return;
  setIsbnMergeIssue(issue);
  setIsbnMergeKeeperId(String(keeper.id));
  setIsbnMergeDraft(buildIsbnMergeDraft(keeper, candidates));
  setIsbnMergePrintLabels(true);
  setIsbnMergeMessage("");
  window.setTimeout(() => {
    isbnMergePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    isbnMergeKeeperRef.current?.focus({ preventScroll: true });
  }, 0);
}

function changeIsbnMergeKeeper(keeperId) {
  const candidates = getIsbnMergeCandidates(isbnMergeIssue);
  const keeper = candidates.find((item) => String(item.id) === keeperId);
  if (!keeper) return;
  setIsbnMergeKeeperId(keeperId);
  setIsbnMergeDraft(buildIsbnMergeDraft(keeper, candidates));
  setIsbnMergeMessage("");
}

function closeIsbnMerge() {
  if (isbnMergeLoading) return;
  setIsbnMergeIssue(null);
  setIsbnMergeKeeperId("");
  setIsbnMergeDraft(null);
  setIsbnMergeMessage("");
}

async function requireSuccessfulApiResponse(response, fallbackMessage) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error?.message || data.error || fallbackMessage);
  }
  return data;
}

async function mergeDuplicateIsbnEntries() {
  if (!isAdmin || !isbnMergeIssue || !isbnMergeDraft || isbnMergeLoading) return;
  const candidates = getIsbnMergeCandidates(isbnMergeIssue);
  const keeper = candidates.find((item) => String(item.id) === isbnMergeKeeperId);
  const duplicates = candidates.filter((item) => String(item.id) !== isbnMergeKeeperId);
  if (!keeper || duplicates.length === 0) return;
  if (!isbnMergeDraft.title.trim()) {
    setIsbnMergeMessage("Choose a title before merging.");
    return;
  }
  if (isbnMergeDraft.final_price === "" || Number(isbnMergeDraft.final_price) < 0) {
    setIsbnMergeMessage("Choose a valid final price before merging.");
    return;
  }
  if (Number(isbnMergeDraft.quantity) < 1) {
    setIsbnMergeMessage("The combined quantity must be at least 1.");
    return;
  }

  const confirmed = confirm(
    `Merge ${candidates.length} records for ISBN ${isbnMergeIssue.isbn} into SKU ${keeper.sku}? ` +
    `The surviving quantity will be ${isbnMergeDraft.quantity}, duplicate Square products will be archived, ` +
    `and duplicate inventory records will be deleted.`
  );
  if (!confirmed) return;

  setIsbnMergeLoading(true);
  setIsbnMergeMessage("Updating Square and merging inventory...");
  const archivedDuplicates = [];
  let squareItemId = keeper.square_item_id || "";
  let squareVariationId = keeper.square_variation_id || "";
  let createdKeeperSquareItem = false;

  async function restoreSquareAfterFailure() {
    for (const duplicate of archivedDuplicates) {
      try {
        await authFetch("/unarchive-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ square_item_id: duplicate.square_item_id }),
        });
      } catch (error) {
        console.error("Could not restore duplicate Square item:", error);
      }
    }
    try {
      if (createdKeeperSquareItem && squareItemId) {
        await authFetch("/archive-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ square_item_id: squareItemId }),
        });
      } else if (squareItemId && squareVariationId) {
        await authFetch("/update-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            square_item_id: squareItemId,
            square_variation_id: squareVariationId,
            title: keeper.title || "",
            sku: keeper.sku || "",
            final_price: keeper.final_price || 0,
            quantity: keeper.quantity || 0,
            notes: keeper.notes || "",
          }),
        });
      }
    } catch (error) {
      console.error("Could not restore surviving Square item:", error);
    }
  }

  try {
    if (squareItemId && squareVariationId) {
      const response = await authFetch("/update-square-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          square_item_id: squareItemId,
          square_variation_id: squareVariationId,
          title: isbnMergeDraft.title,
          sku: keeper.sku || "",
          final_price: isbnMergeDraft.final_price || 0,
          quantity: isbnMergeDraft.quantity,
          notes: keeper.notes || "",
        }),
      });
      await requireSuccessfulApiResponse(response, "Could not update the surviving Square item.");
    } else {
      const response = await authFetch("/create-square-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: isbnMergeDraft.title,
          sku: keeper.sku || "",
          final_price: isbnMergeDraft.final_price || 0,
          quantity: isbnMergeDraft.quantity,
          notes: keeper.notes || "",
        }),
      });
      const data = await requireSuccessfulApiResponse(response, "Could not create the surviving Square item.");
      squareItemId = data.square_item_id;
      squareVariationId = data.square_variation_id;
      createdKeeperSquareItem = true;
    }

    const duplicateSquareIds = new Set();
    for (const duplicate of duplicates) {
      if (
        !duplicate.square_item_id ||
        duplicate.square_item_id === squareItemId ||
        duplicateSquareIds.has(duplicate.square_item_id)
      ) continue;
      duplicateSquareIds.add(duplicate.square_item_id);
      const response = await authFetch("/archive-square-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ square_item_id: duplicate.square_item_id }),
      });
      await requireSuccessfulApiResponse(response, `Could not archive Square item for ${duplicate.sku}.`);
      archivedDuplicates.push(duplicate);
    }

    const { data: mergedItem, error } = await supabase.rpc("merge_inventory_items", {
      p_keeper_id: String(keeper.id),
      p_duplicate_ids: duplicates.map((item) => String(item.id)),
      p_values: {
        ...isbnMergeDraft,
        square_item_id: squareItemId,
        square_variation_id: squareVariationId,
      },
    });
    if (error) throw error;

    await logAudit("inventory_isbn_merged", "item", keeper.id, {
      isbn: isbnMergeIssue.isbn,
      kept_item_id: keeper.id,
      removed_item_ids: duplicates.map((item) => item.id),
      combined_quantity: isbnMergeDraft.quantity,
      final_price: isbnMergeDraft.final_price,
    });

    setItems((current) => [
      ...current.filter((item) => !candidates.some((candidate) => candidate.id === item.id)),
      mergedItem,
    ]);
    setIsbnMergeMessage("Merge complete.");
    if (isbnMergePrintLabels) generateLabels([mergedItem]);
    setIsbnMergeIssue(null);
    setIsbnMergeKeeperId("");
    setIsbnMergeDraft(null);
    await loadItems();
  } catch (error) {
    await restoreSquareAfterFailure();
    setIsbnMergeMessage(
      "Merge stopped before the database was changed. Square recovery was attempted. " + error.message
    );
  } finally {
    setIsbnMergeLoading(false);
  }
}

async function toggleIntakeRule(rule) {
  if (!isAdmin) return;
  const { error } = await supabase
    .from("intake_rules")
    .update({ active: !rule.active })
    .eq("id", rule.id);
  if (error) {
    setIntakeRuleMessage("Could not update rule: " + error.message);
    return;
  }
  await logAudit("intake_rule_toggled", "intake_rule", rule.id, {
    name: rule.name,
    active: !rule.active,
  });
  await loadIntakeRules();
}

async function deleteIntakeRule(rule) {
  if (!isAdmin || !confirm(`Delete the intake rule "${rule.name}"?`)) return;
  const { error } = await supabase.from("intake_rules").delete().eq("id", rule.id);
  if (error) {
    setIntakeRuleMessage("Could not delete rule: " + error.message);
    return;
  }
  await logAudit("intake_rule_deleted", "intake_rule", rule.id, { name: rule.name });
  if (editingIntakeRuleId === rule.id) resetIntakeRuleDraft();
  await loadIntakeRules();
}

function normalizeLocationName(value) {
  return (value || "").trim().toLowerCase();
}

function cleanLocationName(value) {
  return (value || "").trim().replace(/\s+/g, " ");
}

/* Location-specific helpers are retained only in database history.
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

function locationMatches(value, selectedValue) {
  if (!selectedValue) return true;
  return normalizeLocationName(value) === normalizeLocationName(selectedValue);
}
*/

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

/* Location management was removed from the product.
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
*/

function toggleSelectedItem(id) {
  setSelectedItemIds((current) =>
    current.includes(id)
      ? current.filter((itemId) => itemId !== id)
      : [...current, id]
  );
}

async function bulkDeleteSelected() {
  if (selectedItemIds.length === 0) return;

  const protectedSelection = items.find(
    (item) =>
      selectedItemIds.includes(item.id) &&
      (item.status === "Bundled" || item.item_type === "bundle")
  );
  if (protectedSelection) {
    alert("Bundles and their protected component books cannot be bulk removed. Split the bundle first.");
    return;
  }

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

  const changesAvailability = Boolean(bulkStatus || bulkPublicVisible);
  const hasProtectedBundleItems = changesAvailability && items.some(
    (item) =>
      selectedItemIds.includes(item.id) &&
      (item.status === "Bundled" || item.item_type === "bundle")
  );
  if (hasProtectedBundleItems) {
    alert("Bundle availability cannot be bulk changed. Open the bundle to split or update it safely.");
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
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (handledCoverFilesRef.current.has(file)) return;
  handledCoverFilesRef.current.add(file);

  setAnalysisStatus("Loading camera photo...");

  const pendingIdentifier = bookData?.publisher_item_number || bookData?.publisher_barcode
    ? {
        ...(bookData.publisher ? { publisher: bookData.publisher } : {}),
        publisher_item_number: bookData.publisher_item_number || "",
        publisher_barcode: bookData.publisher_barcode || "",
      }
    : null;

  setCoverPhoto(URL.createObjectURL(file));
  setBookData((current) => pendingIdentifier ? current : null);
  clearRuleFeedback();

  try {
    await new Promise((resolve) => window.requestAnimationFrame(resolve));

    setAnalysisStatus("Preparing camera photo...");
    const optimizedFile = await shrinkImageFile(file, 1400, 0.82, {
      requireReadableImage: true,
    });
    setCoverFile(optimizedFile);

    await analyzePhotoWithFile(optimizedFile, pendingIdentifier);
  } catch (error) {
    setAnalysisStatus("");
    alert(error.message || "The camera photo could not be processed. Please try again.");
  } finally {
    input.value = "";
  }
}

function startManualEntry() {
  clearRuleFeedback();
  setIntakeContext({
    source_type: "manual",
    imported_values: getIntakeLearningValues({}),
    rule_values: getIntakeLearningValues({}),
    applied_rules: [],
    matched_rule_ids: [],
    initial_conflicts: {},
    manual_fields: [],
  });
  setBookData({
    title: "",
    curriculum: "",
    publisher: "",
    subject: "",
    grade_level: "",
    edition: "",
    isbn: "",
    publisher_barcode: "",
    publisher_item_number: "",
    category: "",
    suggested_price: "",
    final_price: "",
    quantity: 1,
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

const coverUrl =
  book.imageLinks?.thumbnail ||
  book.imageLinks?.smallThumbnail ||
  "";

setBookData(await applyRulesToImportedBook({
  title: book.title || "",
  author: book.authors?.join(", ") || "",
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
  status: "Available",
  notes: book.description || "",
  confidence: "Google Books ISBN lookup",
  public_visible: true,
  image_url: coverUrl,}, "google_books"));

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
      setBookData(await applyRulesToImportedBook({
        title: openLibraryData.title || "",
        author: Array.isArray(openLibraryData.authors)
          ? openLibraryData.authors.map((author) => author.name || author.key || "").filter(Boolean).join(", ")
          : "",
        publisher: openLibraryData.publishers?.[0] || "",
        curriculum: openLibraryData.publishers?.[0] || "",
        subject: "",
        grade_level: "",
        edition: "",
        isbn: cleanIsbn,
       category: suggested?.item_name || "",
        suggested_price: suggested?.price || "",
        final_price: suggested?.price || "",
        quantity: 1,
        status: "Available",
        notes: "",
        confidence: "Open Library ISBN lookup",
        public_visible: true,
      }, "open_library"));

      setAnalysisStatus("ISBN lookup complete!");
      setTimeout(() => setAnalysisStatus(""), 1800);
      return;
    }

    // 3. If neither source finds it, still fill ISBN
    setBookData(await applyRulesToImportedBook({
      title: "",
      curriculum: "",
      subject: "",
      grade_level: "",
      edition: "",
      isbn: cleanIsbn,
      category: "",
      final_price: "",
      quantity: 1,
      status: "Available",
      notes: "",
      confidence: "ISBN scanned only",
      public_visible: true,
    }, "isbn_only"));

    setAnalysisStatus("");
    alert("ISBN scanned, but no book data was found. You can enter the details manually.");
  } catch (error) {
    setAnalysisStatus("");
    alert("Book lookup failed: " + error.message);
  }
}

async function findPublisherRecord(table, { publisher, publisherItemNumber, publisherBarcode }) {
  if (publisherBarcode) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("publisher_barcode", publisherBarcode)
      .limit(1);
    if (error) throw error;
    if (data?.[0]) return data[0];
  }

  if (!publisherItemNumber) return null;
  const { data, error } = await supabase
    .from(table)
    .select("*")
    .eq("publisher_item_number", publisherItemNumber);
  if (error) throw error;

  const matches = publisher
    ? (data || []).filter((candidate) =>
        normalizePublisher(candidate.publisher) === normalizePublisher(publisher)
      )
    : (data || []);
  if (!matches.length) return null;

  // An unlabelled eight-digit barcode is safe to use only when its six-digit
  // candidate identifies one publisher in our saved data.
  const publishers = new Set(matches.map((candidate) => normalizePublisher(candidate.publisher)).filter(Boolean));
  return publishers.size <= 1 ? matches[0] : null;
}

async function lookupBookByPublisherIdentifier(identification, currentBook = {}) {
  const publisher = String(identification.publisher || currentBook.publisher || "").trim();
  const publisherItemNumber = normalizePublisherItemNumber(
    identification.publisherItemNumber || currentBook.publisher_item_number
  );
  const publisherBarcode = String(
    identification.publisherBarcode || currentBook.publisher_barcode || ""
  ).trim();
  setAnalysisStatus("Looking up book barcode...");

  try {
    const lookup = { publisher, publisherItemNumber, publisherBarcode };
    const remembered = await findPublisherRecord("items", lookup);
    const curriculumMaterial = remembered
      ? null
      : await findPublisherRecord("curriculum_materials", lookup);
    const matched = remembered || curriculumMaterial;
    const matchedPublisher = matched?.publisher || publisher;
    const matchedNumber = matched?.publisher_item_number || publisherItemNumber;
    let curriculumContext = null;
    if (curriculumMaterial?.id) {
      const { data, error } = await supabase
        .from("curriculum_package_items")
        .select("group_label, package:curriculum_packages(name,grade_level,subject,edition_label)")
        .eq("material_id", curriculumMaterial.id)
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      curriculumContext = data;
    }
    const curriculumPackage = curriculumContext?.package;
    const importedBook = {
      ...currentBook,
      title: matched?.title || currentBook.title || "",
      curriculum: remembered?.curriculum || currentBook.curriculum || matchedPublisher || "",
      publisher: matchedPublisher || currentBook.publisher || "",
      subject: remembered?.subject || curriculumPackage?.subject || curriculumContext?.group_label || currentBook.subject || "",
      grade_level: remembered?.grade_level || curriculumPackage?.grade_level || currentBook.grade_level || "",
      edition: remembered?.edition || curriculumMaterial?.edition_label || curriculumPackage?.edition_label || currentBook.edition || "",
      isbn: matched?.isbn || currentBook.isbn || "",
      publisher_barcode: publisherBarcode || matched?.publisher_barcode || "",
      publisher_item_number: matchedNumber || "",
      category: remembered?.category || currentBook.category || "",
      suggested_price: remembered?.final_price ?? currentBook.suggested_price ?? "",
      final_price: remembered?.final_price ?? currentBook.final_price ?? "",
      quantity: 1,
      status: "Available",
      notes: remembered?.notes || currentBook.notes || "",
      public_visible: true,
      image_url: remembered?.image_url || currentBook.image_url || "",
      confidence: remembered
        ? "Remembered from an earlier barcode scan"
        : curriculumMaterial
          ? "Matched to a Curriculum List material"
          : "New book barcode — use cover analysis and complete the details once",
    };

    setBookData(await applyRulesToImportedBook(
      importedBook,
      remembered ? "publisher_inventory" : curriculumMaterial ? "curriculum_material" : "publisher_barcode"
    ));
    setAnalysisStatus(
      matched
        ? "Book barcode found!"
        : "New book barcode. Analyze the cover, then review and save it once."
    );
    if (matched) setTimeout(() => setAnalysisStatus(""), 1800);
  } catch (error) {
    setAnalysisStatus("");
    alert("Book barcode lookup failed: " + error.message);
  }
}

async function lookupBookByBarcode(value) {
  const identification = identifyBookBarcode(value);

  if (identification.type === "isbn") {
    await lookupBookByIsbn(identification.isbn);
    return;
  }

  if (identification.type === "publisher") {
    await lookupBookByPublisherIdentifier(identification);
    return;
  }

  await lookupBookByPublisherIdentifier({ publisherBarcode: identification.raw });
}

async function scanIsbnBarcode() {
  setIsScanningBarcode(true);

  try {
    const codeReader = new BrowserMultiFormatReader();

    const result = await codeReader.decodeOnceFromVideoDevice(
      undefined,
      "barcode-video"
    );

const scannedValue = result.getText();

await lookupBookByBarcode(scannedValue);
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

async function analyzePhotoWithFile(file, pendingIdentifier = null) {
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
    const detectedPublisher = pendingIdentifier?.publisher || improvedData.publisher || improvedData.curriculum || "";
    const inferredPublisherItemNumber = pendingIdentifier?.publisher_item_number ||
      inferPublisherItemNumber(detectedPublisher, pendingIdentifier?.publisher_barcode);

setBookData(await applyRulesToImportedBook({
  ...improvedData,
  ...(pendingIdentifier || {}),
  ...(inferredPublisherItemNumber ? { publisher_item_number: inferredPublisherItemNumber } : {}),
  category: improvedData.category || suggested?.name || "",
  suggested_price:
    improvedData.suggested_price || suggested?.default_price || "",
  final_price:
    improvedData.final_price || suggested?.default_price || "",
}, "cover_analysis"));


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

  async function generateSku(itemType = "individual") {
    const { data, error } = await supabase.rpc("next_inventory_sku", {
      p_item_type: itemType,
    });

    if (error || !data) {
      throw new Error("Could not generate SKU: " + (error?.message || "No SKU returned."));
    }

    return data;
  }

  async function uploadCoverImage(file) {
    if (!file) return "";

    const fileExt = file.type?.split("/")[1] || "jpg";
    const fileName = `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from("book-covers")
      .upload(fileName, file, {
        contentType: file.type || "image/jpeg",
      });

    if (uploadError) {
      throw new Error("Image upload failed: " + uploadError.message);
    }

    const { data } = supabase.storage.from("book-covers").getPublicUrl(fileName);
    return data.publicUrl;
  }

  function startBundle() {
    setBundleDraft({ ...EMPTY_BUNDLE_DRAFT, active: true, source: "intake" });
    setBundleReviewOpen(false);
    setBundleCoverFile(null);
    setBundleCoverPreview("");
  }

  async function startInventoryBundle() {
    if (bundleDraft.active && bundleDraft.components.length > 0) {
      alert("Finish or cancel the active bundle before starting another one.");
      return;
    }

    const selectedItems = items.filter((item) => selectedItemIds.includes(item.id));
    if (selectedItems.length < 2) {
      alert("Select at least two inventory listings to create a bundle.");
      return;
    }

    const unavailableItem = selectedItems.find(
      (item) =>
        item.item_type === "bundle" ||
        item.status !== "Available" ||
        bundleParentByComponentId[String(item.id)] ||
        Number(item.quantity || 0) < 1
    );
    if (unavailableItem) {
      alert(
        `“${unavailableItem.title}” is not available for a new bundle. Choose available individual listings only.`
      );
      return;
    }

    const { data: reservations, error: reservationError } = await supabase
      .from("book_reservations")
      .select("item_id")
      .in("item_id", selectedItems.map((item) => String(item.id)))
      .in("status", ["pending", "ready"])
      .gt("expires_at", new Date().toISOString());

    if (reservationError) {
      alert("Could not check reservations: " + reservationError.message);
      return;
    }
    if ((reservations || []).length > 0) {
      const reservedIds = new Set(reservations.map((reservation) => String(reservation.item_id)));
      const reservedItem = selectedItems.find((item) => reservedIds.has(String(item.id)));
      alert(`Cancel or complete the active reservation for “${reservedItem?.title || "a selected book"}” first.`);
      return;
    }

    setBundleDraft({
      ...EMPTY_BUNDLE_DRAFT,
      active: true,
      source: "inventory",
      components: selectedItems.map((item) => ({
        ...item,
        bundle_quantity: 1,
        from_inventory: true,
      })),
    });
    setBundleReviewOpen(true);
    setBundleCoverFile(null);
    setBundleCoverPreview("");
    setSelectedItemIds([]);
    setIsSelectionMode(false);
  }

  function updateInventoryBundleQuantity(componentId, value) {
    setBundleDraft((current) => ({
      ...current,
      components: current.components.map((component) =>
        component.id === componentId
          ? {
              ...component,
              bundle_quantity: Math.min(
                Math.max(1, Number(value || 1)),
                Math.max(1, Number(component.quantity || 1))
              ),
            }
          : component
      ),
    }));
  }

  function removeInventoryBundleComponent(componentId) {
    setBundleDraft((current) => ({
      ...current,
      components: current.components.filter((component) => component.id !== componentId),
    }));
  }

  function handleBundleCover(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (bundleCoverPreview) URL.revokeObjectURL(bundleCoverPreview);
    setBundleCoverFile(file);
    setBundleCoverPreview(URL.createObjectURL(file));
  }

  function clearSavedBook() {
    setBookData(null);
    clearRuleFeedback();
    setCoverPhoto(null);
    setCoverFile(null);
    setIsbnPhoto(null);
  }

  async function createSquareListing(item) {
    const response = await authFetch("/create-square-item", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title || "Untitled Book",
        sku: item.sku || "",
        final_price: item.final_price || 0,
        quantity: item.quantity || 1,
        notes: item.notes || "",
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.success) {
      throw new Error(JSON.stringify(data.error || "Square item creation failed."));
    }

    return data;
  }

  async function activateIndividualItem(item) {
    let squareItemId = item.square_item_id || "";
    let squareVariationId = item.square_variation_id || "";
    let createdSquareItemId = "";

    if (!squareItemId || !squareVariationId) {
      const squareData = await createSquareListing(item);
      squareItemId = squareData.square_item_id;
      squareVariationId = squareData.square_variation_id;
      createdSquareItemId = squareData.square_item_id;
    } else {
      const inventoryResponse = await authFetch("/update-square-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          square_variation_id: squareVariationId,
          quantity: Math.max(1, Number(item.quantity || 1)),
        }),
      });
      const inventoryData = await inventoryResponse.json().catch(() => ({}));
      if (!inventoryResponse.ok || !inventoryData.success) {
        throw new Error(JSON.stringify(inventoryData.error || "Square inventory update failed."));
      }
    }

    const queuedAt = new Date().toISOString();
    const { error } = await supabase
      .from("items")
      .update({
        status: "Available",
        public_visible: true,
        square_item_id: squareItemId,
        square_variation_id: squareVariationId,
        label_printed: false,
        pending_label_quantity: Math.max(1, Number(item.quantity || 1)),
        label_queued_at: queuedAt,
        updated_at: queuedAt,
      })
      .eq("id", item.id);

    if (error) {
      if (createdSquareItemId) {
        await authFetch("/archive-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ square_item_id: createdSquareItemId }),
        }).catch(() => null);
      }
      throw new Error(error.message);
    }
  }

  function buildRetroBundleComponent(item, quantity, sku) {
    return {
      title: item.title || "",
      curriculum: item.curriculum || "",
      publisher: item.publisher || "",
      subject: item.subject || "",
      grade_level: item.grade_level || "",
      edition: item.edition || "",
      isbn: item.isbn || "",
      publisher_barcode: item.publisher_barcode || "",
      category: item.category || "",
      suggested_price: item.suggested_price ?? null,
      final_price: item.final_price ?? null,
      quantity,
      status: "Bundled",
      notes: item.notes || "",
      ai_confidence: item.ai_confidence ?? null,
      public_visible: false,
      image_url: item.image_url || "",
      sku,
      item_type: "individual",
      bundle_piece_count: 0,
      label_printed: true,
      pending_label_quantity: 0,
      label_queued_at: null,
      ...(item.publisher_item_number !== undefined
        ? { publisher_item_number: item.publisher_item_number || "" }
        : {}),
      ...(item.location !== undefined ? { location: item.location || "" } : {}),
      ...(item.weight_ounces !== undefined
        ? { weight_ounces: item.weight_ounces ?? null }
        : {}),
    };
  }

  async function materializeInventoryBundleComponents(components) {
    const materialized = [];
    const rememberMaterializedComponent = (originalId, nextComponent) => {
      setBundleDraft((current) => ({
        ...current,
        components: current.components.map((component) =>
          component.id === originalId ? nextComponent : component
        ),
      }));
    };

    for (const component of components) {
      if (!component.from_inventory || component.retro_materialized) {
        materialized.push(component);
        continue;
      }

      const { data: currentItem, error: loadError } = await supabase
        .from("items")
        .select("*")
        .eq("id", component.id)
        .single();
      if (loadError) throw loadError;

      const bundleQuantity = getBundleComponentQuantity(component);
      const currentQuantity = Math.max(0, Number(currentItem.quantity || 0));
      if (bundleQuantity > currentQuantity) {
        throw new Error(`${currentItem.title} no longer has enough available copies.`);
      }

      if (bundleQuantity === currentQuantity) {
        const materializedComponent = {
          ...currentItem,
          bundle_quantity: bundleQuantity,
          retro_materialized: true,
        };
        materialized.push(materializedComponent);
        rememberMaterializedComponent(component.id, materializedComponent);
        continue;
      }

      const remainingQuantity = currentQuantity - bundleQuantity;
      const componentSku = await generateSku("individual");
      const { data: splitComponent, error: insertError } = await supabase
        .from("items")
        .insert([buildRetroBundleComponent(currentItem, bundleQuantity, componentSku)])
        .select("*")
        .single();
      if (insertError) throw insertError;

      let squareInventoryChanged = false;
      try {
        if (currentItem.square_variation_id) {
          const inventoryResponse = await authFetch("/update-square-inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              square_variation_id: currentItem.square_variation_id,
              quantity: remainingQuantity,
            }),
          });
          const inventoryData = await inventoryResponse.json().catch(() => ({}));
          if (!inventoryResponse.ok || !inventoryData.success) {
            throw new Error(JSON.stringify(inventoryData.error || "Square inventory update failed."));
          }
          squareInventoryChanged = true;
        }

        const remainingLabels = Math.min(
          getQueuedLabelQuantity(currentItem),
          remainingQuantity
        );
        const { error: updateError } = await supabase
          .from("items")
          .update({
            quantity: remainingQuantity,
            label_printed: remainingLabels === 0,
            pending_label_quantity: remainingLabels,
            label_queued_at: remainingLabels > 0 ? currentItem.label_queued_at : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", currentItem.id);
        if (updateError) throw updateError;
      } catch (error) {
        if (squareInventoryChanged && currentItem.square_variation_id) {
          await authFetch("/update-square-inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              square_variation_id: currentItem.square_variation_id,
              quantity: currentQuantity,
            }),
          }).catch(() => null);
        }
        await supabase.from("items").delete().eq("id", splitComponent.id);
        throw error;
      }

      await logAudit("inventory_item_split_for_bundle", "item", currentItem.id, {
        component_item_id: splitComponent.id,
        bundled_quantity: bundleQuantity,
        remaining_quantity: remainingQuantity,
      });
      const materializedComponent = {
        ...splitComponent,
        bundle_quantity: bundleQuantity,
        retro_materialized: true,
      };
      materialized.push(materializedComponent);
      rememberMaterializedComponent(component.id, materializedComponent);
    }

    return materialized;
  }

  async function saveBundleComponent(itemDraft) {
    setAnalysisStatus("Adding book to bundle...");
    const [newSku, imageUrl] = await Promise.all([
      generateSku("individual"),
      uploadCoverImage(coverFile),
    ]);
    const componentToSave = {
      ...itemDraft,
      sku: newSku,
      image_url: imageUrl || bookData.image_url || "",
      status: "Bundled",
      public_visible: false,
      item_type: "individual",
      bundle_piece_count: 0,
      label_printed: true,
      pending_label_quantity: 0,
      label_queued_at: null,
    };
    const { data: insertedItem, error } = await supabase
      .from("items")
      .insert([componentToSave])
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    await Promise.all([
      saveOptionIfNew("curriculum_options", insertedItem.curriculum),
      saveOptionIfNew("category_options", insertedItem.category),
    ]);
    await recordIntakeHistory(insertedItem.id, insertedItem, false);
    await logAudit("bundle_component_created", "item", insertedItem.id, {
      title: insertedItem.title,
      sku: insertedItem.sku,
    });

    setBundleDraft((current) => ({
      ...current,
      components: [...current.components, insertedItem],
    }));
    clearSavedBook();
    await loadItems();
    alert(`${insertedItem.title || "Book"} was added to the active bundle.`);
  }

  async function removeBundleDraftComponent(component) {
    if (bundleActionLoading) return;
    setBundleActionLoading(true);
    setAnalysisStatus("Releasing book for individual sale...");

    try {
      const { data: currentItem, error } = await supabase
        .from("items")
        .select("*")
        .eq("id", component.id)
        .single();
      if (error) throw error;
      await activateIndividualItem(currentItem);
      setBundleDraft((current) => ({
        ...current,
        components: current.components.filter((item) => item.id !== component.id),
      }));
      await loadItems();
    } catch (error) {
      alert("Could not release this book: " + error.message);
    } finally {
      setAnalysisStatus("");
      setBundleActionLoading(false);
    }
  }

  async function cancelBundle() {
    if (bundleActionLoading) return;
    if (
      bundleDraft.components.length > 0 &&
      !confirm(
        `Cancel this bundle and list its ${getBundlePieceCount(bundleDraft.components)} pieces individually?`
      )
    ) {
      return;
    }

    if (
      bundleDraft.source === "inventory" &&
      bundleDraft.components.every(
        (component) => component.from_inventory && !component.retro_materialized
      )
    ) {
      setBundleDraft({ ...EMPTY_BUNDLE_DRAFT });
      setBundleReviewOpen(false);
      setBundleCoverFile(null);
      setBundleCoverPreview("");
      alert("Bundle cancelled. The selected inventory listings were not changed.");
      return;
    }

    setBundleActionLoading(true);
    setAnalysisStatus("Preparing individual listings...");
    try {
      for (const component of bundleDraft.components) {
        const { data: currentItem, error } = await supabase
          .from("items")
          .select("*")
          .eq("id", component.id)
          .single();
        if (error) throw error;
        await activateIndividualItem(currentItem);
      }

      await logAudit("bundle_draft_cancelled", "bundle", null, {
        component_ids: bundleDraft.components.map((item) => item.id),
      });
      setBundleDraft({ ...EMPTY_BUNDLE_DRAFT });
      setBundleReviewOpen(false);
      setBundleCoverFile(null);
      setBundleCoverPreview("");
      await loadItems();
      alert("Bundle cancelled. Its books are now listed individually.");
    } catch (error) {
      await loadItems();
      alert(
        "The bundle could not be fully cancelled. Books already released are safe; retry to finish. " +
          error.message
      );
    } finally {
      setAnalysisStatus("");
      setBundleActionLoading(false);
    }
  }

  async function finishBundle() {
    if (bundleActionLoading) return;
    const pieceCount = getBundlePieceCount(bundleDraft.components);
    const price = Number(bundleDraft.price);

    if (pieceCount < 2) {
      alert("Add at least two pieces before finishing the bundle.");
      return;
    }
    if (!bundleDraft.title.trim()) {
      alert("Enter a title for the set.");
      return;
    }
    if (bundleDraft.price === "" || !Number.isFinite(price) || price < 0) {
      alert("Enter a valid bundle price.");
      return;
    }

    setBundleActionLoading(true);
    setAnalysisStatus("Creating bundle listing...");
    let squareItemId = "";
    let bundleItemId = "";
    let workingComponents = bundleDraft.components;

    try {
      if (bundleDraft.source === "inventory") {
        workingComponents = await materializeInventoryBundleComponents(workingComponents);
        setBundleDraft((current) => ({
          ...current,
          components: workingComponents,
        }));
      }

      const componentIds = workingComponents.map((item) => item.id);
      const { data: currentComponents, error: componentLoadError } = await supabase
        .from("items")
        .select("*")
        .in("id", componentIds);
      if (componentLoadError) throw componentLoadError;
      if ((currentComponents || []).length !== workingComponents.length) {
        throw new Error("One or more draft books could not be found.");
      }

      for (const component of currentComponents || []) {
        if (component.square_item_id) {
          const archiveResponse = await authFetch("/archive-square-item", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ square_item_id: component.square_item_id }),
          });
          const archiveData = await archiveResponse.json().catch(() => ({}));
          if (!archiveResponse.ok || !archiveData.success) {
            throw new Error(`Could not protect ${component.title} in Square.`);
          }
        }
      }

      const { error: protectError } = await supabase
        .from("items")
        .update({
          status: "Bundled",
          public_visible: false,
          square_item_id: null,
          square_variation_id: null,
          label_printed: true,
          pending_label_quantity: 0,
          label_queued_at: null,
          updated_at: new Date().toISOString(),
        })
        .in("id", componentIds);
      if (protectError) throw protectError;

      const [newSku, uploadedBundleImage] = await Promise.all([
        generateSku("bundle"),
        uploadCoverImage(bundleCoverFile),
      ]);
      const contents = buildBundleContentsNote(workingComponents);
      const commonValue = (field) => {
        const values = [...new Set(workingComponents.map((item) => item[field] || ""))];
        return values.length === 1 ? values[0] : "";
      };
      const bundleItem = {
        title: bundleDraft.title.trim(),
        curriculum: commonValue("curriculum"),
        publisher: commonValue("publisher"),
        subject: commonValue("subject"),
        grade_level: commonValue("grade_level"),
        edition: commonValue("edition"),
        isbn: "",
        publisher_barcode: "",
        category: "Bundle / Set",
        suggested_price: null,
        final_price: price,
        quantity: 1,
        status: "Available",
        notes: `Bundle contents:\n${contents}`,
        sku: newSku,
        image_url:
          uploadedBundleImage ||
          workingComponents.find((item) => item.image_url)?.image_url ||
          "",
        public_visible: true,
        item_type: "bundle",
        bundle_piece_count: pieceCount,
        label_printed: false,
        pending_label_quantity: 1,
        label_queued_at: new Date().toISOString(),
      };

      const squareData = await createSquareListing(bundleItem);
      squareItemId = squareData.square_item_id;

      const { data: insertedBundle, error: insertError } = await supabase
        .from("items")
        .insert([{
          ...bundleItem,
          square_item_id: squareData.square_item_id,
          square_variation_id: squareData.square_variation_id,
        }])
        .select("*")
        .single();
      if (insertError) throw insertError;
      bundleItemId = insertedBundle.id;

      const { error: componentError } = await supabase
        .from("bundle_components")
        .insert(getBundleComponentRows(insertedBundle.id, workingComponents));
      if (componentError) throw componentError;

      await logAudit("inventory_bundle_created", "item", insertedBundle.id, {
        title: insertedBundle.title,
        sku: insertedBundle.sku,
        piece_count: pieceCount,
        component_ids: workingComponents.map((item) => item.id),
      });

      setBundleDraft({ ...EMPTY_BUNDLE_DRAFT });
      setBundleReviewOpen(false);
      setBundleCoverFile(null);
      setBundleCoverPreview("");
      await loadItems();
      alert(`Bundle saved as ${newSku}. Its sticker is in the label queue.`);
    } catch (error) {
      if (bundleItemId) {
        await supabase.from("items").delete().eq("id", bundleItemId);
      }
      if (squareItemId) {
        await authFetch("/archive-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ square_item_id: squareItemId }),
        }).catch(() => null);
      }
      alert("Bundle creation failed. The component books remain safely in the draft. " + error.message);
    } finally {
      setAnalysisStatus("");
      setBundleActionLoading(false);
    }
  }

  async function splitBundle(item) {
    if (bundleActionLoading || item.item_type !== "bundle") return;
    const links = bundleComponents.filter(
      (row) => String(row.bundle_item_id) === String(item.id)
    );
    if (!confirm(`Split "${item.title}" and return ${item.bundle_piece_count || links.length} pieces to individual sale?`)) {
      return;
    }

    setBundleActionLoading(true);
    try {
      const { data: activeReservations, error: reservationError } = await supabase
        .from("book_reservations")
        .select("id")
        .eq("item_id", String(item.id))
        .in("status", ["pending", "ready"])
        .gt("expires_at", new Date().toISOString());
      if (reservationError) throw reservationError;
      if ((activeReservations || []).length > 0) {
        throw new Error("Cancel or complete the active reservation for this set before splitting it.");
      }

      if (item.square_item_id) {
        const archiveResponse = await authFetch("/archive-square-item", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ square_item_id: item.square_item_id }),
        });
        const archiveData = await archiveResponse.json().catch(() => ({}));
        if (!archiveResponse.ok || !archiveData.success) {
          throw new Error(JSON.stringify(archiveData.error || "Square archive failed."));
        }
      }

      const removedAt = new Date().toISOString();
      const { error: bundleError } = await supabase
        .from("items")
        .update({
          status: "Removed",
          public_visible: false,
          quantity: 0,
          updated_at: removedAt,
        })
        .eq("id", item.id);
      if (bundleError) throw bundleError;

      const componentIds = links.map((row) => row.component_item_id);
      const { data: components, error: componentLoadError } = await supabase
        .from("items")
        .select("*")
        .in("id", componentIds);
      if (componentLoadError) throw componentLoadError;

      const releaseErrors = [];
      for (const component of components || []) {
        try {
          await activateIndividualItem(component);
        } catch (error) {
          releaseErrors.push(`${component.title}: ${error.message}`);
        }
      }

      await logAudit("inventory_bundle_split", "item", item.id, {
        component_ids: componentIds,
        release_errors: releaseErrors,
      });
      setEditingItem(null);
      setEditData(null);
      await loadItems();

      if (releaseErrors.length > 0) {
        alert(
          "The bundle was closed safely, but some individual listings need attention:\n" +
            releaseErrors.join("\n")
        );
      } else {
        alert("Bundle split. The individual books and their labels are now active.");
      }
    } catch (error) {
      await loadItems();
      alert("Could not split this bundle: " + error.message);
    } finally {
      setBundleActionLoading(false);
    }
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

/* Weight capture and estimation were removed from intake.
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
*/

async function saveItem() {
  if (!bookData || isSaving) return;

  setIsSaving(true);
  setAnalysisStatus("Checking inventory...");

  try {
  const itemDraft = {
    title: bookData.title || "",
    curriculum: bookData.curriculum || "",
    publisher: String(bookData.publisher || "").trim(),
    subject: bookData.subject || "",
    grade_level: bookData.grade_level || bookData.grade || "",
    edition: bookData.edition || "",
    isbn: bookData.isbn || "",
    publisher_barcode: bookData.publisher_barcode || "",
    publisher_item_number: normalizePublisherItemNumber(bookData.publisher_item_number),
    category: bookData.category || "",
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
    ai_confidence:
      typeof bookData.confidence === "number" ? bookData.confidence : null,
    public_visible: true,
  };

if ((itemDraft.publisher_item_number || itemDraft.publisher_barcode) && !itemDraft.title.trim()) {
  alert("Enter the title before saving this new barcode. The app will remember it for future scans.");
  return;
}

if (bundleDraft.active) {
  await saveBundleComponent(itemDraft);
  return;
}

let existingItem = null;
let duplicateMatchReason = "";
let exactIsbnMatchDeclined = false;
let exactPublisherMatchDeclined = false;

if ((itemDraft.publisher && itemDraft.publisher_item_number) || itemDraft.publisher_barcode) {
  const publisherQuery = supabase.from("items").select("*");
  const { data: identifierMatches, error: identifierSearchError } = itemDraft.publisher_item_number
    ? await publisherQuery.eq("publisher_item_number", itemDraft.publisher_item_number)
    : await publisherQuery.eq("publisher_barcode", itemDraft.publisher_barcode);

  if (identifierSearchError) {
    alert("Could not check publisher-item duplicates: " + identifierSearchError.message);
    return;
  }

  const candidate = (identifierMatches || []).find((item) =>
    ["Available", "Hold"].includes(item.status || "Available") &&
    (!itemDraft.publisher_item_number || normalizePublisher(item.publisher) === normalizePublisher(itemDraft.publisher))
  );

  if (candidate) {
    const identifierLabel = candidate.publisher_item_number
      ? `${candidate.publisher || "Publisher"} item: ${candidate.publisher_item_number}`
      : `Publisher barcode: ${candidate.publisher_barcode}`;
    const addQuantity = confirm(
      `Matching book barcode found:\n\n${candidate.title}\n${identifierLabel}\n` +
      `SKU: ${candidate.sku}\nCurrent quantity: ${candidate.quantity || 0}\n` +
      `Price: $${Number(candidate.final_price || 0).toFixed(2)}\n\n` +
      `Select OK to add ${itemDraft.quantity || 1} copy/copies to this listing.\n` +
      `Select Cancel to create a separate listing instead.`
    );
    if (addQuantity) {
      existingItem = candidate;
      duplicateMatchReason = candidate.publisher_item_number
        ? "exact_publisher_item"
        : "exact_publisher_barcode";
    } else {
      exactPublisherMatchDeclined = true;
    }
  }
}

const normalizedDraftIsbn = String(itemDraft.isbn || "")
  .toLowerCase()
  .replace(/[^0-9x]/g, "");

if (!existingItem && normalizedDraftIsbn.length >= 10) {
  const { data: isbnCandidates, error: isbnSearchError } = await supabase
    .from("items")
    .select("*")
    .neq("isbn", "");

  if (isbnSearchError) {
    alert("Could not check ISBN duplicates: " + isbnSearchError.message);
    return;
  }

  const exactMatches = (isbnCandidates || [])
    .filter((item) =>
      ["Available", "Hold"].includes(item.status || "Available") &&
      String(item.isbn || "").toLowerCase().replace(/[^0-9x]/g, "") === normalizedDraftIsbn
    )
    .sort((a, b) => {
      const aTitleMatch = normalizeTitle(a.title) === normalizeTitle(itemDraft.title) ? 1 : 0;
      const bTitleMatch = normalizeTitle(b.title) === normalizeTitle(itemDraft.title) ? 1 : 0;
      return bTitleMatch - aTitleMatch;
    });

  if (exactMatches.length > 0) {
    const candidate = exactMatches[0];
    const addQuantity = confirm(
      `Matching ISBN found:\n\n${candidate.title}\nSKU: ${candidate.sku}\n` +
      `Current quantity: ${candidate.quantity || 0}\nPrice: $${Number(candidate.final_price || 0).toFixed(2)}\n\n` +
      `Select OK to add ${itemDraft.quantity || 1} copy/copies to this listing.\n` +
      `Select Cancel to create a separate listing instead.`
    );
    if (addQuantity) {
      existingItem = candidate;
      duplicateMatchReason = "exact_isbn";
    } else {
      exactIsbnMatchDeclined = true;
    }
  }
}

if (!existingItem && !exactIsbnMatchDeclined && !exactPublisherMatchDeclined) {
  const { data: possibleMatches, error: searchError } = await supabase
    .from("items")
    .select("*")
    .eq("curriculum", itemDraft.curriculum)
    .eq("category", itemDraft.category);

  if (searchError) {
    alert("Could not check for an existing item: " + searchError.message);
    return;
  }

  const metadataMatch = (possibleMatches || []).find((item) => {
    if (!["Available", "Hold"].includes(item.status || "Available")) return false;
    const sameTitle = normalizeTitle(item.title) === normalizeTitle(itemDraft.title);
    const sameEdition = String(item.edition || "").trim().toLowerCase() ===
      String(itemDraft.edition || "").trim().toLowerCase();
    const samePrice = Number(item.final_price || 0) === Number(itemDraft.final_price || 0);
    const sameGrade = String(item.grade_level || "").trim().toLowerCase() ===
      String(itemDraft.grade_level || "").trim().toLowerCase();
    return sameTitle && sameEdition && samePrice && sameGrade;
  });

  if (metadataMatch) {
    const addQuantity = confirm(
      `Possible matching book found:\n\n${metadataMatch.title}\nSKU: ${metadataMatch.sku}\n` +
      `Current quantity: ${metadataMatch.quantity || 0}\n\n` +
      `Select OK to add ${itemDraft.quantity || 1} copy/copies to this listing.\n` +
      `Select Cancel to create a separate listing instead.`
    );
    if (addQuantity) {
      existingItem = metadataMatch;
      duplicateMatchReason = "matching_metadata";
    }
  }
}

  if (existingItem) {

    const receivedQuantity = Number(itemDraft.quantity || 1);
    const newQuantity =
      Number(existingItem.quantity || 0) + receivedQuantity;
    const queuedAt = new Date().toISOString();

    const duplicateUpdates = {
      quantity: newQuantity,
      updated_at: queuedAt,
      ...buildDuplicateLabelQueueUpdate(existingItem, receivedQuantity, queuedAt),
    };

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
      duplicate_match_reason: duplicateMatchReason,
      intake_rules: Object.entries(ruleSources).map(([field, source]) => ({
        field,
        rule_id: source.ruleId,
        rule_name: source.ruleName,
      })),
    });

    await recordIntakeHistory(existingItem.id, itemDraft, true);

    await loadItems();

    alert(
      `Existing listing updated to quantity ${newQuantity}. ` +
        `${receivedQuantity} new label${receivedQuantity === 1 ? " was" : "s were"} added to the print queue.`
    );
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
    label_printed: false,
    pending_label_quantity: Number(itemDraft.quantity || 1),
    label_queued_at: new Date().toISOString(),
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

  const { data: insertedItem, error: insertError } = await supabase
    .from("items")
    .insert([itemWithSquareIds])
    .select("id")
    .single();

  if (insertError) {
    alert("Save failed: " + insertError.message);
    return;
  }

  await logAudit("inventory_item_created", "item", itemWithSquareIds.sku, {
    title: itemWithSquareIds.title,
    sku: itemWithSquareIds.sku,
    intake_rules: Object.entries(ruleSources).map(([field, source]) => ({
      field,
      rule_id: source.ruleId,
      rule_name: source.ruleName,
    })),
  });

  await recordIntakeHistory(insertedItem?.id, itemWithSquareIds, false);

  alert("New item saved!");
}

  setBookData(null);
  clearRuleFeedback();
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
    setEditCoverFile(null);
    setEditCoverPreview(null);
    window.setTimeout(() => {
      inventoryEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      inventoryEditorTitleRef.current?.focus({ preventScroll: true });
    }, 0);
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

  if (
    editingItem.status === "Bundled" ||
    (editingItem.item_type === "bundle" &&
      (bundleComponentsByBundleId[String(editingItem.id)] || []).length > 0)
  ) {
    alert("This item is part of a bundle relationship and cannot be deleted. Split the bundle first.");
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

  if (
    bundleParentByComponentId[String(editingItem.id)] &&
    editData.status !== "Bundled"
  ) {
    alert("Split the bundle before making this book individually available.");
    return;
  }

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
      publisher_barcode: editData.publisher_barcode || "",
      publisher_item_number: normalizePublisherItemNumber(editData.publisher_item_number),
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
      "publisher_barcode",
      "publisher_item_number",
      "category",
      "final_price",
      "quantity",
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
      pending_label_quantity: 0,
      label_queued_at: null,
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
    const quantity = Number(item.label_quantity ?? item.quantity ?? 1);

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
      const isBundle = item.item_type === "bundle";
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
      if (isBundle) {
        pdf.setFont("helvetica", "bold");
        pdf.text(
          `SET • ${Number(item.bundle_piece_count || 0)} PIECES`,
          1.92,
          0.14,
          { align: "right" }
        );
      }

      // Title
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(7.5);
      pdf.text(title.substring(0, isBundle ? 38 : 30), 0.08, 0.28);

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

/* Location summaries were removed with location management.
const locationUsageCounts = items.reduce((counts, item) => {
  const normalizedName = normalizeLocationName(item.location);
  if (normalizedName) {
    counts[normalizedName] = (counts[normalizedName] || 0) + Number(item.quantity || 0);
  }
  return counts;
}, {});
const temporaryLocations = locationOptions.filter((location) => location.temporary === true);
const permanentLocations = locationOptions.filter((location) => location.temporary !== true);
const filteredManagedLocations = locationOptions.filter((location) => {
  if (locationListFilter === "temporary") return location.temporary === true;
  if (locationListFilter === "permanent") return location.temporary !== true;
  if (locationListFilter === "active") return location.active !== false;
  if (locationListFilter === "inactive") return location.active === false;
  return true;
});
const staleTemporaryItems = items.filter((item) => {
  if (!item.location || !isTemporaryLocationName(item.location)) return false;
  const timestamp = item.updated_at || item.created_at;
  return timestamp && Date.now() - new Date(timestamp).getTime() > 14 * 24 * 60 * 60 * 1000;
});
*/

const labelItems = items.filter(
  (item) =>
    item.label_printed !== true &&
    getQueuedLabelQuantity(item) > 0 &&
    dateAddedMatches(
      { ...item, created_at: item.label_queued_at || item.created_at },
      labelDateFrom,
      labelDateTo
    )
);

const bundleComponentsByBundleId = bundleComponents.reduce((groups, link) => {
  const key = String(link.bundle_item_id);
  if (!groups[key]) groups[key] = [];
  const component = items.find(
    (item) => String(item.id) === String(link.component_item_id)
  );
  if (component) groups[key].push({ ...component, piece_quantity: link.piece_quantity });
  return groups;
}, {});

const bundleParentByComponentId = bundleComponents.reduce((parents, link) => {
  const parent = items.find((item) => String(item.id) === String(link.bundle_item_id));
  if (parent) parents[String(link.component_item_id)] = parent;
  return parents;
}, {});

const filteredItems = items.filter((item) => {
  const text = `
    ${item.title || ""}
    ${item.curriculum || ""}
    ${item.subject || ""}
    ${item.grade_level || ""}
    ${item.isbn || ""}
    ${item.publisher_barcode || ""}
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
  matchesDateAdded
);
}).sort((a, b) => {
  if (inventorySortBy === "title") {
    return (a.title || "").localeCompare(b.title || "");
  }

  if (inventorySortBy === "quantityLow") {
    return Number(a.quantity || 0) - Number(b.quantity || 0);
  }

  if (inventorySortBy === "quantityHigh") {
    return Number(b.quantity || 0) - Number(a.quantity || 0);
  }

  if (inventorySortBy === "oldest") {
    return new Date(a.created_at || 0) - new Date(b.created_at || 0);
  }

  return new Date(b.created_at || 0) - new Date(a.created_at || 0);
});

const activeInventoryFilterCount = [
  curriculumFilter,
  subjectFilter,
  categoryFilter,
  gradeFilter,
  inventoryDateFrom,
  inventoryDateTo,
  inventorySortBy !== "newest" ? inventorySortBy : "",
].filter(Boolean).length;

const publicItems = items.filter(
  (item) =>
    (item.status || "Available") === "Available" &&
    item.public_visible !== false &&
    (!isAuthenticated || Number(item.quantity || 0) > 0)
);

const activeReservationCountsByItem = bookReservations.reduce((counts, reservation) => {
  if (
    ["pending", "ready"].includes(reservation.status) &&
    new Date(reservation.expires_at).getTime() > Date.now()
  ) {
    const itemId = String(reservation.item_id);
    counts[itemId] = (counts[itemId] || 0) + 1;
  }
  return counts;
}, {});

function getCatalogAvailableQuantity(item) {
  const listedQuantity = Number(item.quantity || 0);
  if (!isAuthenticated) return listedQuantity;
  return Math.max(
    listedQuantity - (activeReservationCountsByItem[String(item.id)] || 0),
    0
  );
}

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

const activeCatalogFilterCount = [
  curriculumFilter,
  subjectFilter,
  categoryFilter,
  gradeFilter,
  sortBy !== "newest" ? sortBy : "",
].filter(Boolean).length;

const staffRequestAttentionCount =
  customerRequestMatches.filter((match) =>
    ["pending", "still_waiting"].includes(match.status)
  ).length +
  bookReservations.filter((reservation) =>
    ["pending", "ready"].includes(reservation.status) &&
    new Date(reservation.expires_at).getTime() > Date.now()
  ).length;

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

const inventorySuggestionEvidence = items.map((item) => ({
  imported_values: {},
  final_values: {
    title: item.title || "",
    author: item.author || "",
    publisher: item.publisher || "",
    curriculum: item.curriculum || "",
    subject: item.subject || "",
    grade_level: item.grade_level || "",
    category: item.category || "",
    final_price: (item.status || "Available") === "Available" ? item.final_price : "",
  },
}));

const automaticRuleSuggestions = isAdmin
  ? (() => {
      const fromHistory = generateRuleSuggestions(
        intakeHistories,
        intakeRules,
        suggestionReviews
      ).map((suggestion) => ({ ...suggestion, evidence_source: "Intake history" }));
      const fromInventory = generateRuleSuggestions(
        inventorySuggestionEvidence,
        intakeRules,
        suggestionReviews
      ).map((suggestion) => ({ ...suggestion, evidence_source: "Existing inventory" }));
      const byKey = new Map();
      for (const suggestion of [...fromHistory, ...fromInventory]) {
        const existing = byKey.get(suggestion.key);
        if (!existing || suggestion.sample_count > existing.sample_count) {
          byKey.set(suggestion.key, suggestion);
        }
      }
      return [...byKey.values()].sort(
        (a, b) => b.confidence - a.confidence || b.sample_count - a.sample_count
      );
    })()
  : [];

const inventoryIsbnInconsistencies = isAdmin
  ? findIsbnInconsistencies(items).filter((issue) => {
      const review = isbnInconsistencyReviews.find((item) => item.isbn === issue.isbn);
      return !review || review.record_signature !== issue.record_signature;
    })
  : [];

const inventorySummaryItems = items.filter((item) => item.status !== "Bundled");
const totalTitles = inventorySummaryItems.length;

const totalCopies = inventorySummaryItems.reduce(
  (sum, item) =>
    sum +
    (item.item_type === "bundle"
      ? Number(item.bundle_piece_count || 0)
      : Number(item.quantity || 0)),
  0
);

const totalValue = inventorySummaryItems.reduce(
  (sum, item) =>
    sum + Number(item.final_price || 0) * Number(item.quantity || 0),
  0
);

const availableCopies = inventorySummaryItems.reduce((sum, item) => {
  if ((item.status || "Available") === "Available") {
    return sum + Number(item.quantity || 0);
  }
  return sum;
}, 0);

const soldCopies = inventorySummaryItems.reduce((sum, item) => {
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
  setCatalogToolsPanel("");
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
  setSortBy("newest");
  setCatalogToolsPanel("");
}

function clearCatalogSearch() {
  setPendingSearchTerm("");
  setSearchTerm("");
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

      <form onSubmit={forgotPasswordOpen ? requestPasswordReset : handleLogin}>
        <label>Email</label>
        <input
          type="email"
          value={loginEmail}
          autoComplete="email"
          onChange={(e) => setLoginEmail(e.target.value)}
        />

        {!forgotPasswordOpen && (
          <>
            <label>Password</label>
            <input
              type="password"
              value={loginPassword}
              autoComplete="current-password"
              onChange={(e) => setLoginPassword(e.target.value)}
            />
          </>
        )}

        {authMessage && <p className="warning-text">{authMessage}</p>}
        {forgotPasswordMessage && (
          <p className="status-message">{forgotPasswordMessage}</p>
        )}
        {forgotPasswordError && (
          <p className="warning-text">{forgotPasswordError}</p>
        )}

        <div className="auth-actions">
          <button
            className="primary"
            type="submit"
            disabled={loginLoading || forgotPasswordLoading}
          >
            {forgotPasswordOpen
              ? forgotPasswordLoading
                ? "Sending..."
                : "Send Reset Link"
              : loginLoading
                ? "Signing In..."
                : "Sign In"}
          </button>
          <button
            className="text-button"
            type="button"
            disabled={loginLoading || forgotPasswordLoading}
            onClick={() => {
              setForgotPasswordOpen((current) => !current);
              setForgotPasswordMessage("");
              setForgotPasswordError("");
              setAuthMessage("");
            }}
          >
            {forgotPasswordOpen ? "Back to sign in" : "Forgot password?"}
          </button>
        </div>
      </form>
    </section>
  );
}

function renderPasswordRecoveryPanel() {
  return (
    <section className="card auth-card">
      <h2>Reset Your Password</h2>
      <p>Choose a new password for your IL HRC team account.</p>

      <form onSubmit={completePasswordRecovery}>
        <label>New Password</label>
        <input
          type="password"
          value={recoveryPassword}
          autoComplete="new-password"
          onChange={(e) => setRecoveryPassword(e.target.value)}
        />

        <label>Confirm Password</label>
        <input
          type="password"
          value={recoveryConfirmPassword}
          autoComplete="new-password"
          onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
        />

        <p className="helper-text">
          Use at least {PASSWORD_MIN_LENGTH} characters.
        </p>

        {recoveryPasswordError && (
          <p className="warning-text">{recoveryPasswordError}</p>
        )}

        <div className="auth-actions">
          <button
            className="primary"
            type="submit"
            disabled={recoveryPasswordLoading}
          >
            {recoveryPasswordLoading ? "Saving..." : "Reset Password"}
          </button>
          <button
            className="secondary"
            type="button"
            disabled={recoveryPasswordLoading}
            onClick={handleLogout}
          >
            Cancel
          </button>
        </div>
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

async function submitPublicCustomerRequest(event) {
  event.preventDefault();
  setPublicRequestSubmitting(true);
  setPublicRequestMessage("");
  const { data, error } = await supabase.rpc("submit_customer_request", {
    p_customer_name: publicRequestDraft.customer_name,
    p_email: publicRequestDraft.email,
    p_phone: publicRequestDraft.phone,
    p_preferred_contact: publicRequestDraft.preferred_contact,
    p_isbn: publicRequestDraft.isbn,
    p_title: publicRequestDraft.title,
    p_author: publicRequestDraft.author,
    p_curriculum: publicRequestDraft.curriculum,
    p_subject: publicRequestDraft.subject,
    p_grade_level: publicRequestDraft.grade_level,
    p_notes: publicRequestDraft.notes,
    p_website: publicRequestDraft.website,
  });
  setPublicRequestSubmitting(false);
  if (error) {
    setPublicRequestMessage(error.message || "We could not save your request. Please try again.");
    return;
  }
  setPublicRequestDraft({ ...EMPTY_CUSTOMER_REQUEST, website: "" });
  setPublicRequestMessage(data
    ? "Your request has been received. We checked current inventory and will contact you if there is a possible match now or after a future arrival."
    : "Your request has been received.");
}

function openPublicRequestForItem(item = null) {
  setPublicRequestDraft((current) => ({
    ...current,
    title: item?.title || current.title,
    isbn: item?.isbn || current.isbn,
    curriculum: item?.curriculum || current.curriculum,
    subject: item?.subject || current.subject,
    grade_level: item?.grade_level || current.grade_level,
  }));
  setPublicRequestMessage("");
  setReservationItem(null);
  setReservationResult(null);
  setPublicRequestOpen(true);
}

async function loadCustomerRequestData() {
  await supabase.rpc("expire_book_reservations");

  const [requestsResult, matchesResult, reservationsResult] = await Promise.all([
    supabase.from("customer_requests").select("*").order("created_at", { ascending: false }),
    supabase.from("customer_request_matches").select("*").order("created_at", { ascending: false }),
    supabase.from("book_reservations").select("*").order("created_at", { ascending: false }),
  ]);

  if (requestsResult.error || matchesResult.error || reservationsResult.error) {
    setCustomerRequestMessage(
      "Could not load customer requests or reservations. Make sure all Supabase migrations have been run."
    );
    return;
  }
  setCustomerRequests(requestsResult.data || []);
  setCustomerRequestMatches(matchesResult.data || []);
  setBookReservations(reservationsResult.data || []);
}

async function createCustomerRequest(event) {
  event.preventDefault();
  if (!customerRequestDraft.email.trim() && !customerRequestDraft.phone.trim()) {
    setCustomerRequestMessage("Enter an email address or phone number.");
    return;
  }
  setCustomerRequestLoading(true);
  setCustomerRequestMessage("");
  const { data: insertedRequest, error } = await supabase.from("customer_requests").insert([{
    ...customerRequestDraft,
    created_by: session?.user?.id || null,
  }]).select("id").single();
  setCustomerRequestLoading(false);
  if (error) {
    setCustomerRequestMessage("Could not save request: " + error.message);
    return;
  }
  setCustomerRequestDraft(EMPTY_CUSTOMER_REQUEST);
  const { count: immediateMatchCount } = await supabase
    .from("customer_request_matches")
    .select("id", { count: "exact", head: true })
    .eq("request_id", insertedRequest.id);
  setCustomerRequestMessage(
    `Customer request saved and current inventory checked. ${Number(immediateMatchCount || 0)} possible ` +
    `match${Number(immediateMatchCount || 0) === 1 ? "" : "es"} found.`
  );
  await loadCustomerRequestData();
}

async function updateCustomerRequestStatus(request, status) {
  const { error } = await supabase.from("customer_requests").update({
    status,
    updated_at: new Date().toISOString(),
  }).eq("id", request.id);
  if (error) setCustomerRequestMessage("Could not update request: " + error.message);
  else await loadCustomerRequestData();
}

async function runCustomerRequestCheck() {
  setCustomerRequestLoading(true);
  setCustomerRequestMessage("Checking queued inventory arrivals...");
  const { data, error } = await supabase.rpc("run_customer_request_matching");
  setCustomerRequestLoading(false);
  if (error) {
    setCustomerRequestMessage("Could not complete the check: " + error.message);
    return;
  }
  setCustomerRequestMessage(`${Number(data || 0)} new possible match${Number(data || 0) === 1 ? "" : "es"} found.`);
  await loadCustomerRequestData();
}

async function updateCustomerMatchStatus(match, status) {
  const updates = {
    status,
    reviewed_by: session?.user?.id || null,
    reviewed_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("customer_request_matches").update(updates).eq("id", match.id);
  if (error) {
    setCustomerRequestMessage("Could not update match: " + error.message);
    return;
  }
  if (status === "fulfilled") {
    await supabase.from("customer_requests").update({ status: "fulfilled", updated_at: new Date().toISOString() }).eq("id", match.request_id);
  }
  await loadCustomerRequestData();
}

async function updateBookReservationStatus(reservation, status) {
  if (
    status === "picked_up" &&
    !confirm("Mark this reservation picked up? This will remove one copy from inventory.")
  ) return;
  if (
    status === "cancelled" &&
    !confirm("Cancel this reservation and return the copy to catalog availability?")
  ) return;

  setCustomerRequestMessage("");
  const { error } = await supabase.rpc("update_book_reservation_status", {
    p_reservation_id: reservation.id,
    p_status: status,
  });
  if (error) {
    setCustomerRequestMessage("Could not update reservation: " + error.message);
    return;
  }
  if (status === "picked_up") await loadItems();
  await loadCustomerRequestData();
}

async function extendBookReservation(reservation) {
  setCustomerRequestMessage("");
  const { error } = await supabase.rpc("extend_book_reservation", {
    p_reservation_id: reservation.id,
    p_days: 7,
  });
  if (error) {
    setCustomerRequestMessage("Could not extend reservation: " + error.message);
    return;
  }
  await loadCustomerRequestData();
}

function openBookReservation(item) {
  setReservationItem(item);
  setReservationDraft(EMPTY_BOOK_RESERVATION);
  setReservationMessage("");
  setReservationResult(null);
  setPublicRequestOpen(false);
}

function closeBookReservation() {
  setReservationItem(null);
  setReservationDraft(EMPTY_BOOK_RESERVATION);
  setReservationMessage("");
  setReservationResult(null);
}

async function submitBookReservation(event) {
  event.preventDefault();
  if (!reservationItem || reservationSubmitting) return;

  setReservationSubmitting(true);
  setReservationMessage("");
  const { data, error } = await supabase.rpc("submit_book_reservation", {
    p_item_id: String(reservationItem.id),
    p_customer_name: reservationDraft.customer_name,
    p_email: reservationDraft.email,
    p_phone: reservationDraft.phone,
    p_preferred_contact: reservationDraft.preferred_contact,
    p_website: reservationDraft.website,
  });
  setReservationSubmitting(false);

  if (error) {
    setReservationMessage(error.message || "We could not reserve this book. Please try again.");
    return;
  }
  if (!data) {
    setReservationMessage("We could not reserve this book. Please try again.");
    return;
  }

  setReservationResult(data);
  setReservationDraft(EMPTY_BOOK_RESERVATION);
  await loadItems();
  if (isAuthenticated) await loadCustomerRequestData();
}

function renderBookReservationForm() {
  if (!reservationItem) return null;

  return (
    <section ref={reservationPanelRef} className="public-request-panel reservation-panel">
      <div className="public-request-heading">
        <div>
          <span className="public-eyebrow">Pickup reservation</span>
          <h2>{reservationResult ? "Your Book Is Reserved" : `Reserve ${reservationItem.title}`}</h2>
          {!reservationResult && (
            <p>We’ll hold one copy for pickup at IL HRC for 14 days. Payment is due when you pick it up.</p>
          )}
        </div>
        <button type="button" className="secondary" onClick={closeBookReservation}>Close</button>
      </div>

      {reservationResult ? (
        <div className="reservation-confirmation">
          <p className="status-message">Your reservation is confirmed.</p>
          <p>
            Please pick up <strong>{reservationResult.title || reservationItem.title}</strong> at IL HRC by{" "}
            <strong>{new Date(reservationResult.expires_at).toLocaleDateString()}</strong>.
          </p>
          <p>Reservation reference: <strong>{String(reservationResult.id).slice(0, 8).toUpperCase()}</strong></p>
          <p className="helper-text">Bring your name or reservation reference when you visit. IL HRC staff may contact you about pickup.</p>
        </div>
      ) : (
        <form onSubmit={submitBookReservation}>
          {reservationMessage && <p className="warning-text">{reservationMessage}</p>}
          <div className="reservation-book-summary">
            <BookCoverImage src={reservationItem.image_url} alt={reservationItem.title} width={120} height={160} eager />
            <div>
              <h3>{reservationItem.title}</h3>
              <p>{[reservationItem.curriculum, reservationItem.subject, reservationItem.grade_level].filter(Boolean).join(" · ")}</p>
              <p><strong>${Number(reservationItem.final_price || 0).toFixed(2)}</strong> · Pickup only</p>
            </div>
          </div>
          <div className="customer-form-grid">
            <div>
              <label>Your Name</label>
              <input required value={reservationDraft.customer_name} onChange={(e) => setReservationDraft((current) => ({ ...current, customer_name: e.target.value }))} />
            </div>
            <div>
              <label>Email</label>
              <input type="email" value={reservationDraft.email} onChange={(e) => setReservationDraft((current) => ({ ...current, email: e.target.value }))} />
            </div>
            <div>
              <label>Phone</label>
              <input value={reservationDraft.phone} onChange={(e) => setReservationDraft((current) => ({ ...current, phone: e.target.value }))} />
            </div>
            <div>
              <label>How should we contact you?</label>
              <select value={reservationDraft.preferred_contact} onChange={(e) => setReservationDraft((current) => ({ ...current, preferred_contact: e.target.value }))}>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="either">Either</option>
              </select>
            </div>
          </div>
          <div className="request-honeypot" aria-hidden="true">
            <label>Website</label>
            <input tabIndex="-1" autoComplete="off" value={reservationDraft.website} onChange={(e) => setReservationDraft((current) => ({ ...current, website: e.target.value }))} />
          </div>
          <p className="helper-text">
            Enter an email address or phone number. Your contact information is used only to manage this reservation.
          </p>
          <button type="submit" className="primary" disabled={reservationSubmitting}>
            {reservationSubmitting ? "Reserving..." : "Confirm Reservation"}
          </button>
        </form>
      )}
    </section>
  );
}

function renderPublicRequestForm() {
  if (!publicRequestOpen) return null;
  return (
    <section className="public-request-panel">
      <div className="public-request-heading">
        <div><h2>Request a Book</h2><p>Tell us what you’re looking for. We’ll contact you if a possible match comes in.</p></div>
        <button type="button" className="secondary" onClick={() => setPublicRequestOpen(false)}>Close</button>
      </div>
      {publicRequestMessage && <p className="status-message">{publicRequestMessage}</p>}
      {!publicRequestMessage && (
        <form onSubmit={submitPublicCustomerRequest}>
          <div className="customer-form-grid">
            <div><label>Your Name</label><input required value={publicRequestDraft.customer_name} onChange={(e) => setPublicRequestDraft((current) => ({...current, customer_name: e.target.value}))} /></div>
            <div><label>Email</label><input type="email" value={publicRequestDraft.email} onChange={(e) => setPublicRequestDraft((current) => ({...current, email: e.target.value}))} /></div>
            <div><label>Phone</label><input value={publicRequestDraft.phone} onChange={(e) => setPublicRequestDraft((current) => ({...current, phone: e.target.value}))} /></div>
            <div><label>How should we contact you?</label><select value={publicRequestDraft.preferred_contact} onChange={(e) => setPublicRequestDraft((current) => ({...current, preferred_contact: e.target.value}))}><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option></select></div>
            <div><label>Book Title</label><input value={publicRequestDraft.title} onChange={(e) => setPublicRequestDraft((current) => ({...current, title: e.target.value}))} /></div>
            <div><label>ISBN, if known</label><input value={publicRequestDraft.isbn} onChange={(e) => setPublicRequestDraft((current) => ({...current, isbn: e.target.value}))} /></div>
            <div><label>Author</label><input value={publicRequestDraft.author} onChange={(e) => setPublicRequestDraft((current) => ({...current, author: e.target.value}))} /></div>
            <div><label>Curriculum</label><input value={publicRequestDraft.curriculum} onChange={(e) => setPublicRequestDraft((current) => ({...current, curriculum: e.target.value}))} /></div>
            <div><label>Subject</label><input value={publicRequestDraft.subject} onChange={(e) => setPublicRequestDraft((current) => ({...current, subject: e.target.value}))} /></div>
            <div><label>Grade Level</label><input value={publicRequestDraft.grade_level} onChange={(e) => setPublicRequestDraft((current) => ({...current, grade_level: e.target.value}))} /></div>
          </div>
          <div className="request-honeypot" aria-hidden="true"><label>Website</label><input tabIndex="-1" autoComplete="off" value={publicRequestDraft.website} onChange={(e) => setPublicRequestDraft((current) => ({...current, website: e.target.value}))} /></div>
          <label>Anything else we should know?</label><textarea value={publicRequestDraft.notes} onChange={(e) => setPublicRequestDraft((current) => ({...current, notes: e.target.value}))} />
          <p className="helper-text">Your contact information is used only to follow up about this request. Submitting a request does not reserve a book.</p>
          <button type="submit" className="primary" disabled={publicRequestSubmitting}>{publicRequestSubmitting ? "Sending..." : "Submit Request"}</button>
        </form>
      )}
    </section>
  );
}

function renderCustomerRequests() {
  const visibleRequests = customerRequests.filter((request) =>
    customerRequestFilter === "all" || request.status === customerRequestFilter
  );
  const pendingMatches = customerRequestMatches.filter((match) =>
    ["pending", "still_waiting"].includes(match.status)
  );
  const requestById = Object.fromEntries(customerRequests.map((request) => [request.id, request]));
  const itemById = Object.fromEntries(items.map((item) => [String(item.id), item]));
  const activeReservations = bookReservations.filter((reservation) =>
    ["pending", "ready"].includes(reservation.status) &&
    new Date(reservation.expires_at).getTime() > Date.now()
  );
  const visibleReservations = bookReservations.filter((reservation) => {
    if (reservationFilter === "active") {
      return ["pending", "ready"].includes(reservation.status) &&
        new Date(reservation.expires_at).getTime() > Date.now();
    }
    return reservationFilter === "all" || reservation.status === reservationFilter;
  });

  return (
    <section className="card customer-requests-page">
      <div className="customer-requests-heading">
        <div><h2>Requests & Reservations</h2><p>Manage pickup reservations and review possible matches for books customers want.</p></div>
        <button type="button" className="primary" onClick={runCustomerRequestCheck} disabled={customerRequestLoading}>
          {customerRequestLoading ? "Checking..." : "Check Now"}
        </button>
      </div>
      {customerRequestMessage && <p className="status-message">{customerRequestMessage}</p>}

      <section className="reservation-staff-section">
        <div className="customer-list-heading">
          <div>
            <h3>
              Pickup Reservations{" "}
              {activeReservations.length > 0 && (
                <span className="options-nav-badge">{activeReservations.length}</span>
              )}
            </h3>
            <p>Each active reservation holds one copy out of the public catalog until pickup or expiration.</p>
          </div>
          <select value={reservationFilter} onChange={(e) => setReservationFilter(e.target.value)}>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="ready">Ready</option>
            <option value="expired">Expired</option>
            <option value="picked_up">Picked Up</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All</option>
          </select>
        </div>

        {visibleReservations.length === 0 && <p>No reservations in this section.</p>}
        <div className="reservation-staff-list">
          {visibleReservations.map((reservation) => {
            const item = itemById[String(reservation.item_id)];
            const isActive = ["pending", "ready"].includes(reservation.status) &&
              new Date(reservation.expires_at).getTime() > Date.now();
            return (
              <article className="reservation-staff-card" key={reservation.id}>
                <div>
                  <span className={`reservation-status ${reservation.status}`}>{reservation.status.replace("_", " ")}</span>
                  <h3>{item?.title || "Reserved book"}</h3>
                  <p><strong>{reservation.customer_name}</strong> · {reservation.preferred_contact}</p>
                  <p>{[reservation.email, reservation.phone].filter(Boolean).join(" · ")}</p>
                  <p>
                    {item?.sku && `SKU ${item.sku} · `}
                    Expires {new Date(reservation.expires_at).toLocaleDateString()}
                  </p>
                  <p className="helper-text">Reference {String(reservation.id).slice(0, 8).toUpperCase()}</p>
                </div>
                <div className="reservation-staff-actions">
                  {reservation.status === "pending" && isActive && (
                    <button type="button" className="primary" onClick={() => updateBookReservationStatus(reservation, "ready")}>Mark Ready</button>
                  )}
                  {reservation.status === "ready" && isActive && (
                    <button type="button" className="primary" onClick={() => updateBookReservationStatus(reservation, "picked_up")}>Picked Up</button>
                  )}
                  {(isActive || reservation.status === "expired") && (
                    <button type="button" className="secondary" onClick={() => extendBookReservation(reservation)}>Extend 7 Days</button>
                  )}
                  {isActive && (
                    <button type="button" className="secondary" onClick={() => updateBookReservationStatus(reservation, "cancelled")}>Cancel</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="customer-match-section">
        <h3>Matches to Review {pendingMatches.length > 0 && <span className="options-nav-badge">{pendingMatches.length}</span>}</h3>
        {pendingMatches.length === 0 && <p>No customer matches need review.</p>}
        {pendingMatches.map((match) => {
          const request = requestById[match.request_id];
          const item = itemById[String(match.item_id)];
          if (!request) return null;
          return (
            <article className="customer-match-card" key={match.id}>
              <div>
                <span className={`match-strength ${match.match_strength}`}>{match.match_strength} match</span>
                <h3>{item?.title || request.title || "Requested book"}</h3>
                <p><strong>{request.customer_name}</strong> · {request.preferred_contact}</p>
                <p>{request.email || request.phone}</p>
                <p>Matched: {(match.match_reasons || []).join(", ")}</p>
                {item && <p>SKU {item.sku} · Qty {item.quantity} · ${Number(item.final_price || 0).toFixed(2)}</p>}
              </div>
              <div className="customer-match-actions">
                {item && <button type="button" className="secondary" onClick={() => setExpandedCustomerMatchId((current) => current === match.id ? "" : match.id)}>{expandedCustomerMatchId === match.id ? "Hide Book" : "View Book"}</button>}
                <button type="button" className="primary" onClick={() => updateCustomerMatchStatus(match, "contacted")}>Mark Contacted</button>
                <button type="button" className="secondary" onClick={() => updateCustomerMatchStatus(match, "fulfilled")}>Fulfilled</button>
                <button type="button" className="secondary" onClick={() => updateCustomerMatchStatus(match, "still_waiting")}>Still Waiting</button>
                <button type="button" className="secondary" onClick={() => updateCustomerMatchStatus(match, "not_match")}>Not a Match</button>
              </div>
              {item && expandedCustomerMatchId === match.id && (
                <section className="customer-match-preview">
                  <BookCoverImage src={item.image_url} alt={item.title} width={240} height={320} eager />
                  <div>
                    <h3>{item.title}</h3>
                    <p><strong>ISBN:</strong> {item.isbn || "Not set"}</p>
                    <p><strong>Author:</strong> {item.author || "Not set"}</p>
                    <p><strong>Publisher:</strong> {item.publisher || "Not set"}</p>
                    <p><strong>Curriculum:</strong> {item.curriculum || "Not set"}</p>
                    <p><strong>Subject:</strong> {item.subject || "Not set"}</p>
                    <p><strong>Grade Level:</strong> {item.grade_level || "Not set"}</p>
                    <p><strong>Category:</strong> {item.category || "Not set"}</p>
                    <p><strong>Edition:</strong> {item.edition || "Not set"}</p>
                    <p><strong>Status:</strong> {item.status || "Available"}</p>
                    <p><strong>SKU:</strong> {item.sku || "Not set"}</p>
                    <p><strong>Quantity:</strong> {item.quantity || 0}</p>
                    <p><strong>Price:</strong> ${Number(item.final_price || 0).toFixed(2)}</p>
                  </div>
                  <div className="customer-request-comparison">
                    <h3>Customer Asked For</h3>
                    <p><strong>Title:</strong> {request.title || "Any"}</p>
                    <p><strong>ISBN:</strong> {request.isbn || "Any"}</p>
                    <p><strong>Author:</strong> {request.author || "Any"}</p>
                    <p><strong>Curriculum:</strong> {request.curriculum || "Any"}</p>
                    <p><strong>Subject:</strong> {request.subject || "Any"}</p>
                    <p><strong>Grade Level:</strong> {request.grade_level || "Any"}</p>
                    {request.notes && <p><strong>Notes:</strong> {request.notes}</p>}
                  </div>
                </section>
              )}
            </article>
          );
        })}
      </section>

      <section className="customer-request-layout">
        <form className="customer-request-form option-panel" onSubmit={createCustomerRequest}>
          <h3>Add Customer Request</h3>
          <label>Customer Name</label><input required value={customerRequestDraft.customer_name} onChange={(e) => setCustomerRequestDraft((current) => ({...current, customer_name: e.target.value}))} />
          <div className="customer-form-grid">
            <div><label>Email</label><input type="email" value={customerRequestDraft.email} onChange={(e) => setCustomerRequestDraft((current) => ({...current, email: e.target.value}))} /></div>
            <div><label>Phone</label><input value={customerRequestDraft.phone} onChange={(e) => setCustomerRequestDraft((current) => ({...current, phone: e.target.value}))} /></div>
          </div>
          <label>Preferred Contact</label><select value={customerRequestDraft.preferred_contact} onChange={(e) => setCustomerRequestDraft((current) => ({...current, preferred_contact: e.target.value}))}><option value="email">Email</option><option value="phone">Phone</option><option value="either">Either</option></select>
          <div className="customer-form-grid">
            <div><label>ISBN</label><input value={customerRequestDraft.isbn} onChange={(e) => setCustomerRequestDraft((current) => ({...current, isbn: e.target.value}))} /></div>
            <div><label>Title Contains</label><input value={customerRequestDraft.title} onChange={(e) => setCustomerRequestDraft((current) => ({...current, title: e.target.value}))} /></div>
            <div><label>Author Contains</label><input value={customerRequestDraft.author} onChange={(e) => setCustomerRequestDraft((current) => ({...current, author: e.target.value}))} /></div>
            <div><label>Curriculum Contains</label><input value={customerRequestDraft.curriculum} onChange={(e) => setCustomerRequestDraft((current) => ({...current, curriculum: e.target.value}))} /></div>
            <div><label>Subject</label><select value={customerRequestDraft.subject} onChange={(e) => setCustomerRequestDraft((current) => ({...current, subject: e.target.value}))}><option value="">Any</option>{subjectOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
            <div><label>Grade Level</label><select value={customerRequestDraft.grade_level} onChange={(e) => setCustomerRequestDraft((current) => ({...current, grade_level: e.target.value}))}><option value="">Any</option>{gradeOptions.map((option) => <option key={option}>{option}</option>)}</select></div>
          </div>
          <label>Notes</label><textarea value={customerRequestDraft.notes} onChange={(e) => setCustomerRequestDraft((current) => ({...current, notes: e.target.value}))} />
          <button type="submit" className="primary" disabled={customerRequestLoading}>Save Request</button>
        </form>

        <section className="customer-request-list">
          <div className="customer-list-heading"><h3>Saved Requests</h3><select value={customerRequestFilter} onChange={(e) => setCustomerRequestFilter(e.target.value)}><option value="active">Active</option><option value="fulfilled">Fulfilled</option><option value="closed">Closed</option><option value="all">All</option></select></div>
          {visibleRequests.length === 0 && <p>No requests in this section.</p>}
          {visibleRequests.map((request) => <article className="customer-request-card" key={request.id}><div><h3>{request.customer_name}</h3><p>{[request.title, request.author, request.curriculum, request.subject, request.grade_level, request.isbn].filter(Boolean).join(" · ")}</p><p>{request.email || request.phone} · {request.status}</p>{request.notes && <p>{request.notes}</p>}</div>{request.status === "active" && <button type="button" className="secondary" onClick={() => updateCustomerRequestStatus(request, "closed")}>Close</button>}</article>)}
        </section>
      </section>
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

        <button className="primary" type="submit" disabled={inviteLoading}>
          {inviteLoading ? "Sending..." : "Send Invitation"}
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
    <main className={`app ${showStaffShell ? "staff-app" : "public-app"}`}>
      {showStaffShell && (
        <aside className="staff-sidebar" aria-label="Staff navigation">
          <div className="staff-sidebar-brand">
            <img
              className="staff-brand-logo"
              src="/ilhrc-logo.png"
              alt="Illinois Homeschool Resource Center"
            />
          </div>

          <nav className="staff-sidebar-nav">
            <button
              type="button"
              className={`staff-nav-link ${view === "add" ? "active" : ""}`}
              aria-current={view === "add" ? "page" : undefined}
              onClick={() => {
                setView("add");
                cancelEditing();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              Add Item
            </button>

            <button
              type="button"
              className={`staff-nav-link ${view === "inventory" ? "active" : ""}`}
              aria-current={view === "inventory" ? "page" : undefined}
              onClick={() => {
                setView("inventory");
                cancelEditing();
                loadItems();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              Inventory
            </button>

            <button
              type="button"
              className={`staff-nav-link staff-nav-subitem ${view === "labels" ? "active" : ""}`}
              aria-current={view === "labels" ? "page" : undefined}
              onClick={() => {
                setView("labels");
                cancelEditing();
                loadItems();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              Print Labels
            </button>

            <button
              type="button"
              className={`staff-nav-link ${view === "requests" ? "active" : ""}`}
              aria-current={view === "requests" ? "page" : undefined}
              onClick={() => {
                setView("requests");
                cancelEditing();
                loadItems();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              <span>Requests & Reservations</span>
              {staffRequestAttentionCount > 0 && (
                <span className="nav-count-badge">{staffRequestAttentionCount}</span>
              )}
            </button>

            {isAdmin && (
              <button
                type="button"
                className={`staff-nav-link ${view === "users" ? "active" : ""}`}
                aria-current={view === "users" ? "page" : undefined}
                onClick={() => {
                  setView("users");
                  cancelEditing();
                }}
              >
                <span className="staff-nav-dot" aria-hidden="true" />
                Team Management
              </button>
            )}

            <button
              type="button"
              className={`staff-nav-link ${view === "curricula" ? "active" : ""}`}
              aria-current={view === "curricula" ? "page" : undefined}
              onClick={() => {
                setView("curricula");
                cancelEditing();
                loadItems();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              Curriculum Lists
            </button>
          </nav>

          <div className="staff-sidebar-settings">
            <button
              type="button"
              className={`staff-nav-link ${view === "options" ? "active" : ""}`}
              aria-current={view === "options" ? "page" : undefined}
              onClick={() => {
                setView("options");
                cancelEditing();
                loadItems();
                loadOptionLists();
              }}
            >
              <span className="staff-nav-dot" aria-hidden="true" />
              Settings
            </button>
          </div>
        </aside>
      )}

      {showStaffShell && (
        <nav className="staff-mobile-nav" aria-label="Primary staff navigation">
          <button
            type="button"
            className={view === "add" ? "active" : ""}
            aria-current={view === "add" ? "page" : undefined}
            onClick={() => {
              setView("add");
              cancelEditing();
            }}
          >
            <StaffNavIcon name="add" />
            <span>Add</span>
          </button>
          <button
            type="button"
            className={view === "inventory" ? "active" : ""}
            aria-current={view === "inventory" ? "page" : undefined}
            onClick={() => {
              setView("inventory");
              cancelEditing();
              loadItems();
            }}
          >
            <StaffNavIcon name="inventory" />
            <span>Inventory</span>
          </button>
          <button
            type="button"
            className={view === "users" ? "active" : ""}
            aria-current={view === "users" ? "page" : undefined}
            aria-label={isAdmin ? "Team" : "Team, admin access required"}
            disabled={!isAdmin}
            onClick={() => {
              setView("users");
              cancelEditing();
            }}
          >
            <StaffNavIcon name="team" />
            <span>Team</span>
          </button>
          <button
            type="button"
            className={view === "curricula" ? "active" : ""}
            aria-current={view === "curricula" ? "page" : undefined}
            onClick={() => {
              setView("curricula");
              cancelEditing();
              loadItems();
            }}
          >
            <StaffNavIcon name="lists" />
            <span>Lists</span>
          </button>
          <button
            type="button"
            className={view === "requests" ? "active" : ""}
            aria-current={view === "requests" ? "page" : undefined}
            onClick={() => {
              setView("requests");
              cancelEditing();
              loadItems();
            }}
          >
            <span className="staff-mobile-nav-icon-wrap">
              <StaffNavIcon name="requests" />
              {staffRequestAttentionCount > 0 && (
                <span className="staff-mobile-nav-badge">
                  {staffRequestAttentionCount}
                </span>
              )}
            </span>
            <span>Requests</span>
          </button>
        </nav>
      )}

      {showStaffShell && (
        <header className="staff-topbar">
          <span className="staff-workspace-label">Staff Workspace</span>
          <div className="staff-account-menu">
            <div className="staff-account-identity">
              <strong>{profile?.full_name || profile?.email || "Signed in"}</strong>
              <span>{profile?.role || "team"}</span>
            </div>
            <button
              className="staff-topbar-action"
              type="button"
              onClick={() => {
                setChangePasswordOpen((current) => !current);
                setChangePasswordError("");
                setChangePasswordMessage("");
              }}
            >
              Account
            </button>
            <button className="staff-topbar-action staff-logout-action" type="button" onClick={handleLogout}>
              Log Out
            </button>
            <button
              className="staff-topbar-action public-catalog-link"
              type="button"
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
        </header>
      )}

      {!showStaffShell && (
        <header className="public-site-header">
          <div className="public-brand">
            <img src="/ilhrc-logo.png" alt="" aria-hidden="true" />
            <span>Illinois Homeschool Resource Center</span>
          </div>

          {!authLoading && (
            <div className="public-header-controls">
              {!session ? (
                <>
                  <nav className="public-nav" aria-label="Public pages">
                    <button
                      className={view === "catalog" ? "active" : ""}
                      type="button"
                      onClick={() => {
                        setView("catalog");
                        setSelectedCatalogItem(null);
                      }}
                    >
                      Browse Books
                    </button>
                    <button
                      className={view === "curricula" ? "active" : ""}
                      type="button"
                      onClick={() => setView("curricula")}
                    >
                      Curriculum Lists
                    </button>
                    <button
                      className="public-header-request"
                      type="button"
                      onClick={() => {
                        setView("catalog");
                        setSelectedCatalogItem(null);
                        openPublicRequestForItem();
                      }}
                    >
                      Request a Book
                    </button>
                  </nav>
                  <button
                    className="secondary staff-sign-in-button"
                    type="button"
                    onClick={() => {
                      setStaffSignInOpen(true);
                      setAuthMessage("");
                    }}
                  >
                    Staff Sign In
                  </button>
                </>
              ) : (
                <div className="account-bar">
                  <span>
                    {isAuthenticated
                      ? `${profile?.full_name || profile?.email || "Signed in"} / ${profile?.role || "profile loading"}`
                      : "Account access not verified"}
                  </span>
                  <div className="account-actions">
                    {isAuthenticated && !shouldShowPasswordSetup && (
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
                </div>
              )}
            </div>
          )}
        </header>
      )}

      {authLoading && (
        <section className="card">
          <p>Checking account access...</p>
        </section>
      )}

      {!authLoading && shouldShowPasswordSetup && renderPasswordSetupPanel()}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        shouldShowPasswordRecovery &&
        renderPasswordRecoveryPanel()}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        !shouldShowPasswordRecovery &&
        profileLoading && (
        <section className="card">
          <p>Loading account profile...</p>
        </section>
      )}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        !shouldShowPasswordRecovery &&
        !profileLoading &&
        !isAuthenticated &&
        staffSignInOpen &&
        renderLoginPanel()}

      {!authLoading &&
        !shouldShowPasswordSetup &&
        !shouldShowPasswordRecovery &&
        isAuthenticated &&
        renderChangePasswordPanel()}

      {!authLoading && authMessage && isAuthenticated && (
        <p className="warning-text">{authMessage}</p>
      )}

   {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "add" && (
  <>
    <section className="staff-page-heading">
      <span>Book Intake</span>
      <h2>Add Item</h2>
      <p>Use the cover photo and ISBN/barcode when available.</p>
    </section>

    <section
      className={`bundle-intake-panel ${
        bundleDraft.active && bundleDraft.source === "intake" ? "active" : ""
      }`}
    >
      <div className="bundle-intake-heading">
        <div>
          <strong>Bundle mode</strong>
          <p>
            {bundleDraft.active && bundleDraft.source === "inventory"
              ? "An inventory bundle is in progress. Return to Inventory to finish or cancel it."
              : bundleDraft.active
              ? "Each saved book will remain in this set until you finish or cancel it."
              : "Create one sellable set while preserving every book's individual SKU and price."}
          </p>
        </div>
        <label className="bundle-toggle">
          <input
            type="checkbox"
            checked={bundleDraft.active && bundleDraft.source === "intake"}
            disabled={
              bundleActionLoading ||
              (bundleDraft.active && bundleDraft.source === "inventory")
            }
            onChange={(event) => {
              if (event.target.checked) {
                startBundle();
              } else if (bundleDraft.components.length > 0) {
                setBundleReviewOpen(true);
              } else {
                setBundleDraft({ ...EMPTY_BUNDLE_DRAFT });
              }
            }}
          />
          <span aria-hidden="true" />
          <b>{bundleDraft.active && bundleDraft.source === "intake" ? "On" : "Off"}</b>
        </label>
      </div>

      {bundleDraft.active && bundleDraft.source === "intake" && (
        <>
          <label>Working set title</label>
          <input
            placeholder="Example: Exploring Countries & Cultures Set"
            value={bundleDraft.title}
            onChange={(event) =>
              setBundleDraft((current) => ({ ...current, title: event.target.value }))
            }
          />

          <div className="bundle-summary">
            <span>
              <strong>{getBundlePieceCount(bundleDraft.components)}</strong> pieces
            </span>
            <span>
              <strong>${getBundleIndividualValue(bundleDraft.components).toFixed(2)}</strong> individual value
            </span>
          </div>

          {bundleDraft.components.length > 0 && (
            <div className="bundle-component-list">
              {bundleDraft.components.map((component) => (
                <div key={component.id}>
                  <span>
                    <strong>{component.title || "Untitled"}</strong>
                    <small>
                      {component.quantity || 1} piece{Number(component.quantity || 1) === 1 ? "" : "s"} · {component.sku} · ${Number(component.final_price || 0).toFixed(2)}
                    </small>
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    disabled={bundleActionLoading}
                    onClick={() => removeBundleDraftComponent(component)}
                  >
                    List separately
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="bundle-actions">
            <button
              type="button"
              className="primary"
              disabled={bundleActionLoading || bundleDraft.components.length < 2}
              onClick={() => setBundleReviewOpen(true)}
            >
              Review & Finish Bundle
            </button>
            <button
              type="button"
              className="secondary"
              disabled={bundleActionLoading}
              onClick={cancelBundle}
            >
              Cancel Bundle
            </button>
          </div>

          {bundleReviewOpen && (
            <div className="bundle-review">
              <div className="bundle-review-heading">
                <div>
                  <strong>Finish bundle listing</strong>
                  <p>Only this bundle will be sellable while its pieces stay linked and protected.</p>
                </div>
                <button type="button" className="text-button" onClick={() => setBundleReviewOpen(false)}>
                  Keep adding
                </button>
              </div>
              <label>Set title</label>
              <input
                value={bundleDraft.title}
                onChange={(event) =>
                  setBundleDraft((current) => ({ ...current, title: event.target.value }))
                }
              />
              <label>Bundle price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={getBundleIndividualValue(bundleDraft.components).toFixed(2)}
                value={bundleDraft.price}
                onChange={(event) =>
                  setBundleDraft((current) => ({ ...current, price: event.target.value }))
                }
              />
              <label>Photo of the complete set (optional)</label>
              <input type="file" accept="image/*" capture="environment" onChange={handleBundleCover} />
              {bundleCoverPreview && (
                <img className="bundle-cover-preview" src={bundleCoverPreview} alt="Bundle preview" />
              )}
              <p className="helper-text">
                Individual value: ${getBundleIndividualValue(bundleDraft.components).toFixed(2)} · Bundle sticker: {getBundlePieceCount(bundleDraft.components)} pieces
              </p>
              <button
                type="button"
                className="primary"
                disabled={bundleActionLoading}
                onClick={finishBundle}
              >
                {bundleActionLoading ? "Creating Bundle..." : "Create Bundle Listing"}
              </button>
            </div>
          )}
        </>
      )}
    </section>

    <div className="intake-actions">
      <button className="secondary" onClick={scanIsbnBarcode}>
        {isScanningBarcode ? "Scanning..." : "Scan Book Barcode"}
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
  onInput={handleCoverPhoto}
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

  {Object.keys(ruleConflicts).length > 0 && (
    <div className="rule-conflict-box">
      <strong>Rule choices need review</strong>
      {Object.entries(ruleConflicts).map(([field, choices]) => (
        <div key={field} className="rule-conflict-row">
          <span>{RULE_OUTPUT_FIELDS.find(([value]) => value === field)?.[1] || field}:</span>
          {choices.map((choice) => (
            <button
              type="button"
              className="secondary"
              key={`${choice.ruleId}-${choice.value}`}
              onClick={() => updateIntakeField(field, choice.value)}
            >
              Use {choice.value} ({choice.ruleName})
            </button>
          ))}
        </div>
      ))}
    </div>
  )}

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
                onChange={(e) => updateIntakeField("title", e.target.value)}
              />

              <label>Curriculum</label>
              <select
              value={
                curriculumOptions.includes(bookData.curriculum)
                  ? bookData.curriculum
                  : "Other"
              }
              onChange={(e) =>
                updateIntakeField("curriculum", e.target.value === "Other" ? "" : e.target.value)
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
                  onChange={(e) => updateIntakeField("curriculum", e.target.value)}
                />

                <p className="helper-text">
                  This will be added to your curriculum list when you save.
                </p>
              </>
            )}

            {ruleSources.curriculum && (
              <p className="rule-source">{getIntakeSourceLabel(ruleSources.curriculum)}</p>
            )}

<label>Publisher</label>
<input
  value={bookData.publisher || ""}
  onChange={(e) => updateIntakeField("publisher", e.target.value)}
/>

              <label>Subject</label>
              <select
              value={bookData.subject || ""}
              onChange={(e) => updateIntakeField("subject", e.target.value)}
            >
              <option value="">Choose subject</option>
              {subjectOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {ruleSources.subject && (
              <p className="rule-source">{getIntakeSourceLabel(ruleSources.subject)}</p>
            )}

           
              <label>Grade Level</label>
              <select
              value={
                gradeOptions.includes(bookData.grade_level || bookData.grade)
                  ? (bookData.grade_level || bookData.grade)
                  : "Other"
              }
              onChange={(e) =>
                updateIntakeField("grade_level", e.target.value === "Other" ? "" : e.target.value)
              }
            >
              <option value="">Choose grade level</option>
              {gradeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {ruleSources.grade_level && (
              <p className="rule-source">{getIntakeSourceLabel(ruleSources.grade_level)}</p>
            )}

          
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
                onChange={(e) => updateIntakeField("isbn", e.target.value)}
              />

              <label>Category</label>
              <select
                value={bookData.category || ""}
                onChange={(e) => {
                  const selected = categoryOptions.find(
                    (item) => item.name === e.target.value
                  );

                 updateIntakeField("category", selected?.name || "", {
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
              {ruleSources.category && (
                <p className="rule-source">{getIntakeSourceLabel(ruleSources.category)}</p>
              )}

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
                onChange={(e) => updateIntakeField("final_price", e.target.value)}
              />
              {ruleSources.final_price && (
                <p className="rule-source">{getIntakeSourceLabel(ruleSources.final_price)}</p>
              )}

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

              {bookData.confidence && (
                <p>
                  <strong>{typeof bookData.confidence === "number" ? "AI Confidence" : "Data Source"}:</strong> {bookData.confidence}
                </p>
              )}

              <button className="primary" onClick={saveItem} disabled={isSaving}>
  {isSaving ? "Saving..." : bundleDraft.active ? "Add Book to Bundle" : "Save Item"}
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

          {bundleDraft.active && bundleDraft.source === "inventory" && (
            <section className="bundle-intake-panel active inventory-bundle-panel">
              <div className="bundle-review-heading">
                <div>
                  <strong>Create bundle from inventory</strong>
                  <p>
                    Choose how many copies of each listing belong in the set. Any remaining copies stay available under their current SKU.
                  </p>
                </div>
                <span className="bundle-badge">
                  {getBundlePieceCount(bundleDraft.components)} pieces
                </span>
              </div>

              <label>Set title</label>
              <input
                placeholder="Example: Grade 4 Literature Set"
                value={bundleDraft.title}
                onChange={(event) =>
                  setBundleDraft((current) => ({ ...current, title: event.target.value }))
                }
              />

              <div className="inventory-bundle-components">
                {bundleDraft.components.map((component) => (
                  <div className="inventory-bundle-component" key={component.id}>
                    <div>
                      <strong>{component.title || "Untitled"}</strong>
                      <small>
                        {component.sku} · ${Number(component.final_price || 0).toFixed(2)} · {component.quantity || 1} available
                      </small>
                    </div>
                    <label>
                      Pieces in set
                      <input
                        type="number"
                        min="1"
                        max={Math.max(1, Number(component.quantity || 1))}
                        value={getBundleComponentQuantity(component)}
                        onChange={(event) =>
                          updateInventoryBundleQuantity(component.id, event.target.value)
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => removeInventoryBundleComponent(component.id)}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="bundle-summary">
                <span>
                  <strong>{getBundlePieceCount(bundleDraft.components)}</strong> pieces
                </span>
                <span>
                  <strong>${getBundleIndividualValue(bundleDraft.components).toFixed(2)}</strong> individual value
                </span>
              </div>

              <label>Bundle price</label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder={getBundleIndividualValue(bundleDraft.components).toFixed(2)}
                value={bundleDraft.price}
                onChange={(event) =>
                  setBundleDraft((current) => ({ ...current, price: event.target.value }))
                }
              />

              <label>Photo of the complete set (optional)</label>
              <input type="file" accept="image/*" capture="environment" onChange={handleBundleCover} />
              {bundleCoverPreview && (
                <img className="bundle-cover-preview" src={bundleCoverPreview} alt="Bundle preview" />
              )}

              <div className="bundle-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={
                    bundleActionLoading ||
                    bundleDraft.components.length < 2 ||
                    getBundlePieceCount(bundleDraft.components) < 2
                  }
                  onClick={finishBundle}
                >
                  {bundleActionLoading ? "Creating Bundle..." : "Create Bundle Listing"}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={bundleActionLoading}
                  onClick={cancelBundle}
                >
                  Cancel
                </button>
              </div>
            </section>
          )}


          {editData && (
            <section ref={inventoryEditorRef} className="card inventory-editor">
              <h2>Edit Item</h2>
              {editingItem?.item_type === "bundle" && (
                <div className="bundle-editor-summary">
                  <strong>Bundle · {editingItem.bundle_piece_count || 0} pieces</strong>
                  <ul>
                    {(bundleComponentsByBundleId[String(editingItem.id)] || []).map((component) => (
                      <li key={component.id}>
                        {component.piece_quantity || component.quantity || 1}× {component.title} · {component.sku}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {bundleParentByComponentId[String(editingItem?.id)] && (
                <p className="bundle-component-notice">
                  This book is protected inside “{bundleParentByComponentId[String(editingItem.id)].title}”.
                  Split the bundle before making it individually available.
                </p>
              )}

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
                ref={inventoryEditorTitleRef}
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

<label>Publisher</label>
<input
  value={editData.publisher || ""}
  onChange={(e) => setEditData({ ...editData, publisher: e.target.value })}
/>

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
                {editData.status === "Bundled" && <option>Bundled</option>}
</select>

<label className="checkbox-label">
  <input
    type="checkbox"
    checked={editData.public_visible !== false}
    disabled={editData.status === "Bundled"}
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

            {editingItem?.item_type === "bundle" &&
              ["Available", "Hold"].includes(editingItem.status || "Available") &&
              Number(editingItem.quantity || 0) > 0 && (
              <button
                className="secondary"
                disabled={bundleActionLoading}
                onClick={() => splitBundle(editingItem)}
              >
                {bundleActionLoading ? "Splitting Bundle..." : "Split Bundle into Individual Listings"}
              </button>
            )}

            <button className="danger" onClick={deleteItem}>
              {isAdmin ? "Delete Item" : "Remove Item"}
            </button>
            </section>
          )}

          <div className="inventory-mobile-tools" aria-label="Inventory tools">
            <button
              type="button"
              className={inventoryToolsPanel === "search" ? "active" : ""}
              aria-expanded={inventoryToolsPanel === "search"}
              aria-controls="inventory-tools-panel"
              onClick={() =>
                setInventoryToolsPanel((current) => current === "search" ? "" : "search")
              }
            >
              <StaffNavIcon name="search" />
              <span>Search</span>
              {searchTerm && <span className="inventory-tool-indicator" aria-label="Search active" />}
            </button>
            <button
              type="button"
              className={inventoryToolsPanel === "filters" ? "active" : ""}
              aria-expanded={inventoryToolsPanel === "filters"}
              aria-controls="inventory-tools-panel"
              onClick={() =>
                setInventoryToolsPanel((current) => current === "filters" ? "" : "filters")
              }
            >
              <StaffNavIcon name="filters" />
              <span>Filters</span>
              {activeInventoryFilterCount > 0 && (
                <span className="inventory-tool-count" aria-label={`${activeInventoryFilterCount} active filters`}>
                  {activeInventoryFilterCount}
                </span>
              )}
            </button>
          </div>

          <div className="inventory-layout">
            <section className="inventory-main">
              <div className="inventory-results-header">
                <p>{filteredItems.length} matching item(s)</p>
              </div>

          {filteredItems.length === 0 && <p>No matching items found.</p>}

          <div className={`inventory-grid ${isSelectionMode ? "selection-mode" : ""}`}>
          {filteredItems.map((item) => (
            <div className={`inventory-item ${item.item_type === "bundle" ? "bundle-item" : ""}`} key={item.id}>
              {isSelectionMode && (
                <label className="item-select">
                  <input
                    type="checkbox"
                    checked={selectedItemIds.includes(item.id)}
                    onChange={() => toggleSelectedItem(item.id)}
                  />
                  <span>Select</span>
                </label>
              )}
              <BookCoverImage src={item.image_url} alt={item.title} />

              <div>
                <h3>{item.title}</h3>
                {item.item_type === "bundle" && (
                  <p className="bundle-badge">Set · {item.bundle_piece_count || 0} pieces</p>
                )}
                {bundleParentByComponentId[String(item.id)] && (
                  <p className="bundle-component-badge">
                    In bundle: {bundleParentByComponentId[String(item.id)].title}
                  </p>
                )}
                <p><strong>SKU:</strong> {item.sku}</p>
<p><strong>Publisher:</strong> {item.publisher || "Unknown"}</p>

<p>
  {item.curriculum} • {item.subject} • {item.grade_level}
</p>
                <p>
                  ${item.final_price} • Qty: {item.quantity}
                </p>
                <p>Status: {item.status}</p>
                  <p><strong>Added:</strong> {formatDateAdded(item.created_at)}</p>
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

            <aside
              id="inventory-tools-panel"
              className={`inventory-sidebar inventory-tools-${inventoryToolsPanel || "closed"}`}
            >
              <div className="inventory-sidebar-heading">
                <h3>{inventoryToolsPanel === "search" ? "Search Inventory" : "Filters"}</h3>
                <button
                  type="button"
                  aria-label="Close inventory tools"
                  onClick={() => setInventoryToolsPanel("")}
                >
                  ×
                </button>
              </div>

              <div className="inventory-search-controls">
                <label>Search</label>
                <input
                  ref={inventorySearchInputRef}
                  type="search"
                  placeholder="Title, ISBN, barcode, SKU..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                  <button
                    type="button"
                    className="filter-reset"
                    onClick={() => setSearchTerm("")}
                  >
                    Clear Search
                  </button>
                )}
              </div>

              <div className="inventory-filter-controls">
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

              <label>Sort By</label>
              <select
                value={inventorySortBy}
                onChange={(e) => setInventorySortBy(e.target.value)}
              >
                <option value="newest">Newest Added</option>
                <option value="oldest">Oldest Added</option>
                <option value="title">Title A-Z</option>
                <option value="quantityLow">Quantity Low-High</option>
                <option value="quantityHigh">Quantity High-Low</option>
              </select>

              {(searchTerm ||
                curriculumFilter ||
                subjectFilter ||
                categoryFilter ||
                gradeFilter ||
                inventoryDateFrom ||
                inventoryDateTo ||
                inventorySortBy !== "newest") && (
                <button
                  type="button"
                  className="filter-reset"
                  onClick={() => {
                    setSearchTerm("");
                    setCurriculumFilter("");
                    setSubjectFilter("");
                    setCategoryFilter("");
                    setGradeFilter("");
                    setInventoryDateFrom("");
                    setInventoryDateTo("");
                    setInventorySortBy("newest");
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

                    {selectedItemIds.length >= 2 && (
                      <button
                        type="button"
                        className="primary selection-bundle-action"
                        disabled={bundleActionLoading}
                        onClick={startInventoryBundle}
                      >
                        Create Bundle from {selectedItemIds.length} Selected
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
                            {isAdmin ? "Delete" : "Remove"}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
              </div>
            </aside>
          </div>
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "options" && (
        <section className="card options-page-card">
          <div className="options-heading">
            <div>
              <h2>Settings</h2>
              <p>Choose a section to manage bookstore settings.</p>
            </div>
          </div>

          <div className="options-layout">
            <nav className="options-nav" aria-label="Options sections">
              <button type="button" className={optionsSection === "lists" ? "active" : ""} onClick={() => setOptionsSection("lists")}>Lists & Pricing</button>
              {isAdmin && <button type="button" className={optionsSection === "rules" ? "active" : ""} onClick={() => setOptionsSection("rules")}>Intake Rules</button>}
              {isAdmin && (
                <button type="button" className={optionsSection === "review" ? "active" : ""} onClick={() => setOptionsSection("review")}>
                  <span>Review Queue</span>
                  {(automaticRuleSuggestions.length + inventoryIsbnInconsistencies.length) > 0 && (
                    <span className="options-nav-badge">{automaticRuleSuggestions.length + inventoryIsbnInconsistencies.length}</span>
                  )}
                </button>
              )}
            </nav>

            <div className="options-content">

          {optionsSection === "lists" && (<>

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

          </>)}

          {isAdmin && (optionsSection === "rules" || optionsSection === "review") && (
            <section className="options-section intake-rules-section">
              <h3>{optionsSection === "review" ? "Review Queue" : "Intake Rules"}</h3>
              {optionsSection === "rules" && <p>Approved rules run after ISBN or cover analysis. More specific rules win; manual intake changes are never replaced.</p>}

              {optionsSection === "review" && (
              <section className="suggested-rules-panel">
                <h3>Suggested Rules</h3>
                <p>
                  Suggestions appear after at least three matching intake records reach 90% consistency.
                  Every suggestion requires administrator approval.
                </p>
                <div className="inventory-analysis-summary">
                  <div>
                    <strong>{items.length}</strong>
                    <span>inventory titles analyzed</span>
                  </div>
                  <div>
                    <strong>{inventoryIsbnInconsistencies.length}</strong>
                    <span>ISBN groups need review</span>
                  </div>
                </div>

                {inventoryIsbnInconsistencies.length > 0 && (
                  <details className="isbn-inconsistencies">
                    <summary>Review same-ISBN inconsistencies</summary>
                    {inventoryIsbnInconsistencies.map((issue) => (
                      <div className="isbn-issue-row" key={issue.isbn}>
                        <div>
                          <strong>{issue.title}</strong>
                          <p>ISBN {issue.isbn} · {issue.record_count} inventory records</p>
                          <p>
                            {Object.entries(issue.differences).map(([field, values]) => {
                              const label = RULE_OUTPUT_FIELDS.find(([key]) => key === field)?.[1] || field;
                              const displayValues = field === "final_price"
                                ? values.map((value) => `$${value}`)
                                : values;
                              return `${label}: ${displayValues.join(" / ")}`;
                            }).join(" · ")}
                          </p>
                        </div>
                        <div className="isbn-issue-actions">
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setExpandedIsbnReview((current) =>
                              current === issue.isbn ? "" : issue.isbn
                            )}
                          >
                            {expandedIsbnReview === issue.isbn ? "Hide Items" : "Review Items"}
                          </button>
                          <button type="button" className="primary" onClick={() => openIsbnMerge(issue)}>
                            Merge Entries
                          </button>
                          <button type="button" className="secondary" onClick={() => dismissIsbnInconsistency(issue)}>
                            Dismiss Match
                          </button>
                        </div>

                        {expandedIsbnReview === issue.isbn && (
                          <div className="isbn-comparison-grid">
                            {getIsbnMergeCandidates(issue).map((item) => (
                              <article className="isbn-comparison-card" key={item.id}>
                                <BookCoverImage src={item.image_url} alt={item.title} />
                                <div>
                                  <h3>{item.title}</h3>
                                  <p><strong>SKU:</strong> {item.sku || "Not set"}</p>
                                  <p><strong>Status:</strong> {item.status || "Available"}</p>
                                  <p><strong>Quantity:</strong> {item.quantity || 0}</p>
                                  <p><strong>Price:</strong> ${Number(item.final_price || 0).toFixed(2)}</p>
                                  <p><strong>Curriculum:</strong> {item.curriculum || "Not set"}</p>
                                  <p><strong>Subject:</strong> {item.subject || "Not set"}</p>
                                  <p><strong>Grade:</strong> {item.grade_level || "Not set"}</p>
                                  <p><strong>Category:</strong> {item.category || "Not set"}</p>
                                  <p><strong>Edition:</strong> {item.edition || "Not set"}</p>
                                  <p><strong>Square:</strong> {item.square_item_id ? "Connected" : "Not connected"}</p>
                                  <button
                                    type="button"
                                    className="secondary"
                                    onClick={() => openIsbnMerge(issue, item.id)}
                                  >
                                    Keep This Record
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </details>
                )}

                {isbnMergeIssue && isbnMergeDraft && (
                  <section ref={isbnMergePanelRef} className="isbn-merge-panel">
                    <div className="isbn-merge-heading">
                      <div>
                        <h3>Merge ISBN {isbnMergeIssue.isbn}</h3>
                        <p>
                          Choose the surviving SKU and confirm the values all copies should use.
                        </p>
                      </div>
                      <button type="button" className="secondary" onClick={closeIsbnMerge} disabled={isbnMergeLoading}>
                        Cancel
                      </button>
                    </div>

                    <label>Surviving Inventory Record</label>
                    <select ref={isbnMergeKeeperRef} value={isbnMergeKeeperId} onChange={(e) => changeIsbnMergeKeeper(e.target.value)}>
                      {getIsbnMergeCandidates(isbnMergeIssue).map((item) => (
                        <option key={item.id} value={String(item.id)}>
                          {item.sku} · {item.title} · ${Number(item.final_price || 0).toFixed(2)} · Qty {item.quantity}
                        </option>
                      ))}
                    </select>

                    <div className="isbn-merge-grid">
                      <div>
                        <label>Title</label>
                        <input value={isbnMergeDraft.title} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, title: e.target.value }))} />
                      </div>
                      <div>
                        <label>Publisher</label>
                        <input value={isbnMergeDraft.publisher} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, publisher: e.target.value }))} />
                      </div>
                      <div>
                        <label>Curriculum</label>
                        <select value={isbnMergeDraft.curriculum} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, curriculum: e.target.value }))}>
                          <option value="">Not set</option>
                          {curriculumOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>Subject</label>
                        <select value={isbnMergeDraft.subject} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, subject: e.target.value }))}>
                          <option value="">Not set</option>
                          {subjectOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>Grade Level</label>
                        <select value={isbnMergeDraft.grade_level} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, grade_level: e.target.value }))}>
                          <option value="">Not set</option>
                          {gradeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>Category</label>
                        <select value={isbnMergeDraft.category} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, category: e.target.value }))}>
                          <option value="">Not set</option>
                          {categoryOptions.map((option) => <option key={option.name} value={option.name}>{option.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label>Edition</label>
                        <input value={isbnMergeDraft.edition} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, edition: e.target.value }))} />
                      </div>
                      <div>
                        <label>Final Price</label>
                        <input type="number" min="0" step="0.01" value={isbnMergeDraft.final_price} onChange={(e) => setIsbnMergeDraft((current) => ({ ...current, final_price: e.target.value }))} />
                      </div>
                      <div>
                        <label>Combined Quantity</label>
                        <input value={isbnMergeDraft.quantity} readOnly />
                      </div>
                    </div>

                    <label className="checkbox-label">
                      <input type="checkbox" checked={isbnMergePrintLabels} onChange={(e) => setIsbnMergePrintLabels(e.target.checked)} />
                      Print replacement labels for all {isbnMergeDraft.quantity} copies after merging
                    </label>

                    <button type="button" className="primary" onClick={mergeDuplicateIsbnEntries} disabled={isbnMergeLoading}>
                      {isbnMergeLoading ? "Merging..." : "Confirm Merge"}
                    </button>
                    {isbnMergeMessage && <p className="status-message">{isbnMergeMessage}</p>}
                  </section>
                )}
                {automaticRuleSuggestions.length === 0 && (
                  <p className="helper-text">No new suggestions yet. More intake history may be needed.</p>
                )}
                {automaticRuleSuggestions.map((suggestion) => (
                  <article className="suggested-rule-card" key={suggestion.key}>
                    <div>
                      <h3>
                        {RULE_INPUT_FIELDS.find(([field]) => field === suggestion.input_field)?.[1] || suggestion.input_field}
                        {suggestion.input_field === "title" ? " equals “" : " contains “"}{suggestion.input_value}{"”"}
                      </h3>
                      <p className="rule-summary">
                        Fill {Object.entries(suggestion.actions).map(([field, value]) => {
                          const label = RULE_OUTPUT_FIELDS.find(([key]) => key === field)?.[1] || field;
                          return `${label}: ${field === "final_price" ? `$${Number(value).toFixed(2)}` : value}`;
                        }).join(", ")}
                      </p>
                      <p>
                        Based on {suggestion.sample_count} records from {suggestion.evidence_source.toLowerCase()} · {Math.round(suggestion.confidence * 100)}% minimum agreement
                      </p>
                    </div>
                    <div className="rule-card-actions">
                      <button type="button" className="primary" onClick={() => approveRuleSuggestion(suggestion)}>
                        Review & Approve
                      </button>
                      <button type="button" className="secondary" onClick={() => reviewRuleSuggestion(suggestion, "deferred")}>
                        Wait for More Data
                      </button>
                      <button type="button" className="secondary" onClick={() => reviewRuleSuggestion(suggestion, "dismissed")}>
                        Dismiss
                      </button>
                    </div>
                  </article>
                ))}
              </section>
              )}

              {optionsSection === "rules" && (<>
              <section
                ref={intakeRuleEditorRef}
                className={`intake-rule-editor ${reviewingSuggestionKey ? "reviewing-suggestion" : ""}`}
              >
                <h3>{editingIntakeRuleId ? "Edit Rule" : "Create Rule"}</h3>

                {reviewingSuggestionKey && (
                  <p className="rule-review-banner">
                    Suggested rule loaded. Review the details below, then select Create Rule to approve it.
                  </p>
                )}

                <label>Rule Name</label>
                <input
                  ref={intakeRuleNameRef}
                  value={intakeRuleDraft.name}
                  onChange={(e) => setIntakeRuleDraft((current) => ({ ...current, name: e.target.value }))}
                  placeholder="Example: Math-U-See materials"
                />

                <label>Description</label>
                <input
                  value={intakeRuleDraft.description}
                  onChange={(e) => setIntakeRuleDraft((current) => ({ ...current, description: e.target.value }))}
                  placeholder="Optional explanation"
                />

                <div className="rule-settings-row">
                  <div>
                    <label>Conditions</label>
                    <select
                      value={intakeRuleDraft.match_mode}
                      onChange={(e) => setIntakeRuleDraft((current) => ({ ...current, match_mode: e.target.value }))}
                    >
                      <option value="all">Match all conditions</option>
                      <option value="any">Match any condition</option>
                    </select>
                  </div>
                  <div>
                    <label>Priority</label>
                    <input
                      type="number"
                      value={intakeRuleDraft.priority}
                      onChange={(e) => setIntakeRuleDraft((current) => ({ ...current, priority: e.target.value }))}
                    />
                  </div>
                </div>

                {intakeRuleDraft.conditions.map((condition, index) => (
                  <div className="rule-condition-row" key={index}>
                    <select
                      aria-label={`Condition ${index + 1} field`}
                      value={condition.field}
                      onChange={(e) => setIntakeRuleDraft((current) => ({
                        ...current,
                        conditions: current.conditions.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, field: e.target.value } : item
                        ),
                      }))}
                    >
                      {RULE_INPUT_FIELDS.map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <select
                      aria-label={`Condition ${index + 1} comparison`}
                      value={condition.operator}
                      onChange={(e) => setIntakeRuleDraft((current) => ({
                        ...current,
                        conditions: current.conditions.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, operator: e.target.value } : item
                        ),
                      }))}
                    >
                      <option value="equals">Equals</option>
                      <option value="contains">Contains</option>
                    </select>
                    <input
                      aria-label={`Condition ${index + 1} value`}
                      value={condition.value}
                      onChange={(e) => setIntakeRuleDraft((current) => ({
                        ...current,
                        conditions: current.conditions.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value: e.target.value } : item
                        ),
                      }))}
                      placeholder="Value to match"
                    />
                    <button
                      type="button"
                      className="secondary"
                      disabled={intakeRuleDraft.conditions.length === 1}
                      onClick={() => setIntakeRuleDraft((current) => ({
                        ...current,
                        conditions: current.conditions.filter((_, itemIndex) => itemIndex !== index),
                      }))}
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <button
                  type="button"
                  className="secondary"
                  onClick={() => setIntakeRuleDraft((current) => ({
                    ...current,
                    conditions: [...current.conditions, { field: "title", operator: "contains", value: "" }],
                  }))}
                >
                  Add Condition
                </button>

                <h3 className="rule-results-heading">Fill These Fields</h3>
                <div className="rule-actions-grid">
                  {RULE_OUTPUT_FIELDS.map(([field, label]) => {
                    if (field === "final_price") {
                      return (
                        <div key={field}>
                          <label>{label}</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={intakeRuleDraft.actions[field] || ""}
                            onChange={(e) => setIntakeRuleDraft((current) => ({
                              ...current,
                              actions: { ...current.actions, [field]: e.target.value },
                            }))}
                            placeholder="No change"
                          />
                        </div>
                      );
                    }
                    const choices = field === "curriculum"
                      ? curriculumOptions
                      : field === "subject"
                        ? subjectOptions
                        : field === "grade_level"
                          ? gradeOptions
                          : categoryOptions.map((item) => item.name);
                    return (
                      <div key={field}>
                        <label>{label}</label>
                        <select
                          value={intakeRuleDraft.actions[field] || ""}
                          onChange={(e) => setIntakeRuleDraft((current) => ({
                            ...current,
                            actions: { ...current.actions, [field]: e.target.value },
                          }))}
                        >
                          <option value="">No change</option>
                          {choices.map((choice) => (
                            <option key={choice} value={choice}>{choice}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={intakeRuleDraft.active}
                    onChange={(e) => setIntakeRuleDraft((current) => ({ ...current, active: e.target.checked }))}
                  />
                  Rule is active
                </label>

                <div className="rule-editor-actions">
                  <button type="button" className="primary" onClick={saveIntakeRule}>
                    {editingIntakeRuleId ? "Save Rule" : "Create Rule"}
                  </button>
                  {(editingIntakeRuleId || reviewingSuggestionKey) && (
                    <button type="button" className="secondary" onClick={resetIntakeRuleDraft}>
                      Cancel
                    </button>
                  )}
                </div>
                {intakeRuleMessage && <p className="status-message">{intakeRuleMessage}</p>}
              </section>

              <div className="intake-rule-list">
                {intakeRules.length === 0 && <p>No intake rules have been created.</p>}
                {intakeRules.map((rule) => {
                  const performance = getIntakeRulePerformance(rule.id);
                  return (
                  <article className={`intake-rule-card ${rule.active ? "" : "inactive"}`} key={rule.id}>
                    <div>
                      <h3>{rule.name}</h3>
                      <p>{rule.description || `${rule.match_mode === "all" ? "All" : "Any"} conditions must match.`}</p>
                      <p className="rule-summary">
                        {(rule.conditions || []).map((condition) =>
                          `${RULE_INPUT_FIELDS.find(([value]) => value === condition.field)?.[1] || condition.field} ${condition.operator} “${condition.value}”`
                        ).join(rule.match_mode === "all" ? " AND " : " OR ")}
                        {" → "}
                        {Object.entries(rule.actions || {}).map(([field, value]) =>
                          `${RULE_OUTPUT_FIELDS.find(([key]) => key === field)?.[1] || field}: ${value}`
                        ).join(", ")}
                      </p>
                      <p className="rule-performance">
                        {performance.applied === 0
                          ? "No tracked uses yet"
                          : `Applied ${performance.applied} times · Accepted ${performance.accepted} · Corrected ${performance.corrected} · ${performance.acceptanceRate}% acceptance`}
                      </p>
                    </div>
                    <div className="rule-card-actions">
                      <button type="button" className="secondary" onClick={() => editIntakeRule(rule)}>Edit</button>
                      <button type="button" className="secondary" onClick={() => toggleIntakeRule(rule)}>
                        {rule.active ? "Disable" : "Enable"}
                      </button>
                      <button type="button" className="danger" onClick={() => deleteIntakeRule(rule)}>Delete</button>
                    </div>
                  </article>
                  );
                })}
              </div>
              </>)}
            </section>
          )}

          {/* Location management was removed from the product.
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
          */}
            </div>
          </div>
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "labels" && (
        <section className="card">
          <h2>Print Labels</h2>

          <p>
            These are items that have not been marked as label printed yet.
          </p>

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

  {(labelDateFrom || labelDateTo) && (
    <button
      type="button"
      className="filter-reset"
      onClick={() => {
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
    generateLabels(
      labelItems.map((item) => ({
        ...item,
        label_quantity: getQueuedLabelQuantity(item),
      }))
    );
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
                {item.item_type === "bundle" && (
                  <p className="bundle-badge">Bundle sticker · {item.bundle_piece_count || 0} pieces</p>
                )}
                <p><strong>SKU:</strong> {item.sku}</p>
                <p><strong>Price:</strong> ${item.final_price}</p>
                <p><strong>Labels queued:</strong> {getQueuedLabelQuantity(item)}</p>
                <p><strong>Category:</strong> {item.category}</p>
                <p><strong>Queued:</strong> {formatDateAdded(item.label_queued_at || item.created_at)}</p>
              </div>
            </div>
          ))}
        </section>
      )}

      {!authLoading && !shouldShowPasswordSetup && isAdmin && view === "users" && renderUserManagement()}

      {!authLoading && !shouldShowPasswordSetup && isAuthenticated && view === "requests" && renderCustomerRequests()}

      {!authLoading && !shouldShowPasswordSetup && view === "curricula" && (
        <CurriculumCatalog
          inventory={items}
          isAuthenticated={isAuthenticated}
          userId={session?.user?.id}
          authFetch={authFetch}
        />
      )}

      {!authLoading && !shouldShowPasswordSetup && view === "catalog" && (
  <section className="card public-catalog">
    <div className="public-catalog-heading">
      <div>
        <h2>Find a Book</h2>
        <p>Browse available books, reserve one for pickup, or ask us to watch for something specific.</p>
      </div>
      {showStaffShell && (
        <button type="button" className="primary" onClick={() => openPublicRequestForItem()}>
          Request a Book
        </button>
      )}
    </div>

    {renderPublicRequestForm()}
    {renderBookReservationForm()}

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
    {selectedCatalogItem.item_type === "bundle" && (
      <>
        <p className="bundle-badge">Complete set · {selectedCatalogItem.bundle_piece_count || 0} pieces</p>
        {selectedCatalogItem.bundle_contents?.length > 0 && (
          <div className="catalog-bundle-contents">
            <strong>Included in this set</strong>
            <ul>
              {selectedCatalogItem.bundle_contents.map((content) => (
                <li key={content}>{content}</li>
              ))}
            </ul>
          </div>
        )}
      </>
    )}

    <p><strong>Curriculum:</strong> {selectedCatalogItem.curriculum || "N/A"}</p>
    <p><strong>Subject:</strong> {selectedCatalogItem.subject || "N/A"}</p>
    <p><strong>Grade Level:</strong> {selectedCatalogItem.grade_level || "N/A"}</p>
    <p><strong>Category:</strong> {selectedCatalogItem.category || "N/A"}</p>
    <p><strong>Edition:</strong> {selectedCatalogItem.edition || "N/A"}</p>
    <p><strong>ISBN:</strong> {selectedCatalogItem.isbn || "N/A"}</p>
    <p><strong>Price:</strong> ${selectedCatalogItem.final_price}</p>
    <p><strong>Available:</strong> {getCatalogAvailableQuantity(selectedCatalogItem)}</p>

    {getCatalogAvailableQuantity(selectedCatalogItem) > 0 ? (
      <>
        <p className="catalog-note">Available in store</p>
        <button type="button" className="primary reservation-button" onClick={() => openBookReservation(selectedCatalogItem)}>
          Reserve for Pickup
        </button>
      </>
    ) : (
      <p className="catalog-note catalog-reserved">Reserved</p>
    )}
  </section>
)}

{!selectedCatalogItem && (
  <>

<div className="catalog-mobile-tools" aria-label="Catalog tools">
  <button
    type="button"
    className={catalogToolsPanel === "search" ? "active" : ""}
    aria-expanded={catalogToolsPanel === "search"}
    aria-controls="catalog-tools-panel"
    onClick={() =>
      setCatalogToolsPanel((current) => current === "search" ? "" : "search")
    }
  >
    <StaffNavIcon name="search" />
    <span>Search</span>
    {searchTerm && <span className="inventory-tool-indicator" aria-label="Search active" />}
  </button>
  <button
    type="button"
    className={catalogToolsPanel === "filters" ? "active" : ""}
    aria-expanded={catalogToolsPanel === "filters"}
    aria-controls="catalog-tools-panel"
    onClick={() =>
      setCatalogToolsPanel((current) => current === "filters" ? "" : "filters")
    }
  >
    <StaffNavIcon name="filters" />
    <span>Filters</span>
    {activeCatalogFilterCount > 0 && (
      <span className="inventory-tool-count" aria-label={`${activeCatalogFilterCount} active filters`}>
        {activeCatalogFilterCount}
      </span>
    )}
  </button>
</div>

<div className="catalog-layout">
  <section className="catalog-main">
    <div className="catalog-results-header">
      <p>{filteredCatalogItems.length} matching item(s)</p>
    </div>

    <div className="catalog-grid">
 {filteredCatalogItems.map((item) => (
        <div className="catalog-item" key={item.id}>
          <BookCoverImage src={item.image_url} alt={item.title} />

          <div>
            <h3>{item.title}</h3>
            {item.item_type === "bundle" && (
              <p className="bundle-badge">Complete set · {item.bundle_piece_count || 0} pieces</p>
            )}

            {item.curriculum && <p>{item.curriculum}</p>}

            <p>
              {item.subject} {item.grade_level && `• ${item.grade_level}`}
            </p>

            <p>
              <strong>${item.final_price}</strong>
            </p>

            {getCatalogAvailableQuantity(item) > 0 ? (
              <>
                <p className="catalog-note">Available in store</p>
                <button
                  type="button"
                  className="primary reservation-button"
                  onClick={() => openBookReservation(item)}
                >
                  Reserve
                </button>
              </>
            ) : (
              <p className="catalog-note catalog-reserved">Reserved</p>
            )}
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

  <aside
    id="catalog-tools-panel"
    className={`catalog-sidebar catalog-tools-${catalogToolsPanel || "closed"}`}
  >
    <div className="catalog-sidebar-heading">
      <h3>{catalogToolsPanel === "search" ? "Search Catalog" : "Filters"}</h3>
      <button
        type="button"
        aria-label="Close catalog tools"
        onClick={() => setCatalogToolsPanel("")}
      >
        ×
      </button>
    </div>

    <div className="catalog-search-controls">
      <label>Search</label>
      <input
        ref={catalogSearchInputRef}
        type="search"
        placeholder="Title, curriculum, subject..."
        value={pendingSearchTerm}
        onChange={(e) => setPendingSearchTerm(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") applyCatalogFilters();
        }}
      />
      <div className="catalog-search-actions">
        <button type="button" className="primary" onClick={applyCatalogFilters}>
          Search
        </button>
        {(pendingSearchTerm || searchTerm) && (
          <button type="button" className="secondary" onClick={clearCatalogSearch}>
            Clear Search
          </button>
        )}
      </div>
    </div>

    <div className="catalog-filter-controls">
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
    </div>
  </aside>
</div>
    </>
)}
  </section>
)}
    </main>
  );
}
