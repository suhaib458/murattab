# TTU API integration foundation

This document describes the optional official Tafila Technical University API layer prepared for Murattab.

The important compatibility rule is: **the current verified bundled calendar remains available and unchanged**. The new integration is disabled by default and can only replace calendar data at runtime after an authorized university endpoint is configured successfully.

## Current modes

### 1. Static-only — current production behaviour

When `TTU_API_ENABLED=false` or the calendar endpoint is not configured:

- Murattab uses `data/academic-calendars/ttu/2026-2027/first/calendar.json`.
- The app keeps working offline.
- The calendar UI behaves exactly as before.
- Academic-calendar push reminders continue to use the bundled calendar.

### 2. Official API with static fallback

When the authorized TTU integration is enabled and a calendar endpoint is configured:

1. The browser requests Murattab's own `/api/ttu/calendar` route.
2. The server calls the configured TTU endpoint.
3. The response is validated and normalized.
4. If it is valid, Murattab uses the official live calendar.
5. If the API is down, slow, unauthorized, or returns invalid data, Murattab immediately falls back to the bundled verified calendar.

University API credentials are never sent to the browser.

## Prepared endpoints

### `GET /api/ttu/calendar`

Returns a normalized calendar envelope:

```json
{
  "calendar": {
    "schemaVersion": 1,
    "universityId": "ttu",
    "academicYear": "2026/2027",
    "term": "first",
    "events": []
  },
  "meta": {
    "source": "official-api",
    "fetchedAt": "2026-09-26T00:00:00.000Z",
    "apiConfigured": true,
    "fallbackReason": null
  }
}
```

The bundled calendar is returned instead when the official source cannot be used.

### `GET /api/ttu/status`

Returns only non-secret readiness information:

- whether the integration is enabled,
- whether calendar integration is configured,
- whether future course-catalog and student-schedule paths are configured.

It never exposes the API token, base URL, or authentication headers.

## Environment configuration

```text
TTU_API_ENABLED=false
TTU_API_BASE_URL=
TTU_API_TOKEN=
TTU_API_AUTH_HEADER=Authorization
TTU_API_AUTH_PREFIX=Bearer
TTU_API_TIMEOUT_MS=5000
TTU_API_CACHE_TTL_MS=900000

TTU_API_CALENDAR_PATH=
TTU_API_COURSE_CATALOG_PATH=
TTU_API_STUDENT_SCHEDULE_PATH=
TTU_API_STUDENT_AUTH_MODE=disabled
```

Authentication is configurable because the official TTU API contract is not available yet. For example, a future university integration could use a Bearer token or a custom header without exposing credentials to client code.

## Calendar normalization boundary

The app UI does not depend on the university's raw JSON field names.

All university-specific mapping belongs in:

`src/server/ttu-api/calendar-service.ts`

Today the adapter accepts an already-normalized calendar directly or inside `calendar` / `data`. After TTU provides its API documentation, the raw TTU response should be mapped to Murattab's existing `AcademicCalendarSchema` only in that server adapter.

This keeps the calendar UI, notification system, and offline fallback independent from the external API shape.

## Automatic semester updates

Once TTU provides an endpoint that returns the current academic calendar, Murattab will not need a code change every semester:

```text
TTU API
   ↓
Murattab server adapter
   ↓
schema validation
   ↓
/api/ttu/calendar
   ↓
Calendar UI + academic push reminder generation
```

The route is server-cached for a short configurable period, so the app can pick up official changes without sending excessive requests to the university.

A later phase can add a scheduled server sync/database snapshot if TTU requires polling independent of app traffic. That is intentionally not enabled before the university contract and usage limits are known.

## Course catalog and sections foundation

Murattab now has a normalized server-side contract for the official course catalog and offered sections.

Prepared route:

`GET /api/ttu/course-catalog`

This route is dormant unless `TTU_API_ENABLED=true` and `TTU_API_COURSE_CATALOG_PATH` is configured. It does not replace any current feature or local schedule data.

