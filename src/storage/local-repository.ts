import { AppSettingsSchema, AcademicTermSchema, type AcademicTerm, type AppSettings, type StudentProfile, type Course, type ClassSession } from "@/domain/models";
import type { AppSnapshot, ScheduleRepository } from "@/repositories/schedule-repository";
import { db } from "./db";

export const initialSettings: AppSettings = { id: "settings", theme: "system", onboardingComplete: false, splashShown: false, activeTermId: null, guideSeen: false, schemaVersion: 1 };

/**
 * Production AcademicTerm for the verified TTU 2026/2027 first semester.
 * Used as the migration target for legacy placeholder terms.
 *
 * ID is a fixed UUID literal so the same production term is referenced
 * consistently across reload / build / backup / restore.
 */
export const PRODUCTION_TERM_ID = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";

export const PRODUCTION_TERM: AcademicTerm = AcademicTermSchema.parse({
  id: PRODUCTION_TERM_ID,
  name: "الفصل الدراسي الأول 2026/2027",
  startsOn: "2026-10-04",
  endsOn: "2027-01-07",
  isCurrent: true
});

/**
 * Detect and rewrite a legacy V0 placeholder term created during Foundation.
 * Returns the migrated term list (and a possibly-updated activeTermId) and a
 * `migrated` flag indicating whether any rewrite occurred.
 *
 * Conditions for migration (ALL must hold for a term to be rewritten):
 *   1. name == "الفصل الحالي"
 *   2. startsOn == "2026-09-01"
 *   3. endsOn   == "2026-12-31"
 *   4. isCurrent == true
 *
 * We do NOT modify any other term the user may have created manually.
 */
export function migrateLegacyTerms(
  terms: AcademicTerm[],
  activeTermId: string | null
): { terms: AcademicTerm[]; activeTermId: string | null; migrated: boolean } {
  let migrated = false;
  const next = terms.map((t) => {
    if (
      t.name === "الفصل الحالي" &&
      t.startsOn === "2026-09-01" &&
      t.endsOn === "2026-12-31" &&
      t.isCurrent
    ) {
      migrated = true;
      return PRODUCTION_TERM;
    }
    return t;
  });
  // If the active term was the legacy one and we replaced it, point active at the production term.
  if (migrated && activeTermId && next.some((t) => t.id === activeTermId) === false) {
    return { terms: next, activeTermId: PRODUCTION_TERM.id, migrated };
  }
  return { terms: next, activeTermId, migrated };
}

export class LocalScheduleRepository implements ScheduleRepository {
  private profiles = db.table<StudentProfile, string>("profiles");
  private settings = db.table<AppSettings, string>("settings");
  private terms = db.table<import("@/domain/models").AcademicTerm, string>("terms");
  private courses = db.table<Course, string>("courses");
  private sessions = db.table<ClassSession, string>("sessions");
  private key = "murattab-fallback-v1";
  private memoryFallback: AppSnapshot = { profile: null, settings: initialSettings, terms: [], courses: [], sessions: [] };

