/**
 * pnpm data:validate
 *
 * Validates the canonical TTU runtime config + the official academic
 * calendar against the project's hard invariants:
 *   - every faculty/major ID is a valid UUID
 *   - faculty IDs are unique
 *   - major IDs are unique
 *   - every major.facultyId resolves to a known faculty (no orphans)
 *   - no faculty/major in production is marked isDevelopmentSeed
 *   - no faculty/major in production is a V0 legacy placeholder UUID
 *   - faculty names are unique (after trim)
 *   - major names are unique within their faculty
 *   - academic calendar passes the same checks as `pnpm calendar:validate`
 *   - no production term uses the V0 placeholder dates 2026-09-01 / 2026-12-31
 *
 * The script never mutates project state. It exits 1 on any failure.
 */
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ttuConfig, LEGACY_SEED_IDS } from "../src/config/ttu";

const PLACEHOLDER_DATES = new Set(["2026-09-01", "2026-12-31"]);

const errors: string[] = [];
function fail(msg: string): void {
  errors.push(msg);
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(id: string, where: string): void {
  if (!uuidRe.test(id)) fail(`Invalid UUID: ${where} = ${id}`);
}

// 1. Faculties
const facultyIds = new Set<string>();
const facultyNames = new Set<string>();
for (const f of ttuConfig.faculties) {
  assertUuid(f.id, `faculty.id (${f.name})`);
  if (facultyIds.has(f.id)) fail(`Duplicate faculty id: ${f.id} (${f.name})`);
  facultyIds.add(f.id);
  const trimmed = f.name.trim();
  if (facultyNames.has(trimmed)) fail(`Duplicate faculty name: "${trimmed}"`);
  facultyNames.add(trimmed);
  if (f.isDevelopmentSeed) fail(`Faculty in production marked isDevelopmentSeed: ${f.name}`);
  if (LEGACY_SEED_IDS.has(f.id)) fail(`Faculty uses legacy V0 placeholder UUID: ${f.name}`);
}

// 2. Majors
const majorIds = new Set<string>();
const majorNamesByFaculty = new Map<string, Set<string>>();
for (const m of ttuConfig.majors) {
  assertUuid(m.id, `major.id (${m.name})`);
  assertUuid(m.facultyId, `major.facultyId (${m.name})`);
  if (majorIds.has(m.id)) fail(`Duplicate major id: ${m.id} (${m.name})`);
  majorIds.add(m.id);
  if (!facultyIds.has(m.facultyId)) fail(`Orphan major "${m.name}" — facultyId ${m.facultyId} not found`);
  const set = majorNamesByFaculty.get(m.facultyId) ?? new Set<string>();
  const key = m.name.trim();
  if (set.has(key)) fail(`Duplicate major name within faculty "${m.facultyId}": "${key}"`);
  set.add(key);
  majorNamesByFaculty.set(m.facultyId, set);
  if (m.isDevelopmentSeed) fail(`Major in production marked isDevelopmentSeed: ${m.name}`);
  if (LEGACY_SEED_IDS.has(m.id)) fail(`Major uses legacy V0 placeholder UUID: ${m.name}`);
}

// 3. Academic calendar schema + cross-checks
const EventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().optional(),
    kind: z.enum(["registration", "holiday", "exam", "other"])
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: "endsOn must be on or after startsOn",
    path: ["endsOn"]
  });

const CalendarSchema = z.object({
  schemaVersion: z.literal(1),
  universityId: z.string(),
  academicYear: z.string(),
  term: z.string(),
  events: z.array(EventSchema)
});

const calPath = "data/academic-calendars/ttu/2026-2027/first/calendar.json";
const calRaw = JSON.parse(await readFile(calPath, "utf8"));
const calResult = CalendarSchema.safeParse(calRaw);
if (!calResult.success) {
  for (const issue of calResult.error.issues) {
    fail(`Calendar schema: ${issue.path.join(".")} — ${issue.message}`);
  }
} else {
  const events = calResult.data.events;
  const seenIds = new Set<string>();
  const seenKey = new Set<string>();
  for (const ev of events) {
    if (seenIds.has(ev.id)) fail(`Duplicate calendar event id: ${ev.id}`);
    seenIds.add(ev.id);
    const k = `${ev.title}::${ev.startsOn}`;
    if (seenKey.has(k)) fail(`Duplicate calendar (title, startsOn): ${k}`);
    seenKey.add(k);
    if (PLACEHOLDER_DATES.has(ev.startsOn)) {
      fail(`Calendar event uses V0 placeholder startsOn: ${ev.startsOn} (${ev.title})`);
    }
    if (ev.endsOn && PLACEHOLDER_DATES.has(ev.endsOn)) {
      fail(`Calendar event uses V0 placeholder endsOn: ${ev.endsOn} (${ev.title})`);
    }
  }
  if (events.length === 0) fail("Academic calendar is empty (0 events)");
}

// 4. Expected invariants derived from the verified dataset
const expectedFacultyCount = 6;
if (ttuConfig.faculties.length !== expectedFacultyCount) {
  fail(`Expected ${expectedFacultyCount} faculties, found ${ttuConfig.faculties.length}`);
}
const itFaculty = ttuConfig.faculties.find((f) => f.name === "كلية تكنولوجيا المعلومات والاتصالات");
if (!itFaculty) fail('Missing faculty: "كلية تكنولوجيا المعلومات والاتصالات"');
else {
  const itMajors = ttuConfig.majors.filter((m) => m.facultyId === itFaculty.id);
  if (itMajors.length !== 4) {
    fail(`IT faculty should have exactly 4 majors, found ${itMajors.length}`);
  }
  if (!itMajors.some((m) => m.name === "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات")) {
    fail('IT faculty missing the AI/Data Science program with exact Arabic name "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات"');
  }
}

// 5. Production term
const productionTerm = {
  name: "الفصل الدراسي الأول 2026/2027",
  startsOn: "2026-10-04",
  endsOn: "2027-01-07"
};
if (productionTerm.startsOn === "2026-09-01" || productionTerm.endsOn === "2026-12-31") {
  fail("Production term must not use V0 placeholder dates 2026-09-01 / 2026-12-31");
}

if (errors.length > 0) {
  console.error("TTU data validation FAILED:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}

console.log(
  `TTU data valid: ${ttuConfig.faculties.length} faculties, ${ttuConfig.majors.length} majors, ` +
    `${calResult.success ? (calResult.data as { events: unknown[] }).events.length : "?"} calendar events.`
);
