import { readFile } from "node:fs/promises";
import { z } from "zod";

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

const path = process.argv[2] ?? "data/academic-calendars/ttu/2026-2027/first/calendar.json";
const result = CalendarSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
if (!result.success) {
  console.error(result.error.issues);
  process.exit(1);
}

// Cross-event checks: unique IDs, no duplicate (title + startsOn) tuples.
const events = result.data.events;
const seenIds = new Set<string>();
const seenKey = new Set<string>();
for (const ev of events) {
  if (seenIds.has(ev.id)) {
    console.error(`Duplicate event id: ${ev.id}`);
    process.exit(1);
  }
  seenIds.add(ev.id);
  const k = `${ev.title}::${ev.startsOn}`;
  if (seenKey.has(k)) {
    console.error(`Duplicate event (title, startsOn): ${k}`);
    process.exit(1);
  }
  seenKey.add(k);
}

console.log(`Calendar valid: ${result.data.universityId}/${result.data.term} (${events.length} events)`);
