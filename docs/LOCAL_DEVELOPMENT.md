# Running Bab-ul-Ilm locally

The projects are independent Git repositories:

```text
E:\Personal\BabulilmServer\
  server\  # NestJS backend, its own .git and package.json
  web\     # Next.js frontend, its own .git and package.json
```

There is no combined repository or shared dependency installation. The frontend
was downloaded as a ZIP, so its initialized repository has no upstream history
yet. Its origin points to `https://github.com/babulilmvirtualschool/web.git`.
Fetching or pushing still requires the GitHub account with access.

## Open the project

- Website: http://localhost:3000
- Login: http://localhost:3000/lms/login
- API: http://localhost:4000/api/v1
- Swagger: http://localhost:4000/api/docs
- Database health: http://localhost:4000/api/v1/health/db

Initial local login: **admin@babulilm.local** (or **admin**) / **ChangeMe123!**.
These are local seed defaults; actual seed values are configured in `server/.env`.
Changing seed settings does not overwrite an existing user's password.

## Start or stop on Windows

Node 20.12+ is required for the local helper scripts. This machine uses Node 24.
Run from `server/` in PowerShell:

```powershell
.\scripts\Start-Local.ps1
```

The launcher starts portable PostgreSQL and local upload storage, generates the
Prisma client, applies checked-in migrations, ensures the initial seed data,
and starts both development servers in the background. Run it again to reuse
already running services. No administrator installation or Docker is needed.
It checks for local development settings before applying migrations.

```powershell
.\scripts\Stop-Local.ps1
```

The stop command checks saved process identities, stops the local database,
and stops only processes launched for this setup. Data is preserved.
If PowerShell blocks local scripts under your policy, use a process-scoped
invocation such as `powershell -ExecutionPolicy Bypass -File .\scripts\Start-Local.ps1`.

Logs are in `server/.local/`: `services.log`, `api.log`, `web.log`, and corresponding
`.error.log` files. PostgreSQL data persists in `.local/postgres/`; uploads persist
in `.local/storage/`. These files, `.env`, dependency folders, and build output
are ignored by Git.

## Fresh dependency installation

Install separately in each repository:

```powershell
# server/
npm ci
npm run local:setup

# web/ (in a separate terminal)
npm ci
```

If your npm version blocks dependency install scripts, approve required native
packages before rebuilding:

```powershell
# server/
npm approve-scripts bcrypt prisma @prisma/client @prisma/engines @embedded-postgres/windows-x64
npm rebuild bcrypt @prisma/client @prisma/engines @embedded-postgres/windows-x64
```

Frontend `.env.local` contains:

```dotenv
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api/v1
```

The backend helper creates `.env` only if absent. It generates JWT secrets and
uses the example local PostgreSQL connection. The storage endpoint is
`http://127.0.0.1:4569`, with S3rver's local test credentials. The storage emulator
supports the existing signed upload/download flow, including teacher CVs.

## Working with the school portal

The initial database contains an administrator, the current academic year,
Grade 10 / section A, and six subjects. Student, parent, teacher and course lists
start empty. Use admin pages to create users and courses, or submit an application
at `/apply` and approve it in the admin portal. Enroll students in a section
to give them access to that section's courses.

The admin dashboard displays live database totals and working management links.
Password recovery pages call the backend's existing endpoints. Local development
shows a reset link when the backend returns a debug token. Production password
reset emails require an email provider; one is not implemented in this backend.
External video meetings are links supplied by teachers, rather than a bundled
video-conferencing service. Production file storage requires real R2 credentials.

## Verification

With the servers running:

```powershell
# server/
npm run local:check
```

This local-only integration check verifies database health, admin APIs, signed
uploads/downloads and upload CORS, admission/teacher approval, all four login
roles and role restrictions, course creation and enrollment, student course
access, refresh-token rotation, and single-use password reset tokens. It uses
temporary synthetic records and cleans up its records and uploaded file.
It deliberately refuses non-local database and storage endpoints.

Both projects can be built independently with `npm run build`.

Dependency verification after setup: frontend `npm audit` reports no findings;
backend `npm audit --omit=dev` reports two moderate findings in Swagger/js-yaml
and no high or critical runtime findings. Backend development tooling still
has audit findings that require a separate dependency upgrade review.
