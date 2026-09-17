import { readFile } from "node:fs/promises";
import { z } from "zod";

const CalendarSchema = z.object({ schemaVersion: z.literal(1), universityId: z.string(), academicYear: z.string(), term: z.string(), events: z.array(z.object({ id: z.string(), title: z.string(), startsOn: z.iso.date(), endsOn: z.iso.date(), kind: z.enum(["registration", "holiday", "exam", "other"]) })) });
const path = process.argv[2] ?? "data/academic-calendars/ttu/2026-2027/first/calendar.json";
const result = CalendarSchema.safeParse(JSON.parse(await readFile(path, "utf8")));
if (!result.success) { console.error(result.error.issues); process.exit(1); }
console.log(`Calendar valid: ${result.data.universityId}/${result.data.term} (${result.data.events.length} events)`);
