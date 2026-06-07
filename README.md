# Bab-ul-Ilm LMS – Backend

NestJS 11 + Prisma + PostgreSQL + AWS S3. JWT auth with role-based access for
**Admin**, **Teacher**, **Student**, **Parent**. See `docs/API_OVERVIEW.md` and
the per-role guides in `docs/roles/` for integrator documentation.

## Tech stack

- **Runtime**: Node.js 20 LTS, TypeScript.
- **Framework**: NestJS 11.
- **DB**: PostgreSQL 16 via Prisma (migrations + typed client).
- **Auth**: JWT access + refresh tokens, bcrypt passwords, Passport JWT
  strategy, global `JwtAuthGuard` + `RolesGuard`.
- **Validation**: `class-validator` / `class-transformer` + Zod for env.
- **Storage**: AWS S3 via `@aws-sdk/client-s3` + presigned URLs.
- **Logging**: `nestjs-pino` with request IDs (pretty in dev).
- **Docs**: Swagger at `/api/docs` (bearer auth persistent).
- **Scheduling**: `@nestjs/schedule` (orphan S3 cleanup).

## Project layout

```
backend/
├─ docs/
│  ├─ API_OVERVIEW.md         # shared conventions for all frontends
│  ├─ roles/
│  │  ├─ ADMIN.md
│  │  ├─ TEACHER.md
│  │  ├─ STUDENT.md
│  │  └─ PARENT.md
│  └─ postman/
│     └─ bab-ul-ilm.postman_collection.json
├─ prisma/
│  ├─ schema.prisma
│  └─ seed.ts
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ common/                  # guards, decorators, interceptors, filters, pagination
│  ├─ config/                  # env validation + AppConfigService
│  ├─ prisma/                  # PrismaModule + PrismaService
│  └─ modules/
│     ├─ auth/  users/  academic/  content/  live-classes/
│     ├─ assignments/  quizzes/  exams/  attendance/
│     ├─ fees/  salaries/  announcements/  notifications/
│     ├─ media/  parents/  health/
├─ package.json
└─ .env.example
```

## Local setup

Requires: Node 20+, a reachable PostgreSQL 16 database (hosted such as
Prisma Postgres / Neon / Supabase / RDS, or a local install), AWS account
with an S3 bucket.

```bash
cd backend
cp .env.example .env            # fill in real values (DATABASE_URL, JWT secrets, S3, ...)
npm install
npx prisma migrate dev          # create / sync schema
npm run prisma:seed             # initial admin + academic year
npm run start:dev               # http://localhost:4000/api/v1
```

- **Swagger**: http://localhost:3000/api/docs
- **Health**: http://localhost:3000/api/v1/health (and `/health/db`)

Default admin (from `.env`): `admin@bab-ul-ilm.local` / `Admin@12345` (change
immediately in real environments).

## Scripts

| Command | Purpose |
|---|---|
| `npm run start:dev` | Nest watch mode |
| `npm run build` | Compile TS to `dist/` |
| `npm run start:prod` | Run compiled build |
| `npm run lint` / `npm run format` | ESLint + Prettier |
| `npm test` / `npm run test:e2e` | Unit / e2e tests |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:deploy` | `prisma migrate deploy` (prod) |
| `npm run seed` | Run `prisma/seed.ts` |

## Environment variables

See `.env.example`. Key values:

| Var | Notes |
|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db?schema=public` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Long random strings (use `openssl rand -hex 64`) |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | e.g. `15m` / `30d` |
| `CORS_ORIGINS` | CSV list, e.g. `https://app.example.com,https://admin.example.com` |
| `AWS_REGION`, `AWS_S3_BUCKET` | target bucket |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | IAM user with S3 scoped to bucket (or use IAM role on EC2 and omit these) |
| `S3_PRESIGN_EXPIRES_SECONDS` | default `900` |
| `SEED_ADMIN_*` | Used once by `seed.ts` |

## S3 bucket policy (minimum)

Create a dedicated bucket (private, block public access on). Use a
user/role with this scoped policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::YOUR_BUCKET"
    }
  ]
}
```

CORS on the bucket so browsers can upload via presigned URL:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "GET"],
    "AllowedOrigins": ["https://app.example.com", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

## Deployment on AWS EC2 (no Docker)

Single-host setup using Node + PM2 + Nginx. Adjust as your team grows.

### 1. Provision

- EC2 Ubuntu 22.04, t3.small or larger (more RAM for heavy media load).
- Security group: inbound `80/tcp`, `443/tcp` from world; `22/tcp` from your IP.
- Attach an **IAM instance role** with the S3 policy above. This removes the
  need to put `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the `.env`.
- **Database**: any reachable Postgres 16. Recommended:
  - AWS RDS PostgreSQL 16 in the same VPC, or
  - a hosted provider (Neon, Supabase, Prisma Postgres) over TLS.
- S3 bucket (see previous section).
- Route 53 record → EC2 Elastic IP.

### 2. Host deps

```bash
sudo apt update
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
```

### 3. Ship the app

```bash
sudo mkdir -p /srv/bab-ul-ilm && sudo chown $USER:$USER /srv/bab-ul-ilm
git clone <your repo> /srv/bab-ul-ilm
cd /srv/bab-ul-ilm/backend
cp .env.example .env                      # edit with production values
npm ci
npx prisma generate
npx prisma migrate deploy                 # apply pending migrations
npm run build                             # outputs to dist/
npm run prisma:seed                       # one-time, creates initial admin
pm2 start dist/main.js --name lms-api --update-env
pm2 save
pm2 startup systemd                       # follow the printed sudo command
```

### 4. Nginx reverse proxy + TLS

```nginx
# /etc/nginx/sites-available/lms-api
server {
    listen 80;
    server_name api.your-school.com;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/lms-api /etc/nginx/sites-enabled/lms-api
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d api.your-school.com
```

Uploads go client → S3 directly via presigned URLs, so the proxy doesn't need
a huge body limit, but keep at least `20m` for safety.

### 5. Updates

```bash
cd /srv/bab-ul-ilm && git pull
cd backend
npm ci
npx prisma migrate deploy
npm run build
pm2 reload lms-api --update-env
```

For zero-downtime, run two PM2 instances behind Nginx upstream or move to a
load-balanced setup.

### 6. Observability

- Structured JSON logs via `nestjs-pino` go to stdout. PM2 captures them at
  `~/.pm2/logs/lms-api-{out,error}.log`; ship to CloudWatch with the agent.
- `/api/v1/health` and `/api/v1/health/db` are public probes for ALB / uptime
  checks.

## Seeding & demo data

`prisma/seed.ts` ensures:

- A current `AcademicYear`.
- The admin user from `SEED_ADMIN_*`.
- Demo `Class`, `Section`, and a few `Subjects`.

It is idempotent; running it again is safe.

## Further reading

- `docs/API_OVERVIEW.md` – conventions (response envelope, auth, media, YouTube, live).
- `docs/roles/ADMIN.md`, `TEACHER.md`, `STUDENT.md`, `PARENT.md` – role-specific guides.
- `docs/postman/bab-ul-ilm.postman_collection.json` – import into Postman; the
  login request captures tokens into collection variables.
- Swagger UI at `/api/docs` for the live API surface.
