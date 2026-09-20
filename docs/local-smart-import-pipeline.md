# Local Smart Import Pipeline (Phase 4)

## 1. Overview & Architecture

Phase 4 introduces a **local-first privacy architecture** for Smart Schedule Import in Murattab.

When a student imports an image schedule (JPEG, PNG, WebP):
- The file is processed **100% locally within the browser**.
- **No image is uploaded** to any server or external AI provider by default.
- The pipeline executes:
  $$\text{Image File} \longrightarrow \text{LocalOcrEngine} \longrightarrow \text{TTU Geometry Parser} \longrightarrow \text{TTU Semantic Parser} \longrightarrow \text{ScheduleExtractionResult} \longrightarrow \text{Review UI}$$

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             STUDENT BROWSER                                 │
│                                                                             │
│  [Upload Image]                                                             │
│         │                                                                   │
│         ▼                                                                   │
│  LocalOcrEngine (Tesseract.js Web Worker + self-hosted /ocr/ WASM)          │
│         │                                                                   │
│         ▼                                                                   │
│  TTU Table Geometry Parser (parseTtuTableGeometry)                          │
│         │                                                                   │
│         ▼                                                                   │
│  TTU Schedule Semantic Parser (parseTtuScheduleSemantics)                   │
│         │                                                                   │
│         ▼                                                                   │
│  Adapter (toScheduleExtractionResult)                                       │
│         │                                                                   │
│         ▼                                                                   │
│  Shared Review UI (buildEditableReviewCourses)                              │
│         │                                                                   │
│         ▼                                                                   │
│  Local IndexedDB (Dexie)                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Image vs. PDF Routing

| File Type | Route | Privacy / Network Behavior | Consent Required |
| :--- | :--- | :--- | :--- |
| **Images** (`image/jpeg`, `image/png`, `image/webp`) | **Local-First Pipeline** (`analyzeScheduleImageLocally`) | Browser-only. The only network requests are same-origin GET requests for WASM/traineddata assets under `/ocr/`. | **No** cloud consent checkbox. Enabled immediately. |
| **PDF** (`application/pdf`) | **Cloud Pipeline** (`POST /api/schedule/extract`) | Sent over HTTPS to the server extract API. | **Yes** explicit cloud consent checkbox required before extraction. |

---

## 3. Strict Opt-In Cloud Fallback Policy

### No Automatic Fallback
The student's image is **never** uploaded automatically if local processing fails.

### Hard Local Failures Only
Cloud fallback is offered only for hard failures:
- Image decoding error (`OCR_IMAGE_DECODE_FAILED`)
- Engine initialization failure (`OCR_INITIALIZATION_FAILED`)
- Tesseract recognition error (`OCR_RECOGNITION_FAILED`)
- No table detected (`NO_TABLE_DETECTED`)
- Zero courses found (`NO_COURSES_DETECTED`)

If the local parser extracts courses with partial or unresolved fields (e.g. unknown room or unread day code), the system **always enters the Review UI directly**, allowing the student to inspect and fill missing fields manually rather than sending their schedule to the cloud.

### Explicit Consent Requirement
When hard failure occurs, the dialog displays the local failure cause and offers an optional secondary action:
- Button: *"استخدام التحليل المتقدم"*
- Checkbox: *"أوافق صراحة على إرسال الملف إلى مزود التحليل الخارجي"*
- The action remains disabled until the student explicitly checks the consent box.

---

## 4. Unresolved-Field & Non-Guessing Policy

In alignment with Phase 3 invariants:
- Unresolved days (`day: null`), times (`startsAt: null`, `endsAt: null`), and empty rooms remain blank in the Review UI.
- The Review UI requires all mandatory fields (course name, day, valid time range) before final approval.
- Manually added courses (`addMissingCourse()`) start with empty name (`""`), empty day, empty times, and `kind: "unspecified"` to prevent persisting accidental default placeholders.

---

## 5. Cancellation & Worker Lifecycle

- **Generation Tokens:** Each local analysis invocation increments `analysisAttemptRef.current`. All asynchronous state transitions verify that the attempt token matches before updating state, preventing race conditions or stale popups if the user cancels or selects another file.
- **Engine Disposal:** The `LocalOcrEngine` instance is retained during dialog lifetime for fast retries, and cleanly terminated on dialog unmount or manual cancellation via `dispose()`.
- **Pending Initializations:** Disposal safely aborts pending worker creation, avoiding orphaned worker threads.

---

## 6. Current Limitations & Scope

- **PDF Local OCR:** PDFs currently use the server extraction endpoint. Local PDF rasterization/OCR is planned for future phases.
- **Tesseract Ligature Sensitivity:** Highly compressed or small images may cause isolated Arabic day codes to be misread as punctuation; these are preserved as raw evidence and marked with `DAY_UNRESOLVED` for manual student review.
- **xKiro Preservation:** The existing xKiro model extractor and `/api/schedule/extract` endpoint remain fully intact for PDF parsing and explicit user-consented fallbacks.
