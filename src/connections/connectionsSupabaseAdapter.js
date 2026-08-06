import { createClient } from "@supabase/supabase-js";
import { validatePublicConnectionResource } from "./connectionsModel.js";

export const CONNECTIONS_PUBLIC_VIEWS = Object.freeze({
  directory: "public_connections_directory",
  locations: "public_connection_locations",
  contacts: "public_connection_contacts",
});

export const CONNECTIONS_DIRECTORY_SELECT = [
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
].join(",");

export const CONNECTIONS_LOCATION_SELECT = [
  "resource_slug",
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
].join(",");

export const CONNECTIONS_CONTACT_SELECT = [
  "resource_slug",
  "location_name",
  "kind",
  "label",
  "value",
  "sort_order",
].join(",");

function groupByResourceSlug(rows) {
  return (rows || []).reduce((groups, { resource_slug: resourceSlug, ...publicFields }) => {
    if (!groups.has(resourceSlug)) groups.set(resourceSlug, []);
    groups.get(resourceSlug).push(publicFields);
    return groups;
  }, new Map());
}

function requireSuccessfulQuery(result, viewName) {
  if (result.error) throw new Error(`Connections could not read ${viewName}.`);
  if (!Array.isArray(result.data)) throw new Error(`Connections received an invalid ${viewName} response.`);
  return result.data;
}

export function createConnectionsSupabaseAdapter(client) {
  if (!client?.from) throw new Error("Connections Supabase client is unavailable.");

  return {
    async listResources() {
      const [directoryResult, locationsResult, contactsResult] = await Promise.all([
        client
          .from(CONNECTIONS_PUBLIC_VIEWS.directory)
          .select(CONNECTIONS_DIRECTORY_SELECT)
          .order("name", { ascending: true }),
        client
          .from(CONNECTIONS_PUBLIC_VIEWS.locations)
          .select(CONNECTIONS_LOCATION_SELECT)
          .order("sort_order", { ascending: true }),
        client
          .from(CONNECTIONS_PUBLIC_VIEWS.contacts)
          .select(CONNECTIONS_CONTACT_SELECT)
          .order("sort_order", { ascending: true }),
      ]);

      const directory = requireSuccessfulQuery(directoryResult, CONNECTIONS_PUBLIC_VIEWS.directory);
      const locations = groupByResourceSlug(
        requireSuccessfulQuery(locationsResult, CONNECTIONS_PUBLIC_VIEWS.locations),
      );
      const contacts = groupByResourceSlug(
        requireSuccessfulQuery(contactsResult, CONNECTIONS_PUBLIC_VIEWS.contacts),
      );

      return directory.map((resource) => validatePublicConnectionResource({
        ...resource,
        locations: locations.get(resource.slug) || [],
        contacts: contacts.get(resource.slug) || [],
      }));
    },
  };
}

export function createConnectionsSupabaseAdapterFromEnvironment(environment = {}) {
  const url = environment.VITE_CONNECTIONS_SUPABASE_URL;
  const anonymousKey = environment.VITE_CONNECTIONS_SUPABASE_ANON_KEY;
  if (!url || !anonymousKey) throw new Error("Connections data is not configured for this environment.");

  const client = createClient(url, anonymousKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return createConnectionsSupabaseAdapter(client);
}
