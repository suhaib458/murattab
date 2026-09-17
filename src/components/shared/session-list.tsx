import type { ClassSession, Course } from "@/domain/models";
import { formatArabicTime } from "@/domain/schedule";

export function SessionList({
  sessions,
  courses,
  empty
}: {
  sessions: ClassSession[];
  courses: Course[];
  empty: string;
}) {
  if (!sessions.length) return <div className="card empty">{empty}</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sessions.map((session) => {
        const course = courses.find((item) => item.id === session.courseId);
        return (
          <article className="session-card" key={session.id}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={`kind ${session.kind === "lab" ? "lab" : ""}`}>
                  {session.kind === "lecture" ? "نظري" : session.kind === "lab" ? "عملي" : "غير محدد"}
                </span>
              </div>
              <h3>{course?.name ?? "مادة غير معروفة"}</h3>
              <p className="room-line">{session.room.label}</p>
            </div>
            <div className="time-block">
              <div className="start">{formatArabicTime(session.startsAt)}</div>
              <div className="end">— {formatArabicTime(session.endsAt)}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
