# TTU Data Sources — Phase 3C Provenance

**Verification date:** 2026-09-17
**Verifier:** Product Owner (manual review of official TTU pages)
**Status legend:**

- `VERIFIED_OFFICIAL` — explicitly confirmed against the cited official TTU URL
- `PARTIALLY_VERIFIED` — partly confirmed, with documented gap
- `PRODUCT_CONFIG` — preserved from the Foundation V0 spec; not directly documented on the official site
- `PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION` — convention is consistent with how TTU materials use the symbols, but no single legend page exists
- `OFFICIAL_BUT_OUT_OF_SCOPE_V1` — official data, intentionally excluded from the V1 dataset
- `UNVERIFIED_HEURISTIC` — internal assumption, no official confirmation

---

## 1. University Identity

| Item | Value | Source URL | Source Date | Status |
|---|---|---|---|---|
| Arabic name | جامعة الطفيلة التقنية | https://www.ttu.edu.jo/ | 2026-09-17 | VERIFIED_OFFICIAL |
| English name | Tafila Technical University | https://www.ttu.edu.jo/ | 2026-09-17 | VERIFIED_OFFICIAL |
| Internal app ID | `ttu` | — | — | PRODUCT_CONFIG (NOT a claim of an official university ID) |
| Timezone | Asia/Amman | — | — | VERIFIED (Jordan local time) |

---

## 2. Faculties (V1 Bachelor Onboarding)

Coverage: 6 of 7 official faculties. The 7th (الكلية التقنية المتوسطة) is excluded because its programs are classified as "دبلوم متوسط" and do not fit the bachelor onboarding flow.

| # | Arabic Name | Source URL | Source Date | Status |
|---|---|---|---|---|
| 1 | كلية الهندسة | https://www.ttu.edu.jo/academics/ | 2026-09-17 | VERIFIED_OFFICIAL |
| 2 | كلية العلوم | https://www.ttu.edu.jo/academics/ | 2026-09-17 | VERIFIED_OFFICIAL |
| 3 | كلية العلوم التربوية | https://www.ttu.edu.jo/academics/ | 2026-09-17 | VERIFIED_OFFICIAL |
| 4 | كلية الأعمال | https://www.ttu.edu.jo/academics/ | 2026-09-17 | VERIFIED_OFFICIAL |
| 5 | كلية الآداب | https://www.ttu.edu.jo/academics/ | 2026-09-17 | VERIFIED_OFFICIAL |
| 6 | كلية تكنولوجيا المعلومات والاتصالات | https://www.ttu.edu.jo/academics/college-of-information-technology-and-communication/ | 2026-09-17 | VERIFIED_OFFICIAL |
| — | الكلية التقنية المتوسطة | https://www.ttu.edu.jo/academics/ | 2026-09-17 | OFFICIAL_BUT_OUT_OF_SCOPE_V1 |

---

## 3. Undergraduate Programs

Primary source: https://www.ttu.edu.jo/ttu_overview/departments/financial-directorate/ (current official program/tuition table, verified 2026-09-17). The table maps each program to its faculty, degree level (bachelor / diploma), and tuition.

| Faculty | # of Programs | Status | Notes |
|---|---|---|---|
| كلية الهندسة | 15 | PARTIALLY_VERIFIED | Several TTU pages disagree on the total count. We use the Financial Directorate program/tuition table as the operational source of truth for V1. |
| كلية العلوم | 9 | VERIFIED_OFFICIAL | |
| كلية العلوم التربوية | 6 | VERIFIED_OFFICIAL | |
| كلية الأعمال | 7 | VERIFIED_OFFICIAL | |
| كلية الآداب | 2 | VERIFIED_OFFICIAL | |
| كلية تكنولوجيا المعلومات والاتصالات | 4 | VERIFIED_OFFICIAL | |

### Engineering source conflict

Different TTU web pages report different totals for كلية الهندسة. V1 uses the 15 programs listed in the official Financial Directorate program/tuition table because that table is the only public source that pairs each program with a degree level and tuition fee. If the count diverges further in future releases, the Financial Directorate table wins until Product Owner decides otherwise. The conflict is documented here to prevent silent drift.

### AI / Data Science program

| Item | Value | Source URL | Status |
|---|---|---|---|
| Arabic name | علم الحاسوب /الذكاء الاصطناعي وعلم البيانات | https://www.ttu.edu.jo/ttu_overview/departments/financial-directorate/ | VERIFIED_OFFICIAL |
| Faculty | كلية تكنولوجيا المعلومات والاتصالات | https://www.ttu.edu.jo/academics/college-of-information-technology-and-communication/ | VERIFIED_OFFICIAL |
| Degree level | Bachelor | https://www.ttu.edu.jo/ttu_overview/departments/financial-directorate/ | VERIFIED_OFFICIAL |
| English name | — | — | UNVERIFIED (no officially published English name; intentionally left undefined in code) |

The name is stored verbatim with the leading slash and no space after it: `علم الحاسوب /الذكاء الاصطناعي وعلم البيانات`.

---

## 4. Computer Labs (ICT)

| Item | Value | Source URL | Source Date | Status |
|---|---|---|---|---|
| Lab labels in use | مختبر الحاسوب ICT 1 … مختبر الحاسوب ICT 7 | https://www.ttu.edu.jo/13731/ | 2026-09-17 | VERIFIED_OFFICIAL |
| `ICT` interpretation in raw room field | Lab identifier, NOT a building code | — | — | VERIFIED_OFFICIAL |
| App display format | `مختبر الحاسوب <raw>` (only when `kind === "lab"`) | https://www.ttu.edu.jo/13731/ | 2026-09-17 | VERIFIED_OFFICIAL |
| `raw` field | Preserved unchanged | — | — | PRODUCT_CONFIG |

