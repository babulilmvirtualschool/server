# Bab-ul-Ilm LMS API – Overview for Frontend Integration

This document describes the conventions shared by every endpoint. Role-specific
endpoint catalogues live in `docs/roles/*.md`.

## Base URL

```
http://<host>/api/v1
```

Swagger UI is served at `http://<host>/api/docs`. Every endpoint is documented
there with live request/response schemas.

## Response envelope

All successful responses are wrapped:

```json
{ "success": true, "data": <payload> }
```

For paginated endpoints the payload becomes:

```json
{
  "success": true,
  "data": [ ... ],
  "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 }
}
```

Errors follow:

```json
{
  "success": false,
  "statusCode": 400,
  "path": "/api/v1/...",
  "code": "P2002",
  "message": "Unique constraint failed on: email",
  "timestamp": "2025-09-01T12:00:00.000Z"
}
```

## Authentication

1. `POST /auth/login` with `{ email|username, password }`.
2. Store `accessToken` in memory / secure state and `refreshToken` in
   `httpOnly` secure storage (or localStorage for MVP if acceptable).
3. Send `Authorization: Bearer <accessToken>` on every request.
4. When the backend returns `401`, call `POST /auth/refresh` with the
   refresh token to rotate both tokens; then retry the original request.
5. On logout, call `POST /auth/logout` with the refresh token.

### Typical user payload

```json
{
  "id": "cuid",
  "email": "teacher@example.com",
  "username": "msmith",
  "role": "TEACHER",
  "firstName": "Mary",
  "lastName": "Smith",
  "avatarKey": "avatars/xyz.jpg"
}
```

`role` is one of `ADMIN | TEACHER | STUDENT | PARENT`. Route the user into
role-specific app shells based on this value.

## Media uploads (S3 presigned flow)

1. `POST /media/presign-upload` with `{ purpose, mimeType, size, originalName? }`.
2. Backend returns `{ key, uploadUrl, expiresIn }`.
3. Client `PUT`s the file bytes to `uploadUrl` with `Content-Type: <mimeType>`.
4. Client calls `POST /media/finalize` with `{ key }` to mark it as kept.
5. Use the `key` wherever the API expects a key (e.g. `documentKey`,
   `receiptKey`, `avatarKey`, etc.).

To display a private file, call `GET /media/presign-download?key=<key>` and
use the returned short-lived `url` as an `<img>` / `<a>` / `<iframe>` src.

`MediaPurpose` enum values:
`AVATAR`, `COURSE_COVER`, `CONTENT_DOCUMENT`, `SYLLABUS`,
`ASSIGNMENT_ATTACHMENT`, `ASSIGNMENT_SUBMISSION`, `FEE_RECEIPT`,
`SALARY_SLIP`, `ANNOUNCEMENT_ATTACHMENT`, `QUESTION_IMAGE`, `OTHER`.

## YouTube embeds

Video `ContentItem`s with `type=VIDEO_YOUTUBE` carry both the original
`youtubeUrl` and the normalized `youtubeId`. Embed with:

```html
<iframe src="https://www.youtube.com/embed/<youtubeId>"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
        allowfullscreen />
```

## Live-class "Join" button

A `LiveClass` is joinable when:

```
now >= scheduledStart - joinBufferMinutes  &&  now <= scheduledEnd
```

The student clicks `POST /live-classes/:id/join` which returns
`{ meetingLink }` and records attendance. Open the link in a new tab.

## Common query parameters

- `page` (default 1), `limit` (default 20, max 100), `search` (substring).
- Date filters use ISO 8601 strings (`YYYY-MM-DD` or full ISO).

## Enum cheat-sheet

- `Role`: `ADMIN | TEACHER | STUDENT | PARENT`
- `AttendanceStatus`: `PRESENT | ABSENT | LATE | EXCUSED`
- `InvoiceStatus`: `PENDING | PAID | PARTIAL | OVERDUE | CANCELLED`
- `PaymentMethod`: `CASH | BANK_TRANSFER | CHEQUE | ONLINE | OTHER`
- `QuestionType`: `MCQ_SINGLE | MCQ_MULTI | TRUE_FALSE | SHORT_ANSWER | LONG_ANSWER`
- `AttemptStatus`: `IN_PROGRESS | SUBMITTED | AUTO_SUBMITTED | GRADED | CANCELLED`
- `ViolationType`: `TAB_SWITCH | WINDOW_BLUR | FULLSCREEN_EXIT | COPY | PASTE | CONTEXTMENU | DEVTOOLS | NETWORK_LOSS`
- `AnnouncementAudience`: `ALL | ADMINS | TEACHERS | STUDENTS | PARENTS | SECTION | COURSE`
