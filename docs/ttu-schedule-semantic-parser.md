# TTU Schedule Semantic Parser (Phase 3)

## 1. Overview

The **TTU Schedule Semantic Parser** (`src/domain/ttu-schedule-parser/`) translates the pure spatial geometry produced by Phase 2 (`TtuTableGeometryResult`) into deterministic semantic schedule data (`TtuParsedSchedule` and `ScheduleExtractionResult`).

It operates under strict non-guessing rules:
- **Zero AI or LLMs**: purely deterministic domain functions.
- **Zero Hallucination**: unresolved days, times, or rooms remain `null` or empty with diagnostic issues; default values (e.g. Sunday or 08:30) are never invented.
- **Evidence Preservation**: original raw text (`rawCourseName`, `roomRaw`, segment text) is retained alongside normalized representations.

---

## 2. Input & Output Contracts

### Input Contract
The parser consumes only `TtuTableGeometryResult` from Phase 2:
- Column definitions (`TtuTableColumn[]`)
- Table rows (`TtuTableRow[]`)
- Cell contents and ordered visual line segments (`TtuCellSegment[]`)
- Overall geometry confidence and diagnostics

It does NOT consume Tesseract objects directly, re-read pixels, or perform OCR.

### Output Contract
```ts
export interface TtuParsedSchedule {
  courses: TtuParsedCourse[];
  issues: TtuSemanticIssue[];
  confidence: number;
}

export interface TtuParsedCourse {
  courseName: string;
  rawCourseName: string;
  sectionRaw?: string;
  creditHoursRaw?: string;
  sessions: TtuParsedSession[];
  confidence: number;
}

export interface TtuParsedSession {
  day: DayCode | null;
  startsAt: string | null;
  endsAt: string | null;
  roomRaw: string;
  roomExpanded?: string;
  kind: "lecture" | "lab" | "unspecified";
  source: {
    meetingSegmentText: string;
    roomSegmentText?: string;
  };
  confidence: {
    day: number;
    time: number;
    room: number;
    pairing: number;
  };
}
```

*Note: In accordance with Phase 3 design rules, `TtuParsedSession` does NOT include a UUID, ensuring the parser output is 100% deterministic. UUIDs are created solely when adapting to `DraftSession` in `adapter.ts`.*

---

## 3. Day-Code Parsing (`day-parser.ts`)

### Canonical TTU Alphabet
- `س`: Saturday (السبت)
- `ح`: Sunday (الأحد)
- `ن`: Monday (الاثنين)
- `ث`: Tuesday (الثلاثاء)
- `ر`: Wednesday (الأربعاء)
- `خ`: Thursday (الخميس)
- *Friday is not a valid university schedule day.*

### Non-Guessing Policy
- Days are parsed strictly from visible tokens. If a course row states `ح ث`, it produces **only** Sunday and Tuesday. Thursday (`خ`) is **never** added.
- Corrupted symbols (such as `©`, `,`, or `&`) are **not** guessed as days. If a token cannot be parsed into a canonical day code, `DAY_TOKEN_AMBIGUOUS` is emitted.
- If no valid day codes exist, `day` is set to `null` and `DAY_UNRESOLVED` is emitted.

### Multi-Day Expansion
A single meeting segment containing multiple days (e.g. `ح ث خ 10:00 - 11:00`) produces separate `TtuParsedSession` entries—one for each day—sharing the same start time, end time, room, and session kind.

---

## 4. Time Range Parsing (`time-parser.ts`)

### Rules & Normalization
- Supports standard TTU 24-hour ranges: `08:30 - 10:00`, `11:30 - 13:00`, `19:30 - 20:30`.
- Tolerates variable OCR spacing: `08:30-10:00`, `08:30 -10:00`, `08:30- 10:00`.
- Automatically normalizes Arabic-Indic numerals (`٠-٩`) to ASCII (`0-9`).
- Validates 24-hour format: `HH:mm` (hour `00..23`, minute `00..59`).

### Strict Time Invariant: `endsAt > startsAt`
- If `endsAt <= startsAt` (e.g. `11:00 - 10:30` or `10:30 - 08:30`):
  - Times are **not** auto-swapped.
  - Duration is **not** invented.
  - `startsAt` and `endsAt` are set to `null`.
  - Issue `INVALID_TIME_RANGE` (severity `error`) is emitted.

---

## 5. Room Parsing (`room-parser.ts`)

### Preservation of Raw Evidence
`roomRaw` always contains the exact text from the geometry parser (e.g. `207 م`, `DS-ICT 2`, `ICT - 4`).