  private fallback(): AppSnapshot {
    if (typeof localStorage === "undefined") {
      return this.memoryFallback;
    }
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return this.memoryFallback;
      const snapshot = JSON.parse(raw) as AppSnapshot;
      // Apply legacy term migration to the fallback snapshot too.
      const migration = migrateLegacyTerms(snapshot.terms ?? [], snapshot.settings?.activeTermId ?? null);
      if (migration.migrated) {
        const next: AppSnapshot = {
          ...snapshot,
          terms: migration.terms,
          settings: migration.activeTermId !== snapshot.settings.activeTermId
            ? { ...snapshot.settings, activeTermId: migration.activeTermId }
            : snapshot.settings
        };
        this.saveFallback(next);
        return next;
      }
      return snapshot;
    } catch {
      return this.memoryFallback;
    }
  }

  private saveFallback(snapshot: AppSnapshot): void {
    this.memoryFallback = snapshot;
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(this.key, JSON.stringify(snapshot));
    } catch (e) {
      console.warn("Unable to write to localStorage fallback:", e);
    }
  }

  private async dexieSnapshot(): Promise<AppSnapshot> {
    const rawSettings = await this.settings.get("settings");
    const parsedSettings = rawSettings ? (AppSettingsSchema.safeParse(rawSettings).data ?? initialSettings) : initialSettings;
    const profiles = await this.profiles.toArray();
    const rawTerms = await this.terms.toArray();
    const courses = await this.courses.toArray();
    const sessions = await this.sessions.toArray();

    // Phase 3C: rewrite legacy V0 placeholder term to the verified production term.
    const migration = migrateLegacyTerms(rawTerms, parsedSettings.activeTermId);
    if (migration.migrated) {
      try {
        await db.transaction("rw", this.terms, this.settings, async () => {
          // Replace legacy term with the production one (keep the production id stable).
          await this.terms.clear();
          if (migration.terms.length) await this.terms.bulkPut(migration.terms);
          if (migration.activeTermId !== parsedSettings.activeTermId) {
            await this.settings.put({ ...parsedSettings, activeTermId: migration.activeTermId });
          }
        });
      } catch (err) {
        console.warn("Legacy term migration failed:", err);
      }
    }

    return {
      profile: profiles[0] ?? null,
      settings: migration.migrated && migration.activeTermId !== parsedSettings.activeTermId
        ? { ...parsedSettings, activeTermId: migration.activeTermId }
        : parsedSettings,
      terms: migration.terms,
      courses,
      sessions
    };
  }

  async snapshot(): Promise<AppSnapshot> {
    if (typeof window === "undefined" || typeof indexedDB === "undefined") {
      return this.fallback();
    }

    try {
      const dexieData = await this.dexieSnapshot();
      const fbData = this.fallback();

      // If Dexie has no data yet but fallback has profile or courses, restore into Dexie
      if (!dexieData.profile && dexieData.courses.length === 0 && (fbData.profile || fbData.courses.length > 0)) {
        await this.syncToDexie(fbData);
        return fbData;
      }

      // Sync latest to fallback to maintain persistence guarantee
      if (dexieData.profile || dexieData.courses.length > 0) {
        this.saveFallback(dexieData);
      }

      return dexieData;
    } catch (error) {
      console.warn("IndexedDB read failed, falling back to localStorage:", error);
      return this.fallback();
    }
  }

  private async syncToDexie(snapshot: AppSnapshot): Promise<void> {
    try {
      await db.transaction("rw", this.profiles, this.settings, this.terms, this.courses, this.sessions, async () => {
        await Promise.all([this.profiles.clear(), this.settings.clear(), this.terms.clear(), this.courses.clear(), this.sessions.clear()]);
        if (snapshot.profile) await this.profiles.put(snapshot.profile);
        await this.settings.put(snapshot.settings);
        if (snapshot.terms.length) await this.terms.bulkPut(snapshot.terms);
        if (snapshot.courses.length) await this.courses.bulkPut(snapshot.courses);
        if (snapshot.sessions.length) await this.sessions.bulkPut(snapshot.sessions);
      });
    } catch (err) {
      console.warn("syncToDexie error:", err);
    }
  }

  async saveProfile(profile: StudentProfile): Promise<void> {
    const next = { ...(await this.snapshot()), profile };
    this.saveFallback(next);
    try {
      await this.profiles.put(profile);
    } catch (err) {
      console.warn("Dexie put profile failed:", err);
    }
  }

  async bootstrap(profile: StudentProfile, term: import("@/domain/models").AcademicTerm, settings: AppSettings): Promise<void> {
    const next: AppSnapshot = { profile, settings, terms: [term], courses: [], sessions: [] };
    this.saveFallback(next);
    try {
      await db.transaction("rw", this.profiles, this.terms, this.settings, async () => {
        await this.profiles.put(profile);
        await this.terms.put(term);
        await this.settings.put(AppSettingsSchema.parse(settings));
      });
    } catch (err) {
      console.warn("Dexie bootstrap transaction failed:", err);
    }
  }

  async saveCourse(course: Course, sessions: ClassSession[]): Promise<void> {
    await this.saveCourses([{ course, sessions }]);
  }

  async saveCourses(batch: Array<{ course: Course; sessions: ClassSession[] }>): Promise<void> {
    const current = await this.snapshot();
    const incomingIds = new Set(batch.map((b) => b.course.id));
    const next: AppSnapshot = {
      ...current,
      courses: [...current.courses.filter((item) => !incomingIds.has(item.id)), ...batch.map((b) => b.course)],
      sessions: [...current.sessions.filter((item) => !incomingIds.has(item.courseId)), ...batch.flatMap((b) => b.sessions)]
    };
    this.saveFallback(next);
    try {
      await db.transaction("rw", this.courses, this.sessions, async () => {
        for (const item of batch) {
          await this.courses.put(item.course);
          await this.sessions.where("courseId").equals(item.course.id).delete();
          await this.sessions.bulkPut(item.sessions);
        }
      });
    } catch (err) {
      console.warn("Dexie saveCourses failed:", err);
    }
  }

  async deleteCourse(courseId: string): Promise<void> {
    const current = await this.snapshot();
    const next: AppSnapshot = {
      ...current,
      courses: current.courses.filter((item) => item.id !== courseId),
      sessions: current.sessions.filter((item) => item.courseId !== courseId)
    };
    this.saveFallback(next);
    try {
      await db.transaction("rw", this.courses, this.sessions, async () => {
        await this.courses.delete(courseId);
        await this.sessions.where("courseId").equals(courseId).delete();
      });
    } catch (err) {
      console.warn("Dexie deleteCourse failed:", err);
    }
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    const current = await this.snapshot();
    const validated = AppSettingsSchema.parse(settings);
    this.saveFallback({ ...current, settings: validated });
    try {
      await this.settings.put(validated);
    } catch (err) {
      console.warn("Dexie saveSettings failed:", err);
    }
  }

  async replace(snapshot: AppSnapshot): Promise<void> {
    // Apply legacy term migration to the incoming snapshot (e.g. backup restore).
    const migration = migrateLegacyTerms(snapshot.terms ?? [], snapshot.settings?.activeTermId ?? null);
    const next: AppSnapshot = migration.migrated
      ? {
          ...snapshot,
          terms: migration.terms,
          settings: migration.activeTermId !== snapshot.settings.activeTermId
            ? { ...snapshot.settings, activeTermId: migration.activeTermId }
            : snapshot.settings
        }
      : snapshot;
    this.saveFallback(next);
    await this.syncToDexie(next);
  }

  async clear(): Promise<void> {
    const empty: AppSnapshot = { profile: null, settings: initialSettings, terms: [], courses: [], sessions: [] };
    this.saveFallback(empty);
    try {
      await Promise.all([
        this.profiles.clear(),
        this.settings.clear(),
        this.terms.clear(),
        this.courses.clear(),
        this.sessions.clear()
      ]);
    } catch (err) {
      console.warn("Dexie clear failed:", err);
    }
  }
}
