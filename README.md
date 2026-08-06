# ILHRC Intake App

Inventory intake, public catalog, curriculum matching, reservations, label printing, and staff administration for ILHRC. The frontend is a React/Vite app backed by Supabase; protected integrations and administrative operations run through the Express server in `server/`.

## Requirements

- Node.js 24 or a current Node.js LTS release
- A Supabase project with the migrations in `supabase/migrations/` applied

Install both dependency sets:

```sh
npm install
npm --prefix server install
```

## Local configuration

Create a root `.env` file for browser-safe settings:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_BASE_URL=http://localhost:5001
VITE_GOOGLE_BOOKS_API_KEY=
```

Create `server/.env` for server-only credentials:

```dotenv
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_INVITE_REDIRECT_URL=http://localhost:5173
ALLOWED_ORIGINS=http://localhost:5173
OPENAI_API_KEY=
SQUARE_ACCESS_TOKEN=
SQUARE_LOCATION_ID=
SQUARE_ENVIRONMENT=sandbox
```

The model overrides `CURRICULUM_IMPORT_MODEL` and `CURRICULUM_LINK_MODEL` are optional. Never expose service-role, OpenAI, or Square secrets through a `VITE_` variable.

For authentication roles, security policies, and first-admin setup, see [docs/auth-rbac-setup.md](docs/auth-rbac-setup.md).

## Run locally

Start the API in one terminal:

```sh
npm --prefix server start
```

Start the frontend in another:

```sh
npm run dev
```

The frontend runs at `http://localhost:5173`; the API runs at `http://localhost:5001`.

## Validate changes

Run the complete local quality gate before committing:

```sh
npm run check
```

This runs ESLint, all frontend and server tests, and the production build. The individual commands are `npm run lint`, `npm test`, and `npm run build`.

## Project map

- `src/` — React UI and shared business logic
- `server/` — Express API, protected integrations, and server tests
- `supabase/migrations/` — versioned database schema and policy changes
- `docs/` — operational and security setup notes
- `public/` — static images and icons

Generated output and local credentials are excluded from Git. Commit database changes as new timestamped migrations; do not edit an already-applied migration.
