export const CONNECTIONS_DISCLOSURES = {
  verification:
    "Every resource listed in IL HRC Connections has been personally contacted by an IL HRC team member, reviewed for consistency with our inclusion standards and confirmed within the past year.",
  disclaimer:
    "Inclusion indicates that IL HRC believes the resource may be valuable to homeschool families. It does not guarantee every experience, verify every claim or indicate agreement with every belief, policy or practice of the listed organization. Families remain responsible for determining whether a resource is appropriate for them.",
  worldview:
    "Religious-affiliation information is provided by the organization and is not independently verified by IL HRC.",
};

export const PUBLIC_RESOURCE_FIELDS = Object.freeze([
  "slug",
  "name",
  "short_description",
  "description",
  "worldview",
  "worldview_details",
  "age_min",
  "age_max",
  "grade_min",
  "grade_max",
  "age_grade_notes",
  "delivery_mode",
  "accepting_status",
  "cost_type",
  "homeschool_specific",
  "daytime_available",
  "homeschool_discount",
  "service_area_summary",
  "visibility",
  "last_verified_on",
  "primary_category_slug",
  "primary_category_name",
  "primary_city",
  "primary_county",
  "category_slugs",
  "tag_slugs",
  "updated_at",
  "locations",
  "contacts",
]);

export const PUBLIC_LOCATION_FIELDS = Object.freeze([
  "name",
  "location_kind",
  "address_line_1",
  "address_line_2",
  "city",
  "county",
  "state",
  "postal_code",
  "service_area",
  "is_primary",
  "sort_order",
]);

export const PUBLIC_CONTACT_FIELDS = Object.freeze([
  "location_name",
  "kind",
  "label",
  "value",
  "sort_order",
]);

const VISIBILITIES = new Set(["public", "limited"]);
const DELIVERY_MODES = new Set(["in_person", "online", "hybrid", "traveling"]);

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source?.[field] !== undefined).map((field) => [field, source[field]]));
}

export function toPublicConnectionResource(source) {
  const resource = pick(source, PUBLIC_RESOURCE_FIELDS);
  resource.category_slugs = Array.isArray(resource.category_slugs) ? [...resource.category_slugs] : [];
  resource.tag_slugs = Array.isArray(resource.tag_slugs) ? [...resource.tag_slugs] : [];
  resource.locations = Array.isArray(resource.locations)
    ? resource.locations.map((location) => pick(location, PUBLIC_LOCATION_FIELDS))
    : [];
  resource.contacts = Array.isArray(resource.contacts)
    ? resource.contacts.map((contact) => pick(contact, PUBLIC_CONTACT_FIELDS))
    : [];
  return resource;
}

export function validatePublicConnectionResource(source) {
  const resource = toPublicConnectionResource(source);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resource.slug || "")) throw new Error("Connections fixture has an invalid slug.");
  if (!String(resource.name || "").trim()) throw new Error("Connections fixture requires a name.");
  if (!String(resource.short_description || "").trim()) throw new Error("Connections fixture requires a short description.");
  if (!VISIBILITIES.has(resource.visibility)) throw new Error("Connections fixture has a non-public visibility.");
  if (!DELIVERY_MODES.has(resource.delivery_mode)) throw new Error("Connections fixture has an invalid delivery mode.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(resource.last_verified_on || "")) throw new Error("Connections fixture requires a verification date.");
  return Object.freeze(resource);
}

function normalizedText(value) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function filterConnections(resources, filters = {}) {
  const keyword = normalizedText(filters.keyword);
  return resources.filter((resource) => {
    const searchable = [
      resource.name,
      resource.short_description,
      resource.description,
      resource.primary_category_name,
      resource.primary_city,
      resource.primary_county,
      resource.service_area_summary,
      ...(resource.tag_slugs || []),
    ].map(normalizedText).join(" ");

    const matchesKeyword = !keyword || searchable.includes(keyword);
    const matchesCategory = !filters.category || resource.category_slugs?.includes(filters.category);
    const matchesLocation =
      !filters.location ||
      [resource.primary_city, resource.primary_county].some(
        (value) => normalizedText(value) === normalizedText(filters.location),
      );
    const matchesDelivery = !filters.delivery || resource.delivery_mode === filters.delivery;
    return matchesKeyword && matchesCategory && matchesLocation && matchesDelivery;
  });
}

export function findConnectionBySlug(resources, slug) {
  return resources.find((resource) => resource.slug === slug) || null;
}

export function connectionCategoryOptions(resources) {
  const options = new Map();
  resources.forEach((resource) => {
    if (resource.primary_category_slug && resource.primary_category_name) {
      options.set(resource.primary_category_slug, resource.primary_category_name);
    }
  });
  return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
}

export function connectionLocationOptions(resources) {
  const values = new Set();
  resources.forEach((resource) => {
    if (resource.primary_city) values.add(resource.primary_city);
    if (resource.primary_county) values.add(resource.primary_county);
  });
  return [...values].sort((a, b) => a.localeCompare(b));
}

export function formatConnectionValue(value) {
  return String(value || "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
