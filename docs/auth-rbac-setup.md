# Authentication and Role Setup

## Security Architecture

The app now uses Supabase Auth email/password sessions. The browser stores the Supabase session, reads the signed-in user's `profiles` row, and sends the Supabase access token to the Express API as `Authorization: Bearer <access-token>`.

Supabase `profiles.role` is authoritative. Frontend state only controls display; backend middleware and database RLS enforce access.

Roles:

- `admin`: full internal access, team management, role changes, account deactivation, audit log, and Square test/config endpoints.
- `team`: normal intake, inventory, editing, deletion/removal, label printing, option workflows, and Square item sync used by bookstore operations.
- public visitors: public catalog only, using the safe `public_catalog_items` view.

## Files Changed

- `src/App.jsx`: session loading, login/logout, protected internal views, role-aware navigation, admin team management, authenticated backend calls, public catalog data split.
- `src/App.css`: account/login/user-management styling.
- `server/server.js`: Supabase token validation, active-profile checks, role middleware, admin user endpoints, audit endpoint, protected Square/OpenAI routes, safer CORS/body limits.
- `server/package.json` and `server/package-lock.json`: backend Supabase dependency.
- `supabase/migrations/20260711120000_auth_rbac.sql`: profiles, audit logs, public catalog view, helper functions, RLS policies.
- `.gitignore`: ignores local npm cache folders.

## Environment Variables

Frontend on Vercel:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_API_BASE_URL`, for example `https://ilhrc-intake-app.onrender.com`

Backend on Render:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_INVITE_REDIRECT_URL`, for example your Vercel app URL
- `ALLOWED_ORIGINS`, comma-separated, for example `https://your-vercel-app.vercel.app,http://localhost:5173`
- Existing `OPENAI_API_KEY`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_ENVIRONMENT`

Never put `SUPABASE_SERVICE_ROLE_KEY`, Square secrets, or OpenAI keys in Vercel frontend variables.

## Supabase Setup

1. Apply `supabase/migrations/20260711120000_auth_rbac.sql` in Supabase SQL editor or through the Supabase CLI.
2. In Authentication settings, keep public signups disabled.
3. Enable email/password auth.
4. Configure the Site URL and Redirect URLs to include the Vercel URL and local dev URL.
5. Confirm the `book-covers` storage bucket remains public if the public catalog should show cover images.

## First Admin

1. In Supabase Dashboard, create the first Auth user manually with email and password.
2. Copy that user's Auth UID.
3. Run this SQL, replacing the values:

```sql
insert into public.profiles (id, email, full_name, role, is_active)
values (
  'AUTH_USER_ID_HERE',
  'admin@example.org',
  'Admin Name',
  'admin',
  true
)
on conflict (id) do update
set role = 'admin',
    is_active = true,
    email = excluded.email,
    full_name = excluded.full_name,
    updated_at = now();
```

4. Sign in from the app. The Team Management page should appear in navigation.

## Creating Team Accounts

1. Sign in as an active Admin.
2. Open Team Management.
3. Enter name, email, and role.
4. Send the invitation.
5. The user follows the Supabase invite email and sets their password.

## Route and Endpoint Matrix

Frontend views:

- Public: `catalog`
- Team/Admin: `add`, `inventory`, `labels`, `options`
- Admin only: `users`

Backend endpoints:

- Public: `GET /`
- Team/Admin: `POST /analyze-book`, `POST /create-square-item`, `POST /update-square-item`, `POST /update-square-inventory`, `POST /archive-square-item`, `POST /unarchive-square-item`, `GET /auth/me`
- Admin only: `GET /test-square`, `GET /test-square-item`, `GET /admin/users`, `POST /admin/users/invite`, `PATCH /admin/users/:id`, `GET /admin/audit-logs`

Database:

- Public: `select` from `public_catalog_items`; option-name reads for catalog filters.
- Team/Admin: active authenticated users can read/write normal inventory workflow tables.
- Admin: profiles management and audit-log reading.

## Limitations and Follow-Up

- The React app is still a single large component with view-based navigation. Auth is enforced, but a future pass should split routes/components for maintainability.
- Audit logging is implemented for user-management actions. Inventory edit/delete audit logging should be added next near each Supabase inventory mutation.
- The frontend still performs many direct Supabase writes. RLS now protects them, but moving sensitive workflows fully behind Express endpoints would make audit logging and validation stronger.
- `npm audit` reports one high-severity backend dependency vulnerability. Review with `npm audit` before production release.

## Verification

- `npm run lint` passes with existing React hook dependency warnings.
- `npm run build` succeeds. Vite reports the existing large chunk-size warning.
