# ACE PACE intake

The intake page has an **ACE PACE Intake** button. Complete unused 12-PACE sets default to $8, or $5 when **Older-edition pricing category** is selected. Unknown editions do not automatically receive the older-edition discount. Partial sets use $0.50 per enclosed PACE. Used complete sets, Test Keys, teacher manuals, other resources, and nonstandard complete sets require a manual selling price.

Select subject and level, enter an edition or keep Unknown, confirm all student PACEs are present, identify any bundled tests or Score Keys, and enter the number of identical sets. The preview displays the entire bundle price. **Save & Add Another** retains subject, edition, condition, and included numbers. For a different partial set, change the checkboxes before saving. Keys sold separately use **Score Key** individual intake, with one PACE number and their own quantity and price. Compatibility defaults to Unknown; select Confirmed matching only after checking editions.

Administrators can adjust defaults in **Settings → Lists & Pricing → ACE resale pricing**. Changes affect future suggestions; existing final selling prices remain unchanged.

## Inventory architecture

- Existing `items` records, IDs, SKU sequence, labels, location stock, reservations, valuation, and Square integrations are reused.
- `primary_category` and `subcategory` store Curriculum → ACE / School of Tomorrow independently of the existing pricing categories. The existing ACE curriculum name is reused; no category-option duplicates are inserted.
- `ace_details` stores actual included numbers, level, edition, condition, writing, material type, completeness, supporting materials, and compatibility as JSONB. Main inventory search examines every included number; the ACE filter panel supports subject, level, number, completeness, edition, material type, and condition.
- A set is a single sellable SKU (`item_type = individual`) containing multiple booklets. The existing `bundle` type is reserved for assemblies of separately inventoried component SKUs that can be split. ACE sets have no separately stocked child records, so that split workflow does not apply. `ace_details.materialType` identifies complete and partial sets.
- `receive_ace_intake` creates the record and receives units into Processing in one database transaction, queues labels, and writes an audit record. Exact duplicate increases are rechecked under a row lock, including the final selling price. Separate listings are always permitted.
- A request receipt prevents repeated delivery of the same request from receiving stock twice. Square sync runs after the database transaction. If it fails, the saved receipt remains onscreen with **Retry Square Sync**; retrying does not receive stock again. Catalog creation uses a stable ACE SKU idempotency key. Avoid closing the form while a sync retry is pending.
- Each set is one stock unit: three sets have quantity 3, and selling one set removes 1. The final selling price is the whole bundle price used by valuation and Square.

## Rollout

Apply `supabase/migrations/20261117140000_ace_pace_intake.sql` after the existing migrations, then deploy the frontend and server together. This migration adds columns and ACE-only tables/functions; it does not reclassify, reprice, or change existing stock. Staff can read ACE pricing; only administrators can update it. The form reports unavailable setup if the migration has not been applied.

Run `npm run check`. Tests in `src/acePace.test.js` cover recognition, prices, listing accuracy, compatibility, partial sets, custom numbering, and search. `src/acePaceMigration.test.js` executes the new migration against PostgreSQL through PGlite with existing location inventory functions, checking ordinary-stock preservation, intake quantity, duplicate increments, request retries, and one-set sales through the existing allocation function. Before production rollout, verify the form and Square integration in a configured staging environment.


## Revised intake layout and stickers

ACE intake opens inline below Scan Barcode, Scan Cover, and Manual Entry, using the app's normal white fields and sage buttons. Grade / Level is a dropdown. Edition tracking and older-edition pricing controls are absent from intake; new listings keep Unknown edition internally for compatibility with existing records.

Take Photo opens a live listing camera, with a native phone-camera fallback. Choose Photo also supports an existing image. The listing image uses the existing book-covers storage bucket. SKU may be entered manually or generated with the existing SKU sequence; leaving it blank assigns one when saved. A SKU already in use is rejected without receiving stock. Increasing a matching listing keeps that listing's SKU.

Saving generates the existing 2 x 1-inch sticker PDF, with one label per received sellable unit. A complete 12-PACE set needs one label; three identical sets need three labels. Reprinting is available on the saved receipt and after Save & Add Another. Existing label queues remain available. The follow-up migration extends the same receipt transaction to persist the image and custom SKU.

The GitHub validation branch runs database/unit tests, changed-file lint, a build, and a headless browser check with a simulated camera. It does not create real inventory or contact Square.
