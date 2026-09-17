import Dexie, { type EntityTable } from "dexie";
import type { AcademicTerm, AppSettings, ClassSession, Course, StudentProfile } from "@/domain/models";

export class MurattabDatabase extends Dexie {
  profiles!: EntityTable<StudentProfile, "id">; settings!: EntityTable<AppSettings, "id">; terms!: EntityTable<AcademicTerm, "id">; courses!: EntityTable<Course, "id">; sessions!: EntityTable<ClassSession, "id">;
  constructor() { super("murattab"); this.version(1).stores({ profiles: "id", settings: "id", terms: "id,isCurrent", courses: "id,termId", sessions: "id,courseId,day" }); }
}
export const db = new MurattabDatabase();
