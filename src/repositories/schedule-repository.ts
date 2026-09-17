import type { AcademicTerm, AppSettings, ClassSession, Course, StudentProfile } from "@/domain/models";

export interface AppSnapshot { profile: StudentProfile | null; settings: AppSettings; terms: AcademicTerm[]; courses: Course[]; sessions: ClassSession[]; }
export interface ScheduleRepository {
  snapshot(): Promise<AppSnapshot>;
  bootstrap(profile: StudentProfile, term: AcademicTerm, settings: AppSettings): Promise<void>;
  saveProfile(profile: StudentProfile): Promise<void>;
  saveCourse(course: Course, sessions: ClassSession[]): Promise<void>;
  saveCourses(batch: Array<{ course: Course; sessions: ClassSession[] }>): Promise<void>;
  deleteCourse(courseId: string): Promise<void>;
  saveSettings(settings: AppSettings): Promise<void>;
  replace(snapshot: AppSnapshot): Promise<void>;
  clear(): Promise<void>;
}
