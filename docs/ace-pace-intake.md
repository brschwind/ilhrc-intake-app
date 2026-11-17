# ACE PACE intake

Use **ACE PACE Intake** below Scan Barcode, Scan Cover and Manual Entry. The form uses the app's normal white fields and sage buttons, with a Grade / Level dropdown and a Writing Present choice. Edition and physical-condition tracking are not required; new items keep Unknown edition and Not assessed condition internally for schema compatibility. Historical condition information stays intact.

Complete 12-PACE sets show the editable complete-set base price ($8 by default), including while other fields are unfinished. Partial sets use $0.50 per included PACE. Individual no-writing PACEs use $0.75, Score Keys $1, and PACE Tests $0.25. Administrators can adjust these defaults in Settings → Lists & Pricing → ACE resale pricing. Existing final prices do not change.

Take Photo opens a listing camera with a phone-camera fallback. Choose Photo supports an existing image. The whole set has one image and one SKU. Enter a SKU, generate one, or leave it blank to assign the next IL HRC number. A duplicate SKU is rejected without receiving stock.

## Saving and printing

**Save & Add Another** receives inventory into Processing, queues labels, synchronizes Square and prepares the next form. Subject, level, writing and included numbers are retained; photo, SKU, quantity and manual price reset for the next listing. Validation and progress appear beside the save area. A slow inventory refresh does not block the next entry.

Saving adds labels to the existing **Print Queue**. It never creates or downloads a per-listing sticker file. Print queued listings together later using the existing bulk label workflow.

Each sellable set needs one label: one complete 12-PACE set queues one sticker; three identical sets queue three; an 11-PACE partial set queues one. The booklet count never multiplies the number of stickers. Queue changes occur in the same database transaction as receipt. Retrying a receipt or Square sync does not add labels again. Existing queue entries remain untouched.

## Architecture

Existing items, IDs, SKU sequence, image storage, location stock, label queue, checkout, valuation and Square routes are reused. Curriculum → ACE / School of Tomorrow is independent of the app's pricing categories. Structured ace_details stores subject, level, actual PACE numbers, writing, completeness and included supporting materials.

A set is one sellable SKU, with no separately stocked children. The existing bundle type is reserved for assemblies of separately inventoried component records. Labels recognize ACE set metadata and show the enclosed PACE count.

receive_ace_intake atomically creates the catalog record, receives stock into Processing, queues labels, writes an audit record and stores a request receipt for retry protection. The follow-up migration persists the image and optional custom SKU in that transaction. Duplicate lookup serializes metadata to valid JSON before passing it to the Supabase eq filter.

## Verification

Run npm run check. ACE tests cover grade recognition, prices, descriptions, exact Supabase/PostgreSQL JSON matching, safe receipt retries, custom SKUs, photos, one-unit sales and bulk label queue quantities. The isolated browser check exercises save validation, camera capture, duplicate choices, queue-only saving with no downloads, Square retry behavior, keyboard submission, next-entry reset and mobile width without creating real inventory or contacting Square.