### Verified TTU Expansion
Reuses verified domain expansion rules:
- `م` -> `مجمع القاعات – قاعة [رقم]` (e.g. `207 م` -> `مجمع القاعات – قاعة 207`)
- `هـ` / `ه` -> `كلية الهندسة – قاعة [رقم]`
- `ع` -> `كلية الأعمال – قاعة [رقم]`
- `online` / `أونلاين` / `عبر الإنترنت` -> `عبر الإنترنت`
- Plain ICT labs (`ICT - 4`, `ICT 4`) -> `مختبر الحاسوب ICT - 4`

### Room Diagnostics
- Unexpanded but readable rooms (e.g. `DS-ICT 2`, `DS-ICT 3`) are valid raw room evidence and do **not** emit `ROOM_UNRESOLVED`.
- `ROOM_MISSING`: Emitted when no room text exists.
- `ROOM_UNRESOLVED`: Emitted only when room text contains non-room noise or invalid punctuation.

---

## 6. Segment Pairing by Geometry (`segment-pairer.ts`)

In TTU schedules, multi-session courses (such as lectures paired with computer labs) place multiple meeting entries and room entries in vertically stacked lines within a single course row.

### Pairing Algorithm
1. Compute vertical centers: $y_{\text{center}} = \frac{y_0 + y_1}{2}$.
2. Normalize vertical distance relative to row height: $\text{dist} = \frac{|y_{\text{meeting}} - y_{\text{room}}|}{\text{rowHeight}}$.
3. **Equal Counts (e.g. 2 meetings ↔ 2 rooms):**
   - Direct pairing between vertically aligned segments.
4. **Mismatched Counts (e.g. 2 meetings ↔ 1 room):**
   - Pairs room with a meeting segment only if vertical alignment is close ($\text{dist} \le 0.30$).
   - Never blindly duplicates a single room across different meeting lines.
   - If alignment is indeterminate, emits `SEGMENT_PAIRING_AMBIGUOUS`.

---

## 7. Session Classification (`session-classifier.ts`)

Deterministic classification into `"lecture"`, `"lab"`, or `"unspecified"`:
- **`lab`**:
  - Explicit Arabic text containing `"مختبر"`
  - Verified plain ICT computer lab patterns (`ICT - 4`, `ICT 4`)
- **`lecture`**:
  - Verified normal hall expansion (`مجمع القاعات – قاعة 207`)
  - Explicit `"قاعة"` text without lab markers
- **`unspecified`**:
  - `DS-ICT X` (computerized teaching rooms that are not guaranteed labs)
  - Any room lacking definitive hall or lab evidence
  - Emits `SESSION_KIND_UNSPECIFIED` (severity `info`)

Credit hours are never used to infer session kind.

---

## 8. Confidence Model

Confidence scores are source-bounded deterministic heuristics:
- $\text{confidence}_{\text{day}} \le \text{confidence}_{\text{meetingSegment}}$
- $\text{confidence}_{\text{time}} \le \text{confidence}_{\text{meetingSegment}}$
- $\text{confidence}_{\text{room}} \le \text{confidence}_{\text{roomSegment}}$
- $\text{confidence}_{\text{pairing}} \le \min(\text{meetingConfidence}, \text{roomConfidence}, 1.0 - 0.5 \times \text{dist})$

Course and overall schedule confidences aggregate these values, applying calibrated penalties for errors and missing fields.

---

## 9. Diagnostic Issues

| Code | Severity | Description |
| :--- | :--- | :--- |
| `COURSE_NAME_MISSING` | `error` | Course cell text is empty or unreadable. |
| `DAY_UNRESOLVED` | `warning` | No valid canonical day codes could be extracted. |
| `DAY_TOKEN_AMBIGUOUS` | `warning` | Encountered an unknown/corrupted day token (e.g. `&`, `©`). |
| `TIME_RANGE_MISSING` | `error` | No time range pattern found in meeting text. |
| `INVALID_TIME_RANGE` | `error` | Invalid time values or reversed time (`endsAt <= startsAt`). |
| `ROOM_MISSING` | `warning` | No room string present in row. |
| `ROOM_UNRESOLVED` | `warning` | Room text contains corrupted noise or punctuation. |
| `SEGMENT_PAIRING_AMBIGUOUS` | `warning` | Cannot determine geometric correspondence between meeting and room. |
| `EXTRA_ROOM_SEGMENT` | `info` | More room segments than meeting segments found in row. |
| `EXTRA_MEETING_SEGMENT` | `info` | Meeting segment has no corresponding room. |
| `SESSION_KIND_UNSPECIFIED` | `info` | Insufficient evidence to classify as lecture or lab. |
