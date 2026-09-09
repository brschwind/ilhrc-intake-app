# Location-aware inventory implementation

## Existing architecture found

- `public.items` is the catalog/listing and unique SKU entity. Physical copies were represented by `items.quantity`, with one optional `items.location` string.
- Intake, item editing, bundles, reservations, Square inventory synchronization, public catalog views, reports, label queues, and curriculum matching all read or write that quantity.
- `location_options` is an existing managed dropdown, not a quantity-bearing inventory model.
- Curriculum is normalized into publishers, packages, materials, and package items. `curriculum_inventory_matches` supports multiple material links per inventory item; package items already hold requirement, audience, quantity, and material-type metadata.
- Active staff authorization uses profiles with `admin` or `team` roles. Both roles currently perform inventory work; admin-only controls remain separate.

## Implemented model and migration

Migration `20260908120000_location_aware_inventory.sql` adds:

- `inventory_locations`: physical shelves and operational locations, stable `LOCATION:<CODE>` scan values, active state, and verification timestamps.
- `inventory_by_location`: one non-negative quantity per item/location, enforced by a unique constraint.
- `inventory_scan_sessions`, `inventory_scan_events`, and `inventory_audit_observations`: idempotent session scanning and audit staging.
- `inventory_events`: durable who/when/from/to/why history with non-cascading text item references.
- `inventory_item_totals` and `inventory_location_details`: calculated totals and display-ready locations.
- `items.needs_catalog_review`: marks intentionally incomplete Quick Add records.

Existing rows are backfilled without deletion. Recognizable shelf codes retain their shelf, other named locations become legacy locations, and missing locations go to `UNVERIFIED_LEGACY`. Existing `items.quantity` remains temporarily as a trigger-maintained compatibility cache; the per-location rows are authoritative. Legacy quantity increases enter `UNVERIFIED_LEGACY`. A legacy decrease that would require guessing which verified shelf lost stock is rejected.

## Atomic operations

Database functions implement staff authorization and transactions for scan lookup, session start/cancel, intake/shelving/audit scans, undo, manual adjustment, explicit stock moves, shelf reconciliation, recommendation ranking, and non-destructive item removal. Move Stock locks its source and rejects an overdraw. Audit reconciliation only changes the selected shelf and then stamps `last_verified_at`.

The removal action now zeros each known location, records removal events, and archives the catalog record instead of deleting it. Existing inventory history remains intact.

## Staff UI

The new **Scan & Locate** workspace provides:

- distinct Intake, Shelving, and Shelf Audit modes;
- a prominent destination shelf and `LOCATION:A1` parsing;
- duplicate scan counting, recent scans, session count, undo, and safe cancellation;
- Quick Add with generated SKU, hidden public state, and incomplete-metadata marker;
- staff-approved shelving recommendations with reasons and override history;
- expected/observed/difference review before shelf reconciliation;
- explicit atomic Move Stock and manual adjustment controls;
- books-awaiting-shelving count, shelf verification state, and shelf creation;
- title/ISBN/SKU/curriculum/publisher/location search with totals and all locations;
- recent movement/adjustment history.

## Recommendation logic

Recommendations rank exact SKU shelf quantities first, then locations concentrated among confirmed items from any shared curriculum package, then category/subject/publisher similarity, then Needs Review. No recommendation commits until staff approves it.

## Permissions

All new tables use row-level security. Active `admin` and `team` profiles may scan, quick-add, move, adjust, reconcile, archive, and manage locations. RPC execution is revoked from anonymous/public callers. This keeps the operations role-restrictable later without changing the inventory schema.

## Automated coverage

Tests cover duplicate intake scans, multi-location totals, Processing-to-shelf shelving, discovering another location, valid and invalid moves, duplicate audit scans, audit reduction, missing-item zeroing, cross-shelf isolation, verification timestamps, audit history, recommendation priority, stable location scan parsing, and non-destructive removal.

## Known transition limitations

- `items.quantity` and `items.location` cannot be dropped yet because Square, reservation, bundle, label, and public-catalog code still consumes them. They are derived compatibility fields, and the migration prevents them from silently disagreeing with location totals.
- Square knows the store but not the shelf. While unverified legacy stock remains, legacy Square decrements consume that pool. Once a SKU is fully shelf-verified, an unlocated Square decrement is intentionally rejected instead of guessing a shelf. A later checkout/removal workflow must capture the source shelf before the compatibility bridge can be removed.
- The scan field is optimized for keyboard-emulating barcode scanners and phone/tablet input. It does not yet reuse the app's camera barcode overlay.
- Existing `location_options` remains for old screens during transition. New inventory locations are managed in Scan & Locate; a later cleanup can retire the old dropdown after every writer is migrated.

## Staging validation

1. Take a staging database backup and record counts/sums from `items` before applying the migration.
2. Apply migrations to staging only. Confirm no production project/environment variables are selected.
3. Compare every nonzero legacy item against `inventory_item_totals`; totals must match the pre-migration quantity.
4. Confirm missing legacy locations are in `UNVERIFIED_LEGACY`, named shelf codes are `Never audited`, and operational locations exist.
5. Sign in as a `team` volunteer and an `admin`; confirm both can open Scan & Locate. Confirm anonymous and inactive users cannot read the new tables or invoke RPCs.
6. Create test shelves A1, A2, A3, B2, B4, C1, C3, and F2. Print/scan values such as `LOCATION:A1`.
7. Execute the 16 acceptance scenarios in the feature request, checking `inventory_events` after each mutation.
8. During an A3 audit, confirm inventory does not change before approval and B4 quantities remain unchanged afterward.
9. Test Quick Add in Intake and Shelf Audit modes, then confirm the item is hidden publicly and marked for catalog review.
10. Exercise a staging Square sale, reservation pickup, bundle creation/split, label queue, public catalog, and item archive. Pay particular attention to a fully verified SKU with no unverified stock because source-shelf capture is the documented transition boundary.
11. Run `node --test src/*.test.js server/*.test.js`, the local ESLint executable, and the Vite production build.

No production migrations, deployments, or data changes were made by this implementation.