The single source of truth for this formatting rule is `getIctLabLabel()` in `src/domain/schedule.ts`. The Smart Import normalizer and the review UI both delegate to it.

---

## 5. Academic Calendar 2026/2027 (First Semester)

Primary source: https://www.ttu.edu.jo/e-calendar/ (Product Owner manually verified the official table on 2026-09-17).

| Field | Value | Status |
|---|---|---|
| Academic year | 2026/2027 | VERIFIED_OFFICIAL |
| Term | First (الفصل الدراسي الأول) | VERIFIED_OFFICIAL |
| Academic year start / add-drop | 2026-09-27 | VERIFIED_OFFICIAL |
| Makeup / incomplete exams | 2026-09-27 → 2026-10-10 | VERIFIED_OFFICIAL |
| Teaching start | 2026-10-04 | VERIFIED_OFFICIAL |
| Last day to equate courses | 2026-10-29 | VERIFIED_OFFICIAL |
| Midterm exam window | 2026-11-22 → 2026-12-03 | VERIFIED_OFFICIAL |
| Last teaching day | 2027-01-07 | VERIFIED_OFFICIAL |
| Final practical / computer-based exams | 2027-01-10 → 2027-01-14 | VERIFIED_OFFICIAL |
| Final theoretical exams | 2027-01-17 → 2027-01-26 | VERIFIED_OFFICIAL |
| Last day to drop a course | 2027-01-07 | VERIFIED_OFFICIAL |

The V1 student-facing calendar shows the 16 student-relevant events listed in
`data/academic-calendars/ttu/2026-2027/first/calendar.json` (registration, exams,
holidays, teaching milestones). Administrative events (e.g. grade-submission
deadlines, faculty senate meetings, faculty sabbaticals) are present in the
official table but are intentionally NOT surfaced in the student UI.

### Production term

| Field | Value |
|---|---|
| `name` | الفصل الدراسي الأول 2026/2027 |
| `startsOn` | 2026-10-04 (teaching start, used for ICS first-occurrence math) |
| `endsOn` | 2027-01-07 (last teaching day) |
| `isCurrent` | true |

### V0 placeholder dates

The dates `2026-09-01` and `2026-12-31` were hardcoded in the Foundation V0
build. They are NOT official TTU dates. Any reference to them in production
code is now blocked by `pnpm data:validate`.

---

## 6. Day Codes

| Code | Arabic Name | Status |
|---|---|---|
| س | السبت | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |
| ح | الأحد | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |
| ن | الاثنين | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |
| ث | الثلاثاء | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |
| ر | الأربعاء | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |
| خ | الخميس | PRODUCT_CONFIG_WITH_OFFICIAL_USAGE_CORROBORATION |

These codes are consistently used in TTU course materials and the official
academic calendar, but no single official legend page was found that defines
each letter. The mapping is preserved from the Foundation V0 spec and is
treated as a Product Requirement.

---

## 7. Room / Building Codes

| Code | Expansion | Source URL | Status |
|---|---|---|---|
| `م` (مجمع القاعات) | مجمع القاعات | — | PRODUCT_CONFIG (inherited from Foundation) |
| `ع` (كلية الأعمال) | كلية الأعمال | — | PRODUCT_CONFIG (inherited from Foundation) |
| `هـ` / `ه` (كلية الهندسة) | كلية الهندسة | — | PRODUCT_CONFIG (inherited from Foundation) |
| `online` / `عبر الإنترنت` / `أونلاين` | عبر الإنترنت | — | PRODUCT_CONFIG (conventional strings) |

No official TTU webpage was found that explicitly states
"م = مجمع القاعات" or "ع = كلية الأعمال" or "هـ = كلية الهندسة".
These mappings are preserved from the Foundation V0 spec to keep the Smart
Import pipeline working. They are NOT marked `VERIFIED_OFFICIAL`. The
unexpanded `raw` value is always preserved so that a future re-verification
can rewrite the display labels without touching the source data.

---

## 8. Floor Heuristic

| Item | Value | Status |
|---|---|---|
| Rule | 100-range → الطابق الأول, 200-range → الطابق الثاني, 300-range → الطابق الثالث | UNVERIFIED_HEURISTIC |
| Implementation | `getFloorLabel()` in `src/domain/schedule.ts` | (kept for backward compatibility) |
| Production usage | NONE — the function is not called from any UI flow | — |

The convention is not officially documented by TTU. The function is marked
with `@deprecated` JSDoc and must NOT be wired into any production UI flow.

---

## 9. Legacy / Migration Notes

The Foundation V0 build used four placeholder UUIDs:

- `11111111-1111-4111-8111-111111111111` (faculty seed 1)
- `22222222-2222-4222-8222-222222222222` (faculty seed 2)
- `33333333-3333-4333-8333-333333333333` (major seed 1)
- `44444444-4444-4444-8444-444444444444` (major seed 2)

Any existing StudentProfile carrying one of these IDs is routed through the
non-destructive **"Refresh faculty/major"** flow on next app start. The user's
name, courses, sessions, and settings are kept intact; only `facultyId` and
`majorId` are replaced.

The V0 placeholder term
(`name = "الفصل الحالي"`, `startsOn = "2026-09-01"`, `endsOn = "2026-12-31"`,
`isCurrent = true`) is auto-migrated to the production term on the next read
or write through the repository.
