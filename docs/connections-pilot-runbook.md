# IL HRC Connections pilot runbook

This runbook covers the controlled three-month Connections pilot. It does not authorize a production migration, deployment, feature-flag change or public launch. Each production action requires explicit approval after the previous checkpoint passes.

## Release gates

1. **Code checkpoint**
   - `npm run check` passes.
   - `npm run check:connections-readiness` passes.
   - The working tree is clean and the approved branch is pushed.
   - `VITE_CONNECTIONS_ENABLED` remains absent or `false` in production.
2. **Production database checkpoint**
   - Confirm the Supabase dashboard says `main / PRODUCTION` only after staging validation is complete.
   - Confirm a current recoverable production backup and record its timestamp.
   - Apply the versioned Connections migrations in filename order.
   - Keep the public feature flag disabled.
   - Run the anonymous/team/admin matrix against production using fictional validation records.
3. **Content checkpoint**
   - Enter at least 25 stable resources.
   - Personally verify every resource by phone or in person.
   - Record organization visibility consent and consent for every publishable contact field.
   - Have an administrator approve and publish each listing.
   - Confirm private-referral, hidden, expired and unconsented records never appear through public views.
4. **Launch checkpoint**
   - Review the public directory and every detail page on desktop and mobile.
   - Generate a sitemap only from the approved public-safe directory view and the final public HTTPS origin.
   - Deploy with Connections still disabled, smoke-test bookstore/authentication behavior, then obtain separate approval to enable the flag.

## Migration procedure

1. Record the target project name, branch label and project reference without copying credentials into tickets or chat.
2. Verify the target independently in two places in the Supabase dashboard.
3. Apply only unapplied versioned migrations. Never paste a service-role key into frontend configuration.
4. Run each migration transactionally where the platform permits it.
5. Validate public views with the anonymous key and staff functions with real authenticated team/admin roles.
6. Record the migration filenames, time, operator and validation result.

## Safe rollback

Connections migrations are additive. The preferred rollback is operational, not destructive:

1. Set `VITE_CONNECTIONS_ENABLED=false` or restore the previously disabled deployment.
2. Confirm Connections leaves public navigation and direct routes become unavailable without querying Supabase.
3. Pause published Connections resources through administrator controls when a data-level response is needed.
4. Preserve tables and audit history while the issue is investigated.
5. Use the confirmed production backup only for a database-wide emergency. Do not drop Connections tables as a routine rollback.

## Privacy and correction response

- Treat privacy-removal requests as urgent and begin review within 24 hours.
- An administrator pauses the listing first; staff then investigate and document the correction.
- Never copy minor, medical, school-record or referral details into public fields or public notes.
- Internal notes remain in staff-only tables and should contain only information needed for follow-up.
- Withdrawn contact or visibility consent removes public exposure immediately. Preserve an administrative audit record when appropriate.

## Annual verification

- Review the verification-due queue at least monthly.
- Team members may record only phone or in-person verification.
- Confirm availability, visibility, responsible contact, location, worldview statement and each publishable contact field.
- Administrators retain final approval and publication authority.
- Pause overdue or unconfirmed listings until verification and any required reapproval are complete.

## Pilot monitoring

During the three-month pilot, review weekly:

- failed public-view and intake requests;
- correction and privacy-removal response times;
- referral requests awaiting a leader decision;
- listings nearing annual expiration;
- mobile and keyboard accessibility reports;
- bookstore, catalog, invitation and password-recovery regressions.

Do not add events, reviews, accounts, automated matching, maps, sponsorship payments or paid placement during the pilot checkpoint.

## Pilot closeout

At three months, report listing count, usage, corrections, privacy requests, referral outcomes, support burden, defects and accessibility findings. Decide separately whether to continue, revise or disable the pilot before beginning any post-pilot feature.
