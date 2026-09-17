import type { AcademicTerm, ClassSession, Course } from "./models";
import { dayNames } from "./schedule";

const icsDate = (value: Date) => value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function generateIcs(courses: Course[], sessions: ClassSession[], term: AcademicTerm) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Murattab//AR"];
  for (const session of sessions) { const course = courses.find((item) => item.id === session.courseId); if (!course) continue; lines.push("BEGIN:VEVENT", `UID:${session.id}@murattab`, `SUMMARY:${course.name}`, `DESCRIPTION:${session.kind}\\n${session.room.label}`, `DTSTART;TZID=Asia/Amman:${term.startsOn.replaceAll("-", "")}T${session.startsAt.replace(":", "")}00`, `DTEND;TZID=Asia/Amman:${term.startsOn.replaceAll("-", "")}T${session.endsAt.replace(":", "")}00`, `RRULE:FREQ=WEEKLY;UNTIL=${term.endsOn.replaceAll("-", "")}T235959Z`, `URL:https://murattab.local/course/${course.id}`, `X-MURATTAB-DAY:${dayNames[session.day]}`, "END:VEVENT"); }
  return `${lines.concat("END:VCALENDAR").join("\r\n")}\r\n`;
}
export { icsDate };