The normalized contract separates course information from offered sections:

```json
{
  "schemaVersion": 1,
  "universityId": "ttu",
  "academicYear": "2026/2027",
  "term": "first",
  "courses": [
    {
      "code": "COURSE-CODE",
      "name": "اسم المادة",
      "creditHours": 3,
      "sections": [
        {
          "id": "SECTION-ID",
          "number": "1",
          "instructorName": "اختياري",
          "capacity": 40,
          "enrolled": 32,
          "sessions": [
            {
              "day": "ح",
              "startsAt": "09:00",
              "endsAt": "10:00",
              "room": "207 م",
              "kind": "lecture"
            }
          ]
        }
      ]
    }
  ]
}
```

The exact raw TTU JSON can be different. Once the university publishes its documentation, only the server adapter in `src/server/ttu-api/course-catalog-service.ts` needs to map those fields into this normalized contract.

Catalog data may be cached for the configured short TTL because it is not student-specific.

## Student schedule foundation

Prepared route:

`GET /api/ttu/student-schedule`

Student records are **disabled by default**. The route becomes ready only when all of the following are configured:

- `TTU_API_ENABLED=true`
- `TTU_API_STUDENT_SCHEDULE_PATH`
- `TTU_API_STUDENT_AUTH_MODE=delegated-bearer`

The prepared delegated mode intentionally does not accept a student number in a query parameter. The university endpoint must identify the student from the authorized short-lived Bearer credential. This prevents a future client from asking Murattab for another student's schedule merely by changing an ID.

The credential is forwarded for that request only. Murattab does not add it to local storage, the normalized response, or cache.

The normalized response also intentionally excludes student profile fields:

```json
{
  "schemaVersion": 1,
  "universityId": "ttu",
  "academicYear": "2026/2027",
  "term": "first",
  "courses": [
    {
      "code": "COURSE-CODE",
      "name": "اسم المادة",
      "sectionId": "SECTION-ID",
      "sessions": []
    }
  ]
}
```

If the upstream API returns unrelated personal fields, the validation boundary strips them from the response Murattab uses.

## Reusing the current review-before-save flow

Official data will not overwrite a student's local schedule silently.

`src/domain/ttu-api-schedule-adapter.ts` converts either:

- the full official student schedule, or
- one selected official catalog section,

into Murattab's existing `ScheduleExtractionResult` contract. This means a future official-import button can reuse the same review, conflict checking, duplicate handling, room normalization, and explicit approval flow already used by Smart Import.

Current IndexedDB data and Smart Import remain unchanged.

## Future data that can use the same integration layer

If TTU provides authorized APIs later, the same server-only pattern can support:

- registered courses and sections,
- lecture times and rooms,
- instructor information,
- exam schedules,
- official announcements,
- course/room changes,
- university SSO.

## What to request from TTU

Before connecting production, request official documentation covering:

1. Base URL and API version.
2. Authentication method and credential rotation.
3. Calendar endpoint and semester identifiers.
4. Course/section endpoint.
5. Student-schedule endpoint, if permitted.
6. Rate limits and daily/monthly quotas.
7. Cache policy and allowed refresh frequency.
8. Error codes and maintenance behaviour.
9. Data-retention/privacy requirements.
10. Sandbox or test credentials.
11. Whether webhooks exist for calendar/schedule changes.

A webhook would be preferable for urgent updates because TTU could notify Murattab when data changes instead of Murattab polling continuously.

## Security guarantees in this foundation

- TTU service credentials remain server-side.
- Student delegated credentials are accepted only for the student-schedule request and are not cached or returned.
- The student-schedule route requires a same-origin Murattab request marker before attempting upstream access.
- The prepared student endpoint does not accept an arbitrary student ID.
- Resource URLs must stay on the configured TTU API origin.
- Non-local production API URLs must use HTTPS.
- Requests use a configurable timeout.
- External payloads are schema-validated before use.
- Invalid/unavailable upstream data never deletes the bundled calendar.
- The current local-first student schedule remains untouched.
