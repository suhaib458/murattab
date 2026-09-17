import { BackupSchema, type AcademicTerm, type AppSettings, type ClassSession, type Course, type StudentProfile } from "./models";

export function makeBackup(data: { profile: StudentProfile | null; settings: AppSettings; terms: AcademicTerm[]; courses: Course[]; sessions: ClassSession[] }) { return BackupSchema.parse({ schemaVersion: 1, exportedAt: new Date().toISOString(), ...data }); }
export function readBackup(value: unknown) { return BackupSchema.safeParse(value); }
