import { z } from "zod";

export const dayCodes = ["س", "ح", "ن", "ث", "ر", "خ"] as const;
export type DayCode = (typeof dayCodes)[number];
export const sessionKinds = ["lecture", "lab", "unspecified"] as const;

export const FacultySchema = z.object({ id: z.string().uuid(), name: z.string().min(1), isDevelopmentSeed: z.boolean().default(false) });
export const MajorSchema = z.object({ id: z.string().uuid(), facultyId: z.string().uuid(), name: z.string().min(1), isDevelopmentSeed: z.boolean().default(false) });
export const UniversityConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  timezone: z.literal("Asia/Amman"),
  faculties: z.array(FacultySchema),
  majors: z.array(MajorSchema),
  // dayCodes is optional — the canonical alphabet lives in `dayCodes` const above.
  // Configurations may omit it; consumers must derive from `dayCodes` when needed.
  dayCodes: z.record(z.string(), z.enum(dayCodes)).optional()
});
export const AcademicTermSchema = z.object({ id: z.string().uuid(), name: z.string().min(1), startsOn: z.iso.date(), endsOn: z.iso.date(), isCurrent: z.boolean() }).refine((v) => v.endsOn >= v.startsOn, "تاريخ نهاية الفصل يجب أن يأتي بعد بدايته.");
export const RoomLocationSchema = z.object({ raw: z.string().min(1), label: z.string().min(1), isOnline: z.boolean().default(false) });
export const ReminderPreferenceSchema = z.object({ enabled: z.boolean(), minutesBefore: z.number().int().min(0).max(10080) });
export const ClassSessionSchema = z.object({ id: z.string().uuid(), courseId: z.string().uuid(), day: z.enum(dayCodes), startsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), endsAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), room: RoomLocationSchema, kind: z.enum(sessionKinds) }).refine((v) => v.endsAt > v.startsAt, { message: "وقت النهاية يجب أن يأتي بعد وقت البداية.", path: ["endsAt"] });
export const CourseSchema = z.object({ id: z.string().uuid(), termId: z.string().uuid(), name: z.string().min(1), reminder: ReminderPreferenceSchema, createdAt: z.iso.datetime() });
export const StudentProfileSchema = z.object({ id: z.string().uuid(), name: z.string().min(1), universityId: z.string(), facultyId: z.string().uuid(), majorId: z.string().uuid(), createdAt: z.iso.datetime() });
export const AppSettingsSchema = z.object({ id: z.literal("settings"), theme: z.enum(["light", "dark", "system"]), onboardingComplete: z.boolean(), splashShown: z.boolean(), activeTermId: z.string().uuid().nullable(), guideSeen: z.boolean().optional(), completedGuideVersion: z.number().int().nullable().optional(), guideAutoTrigger: z.boolean().optional(), schemaVersion: z.literal(1) });
export const CalendarEventSchema = z.object({ id: z.string(), title: z.string(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), description: z.string(), deepLink: z.string() });

/**
 * Academic calendar event kinds as published by TTU.
 * Student-relevant subset: registration windows, exams, holidays, teaching milestones.
 * "other" is reserved for institutional milestones (e.g. drop deadline, prohibition deadline).
 */
export const academicEventKinds = ["registration", "holiday", "exam", "other"] as const;
export type AcademicEventKind = (typeof academicEventKinds)[number];

export const AcademicCalendarEventSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    startsOn: z.iso.date(),
    endsOn: z.iso.date().optional(),
    kind: z.enum(academicEventKinds)
  })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, {
    message: "تاريخ نهاية الحدث يجب أن يكون في يوم البداية أو بعده.",
    path: ["endsOn"]
  });

export const AcademicCalendarSchema = z.object({
  schemaVersion: z.literal(1),
  universityId: z.string(),
  academicYear: z.string(),
  term: z.string(),
  events: z.array(AcademicCalendarEventSchema)
});

export const ExtractionIssueSchema = z.object({ field: z.string(), message: z.string(), severity: z.enum(["info", "warning", "error"]) });
export const DraftSessionSchema = z.object({
  id: z.string(),
  courseId: z.string().optional(),
  day: z.enum(dayCodes).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  roomRaw: z.string(),
  roomExpanded: z.string().optional(),
  kind: z.enum(sessionKinds).optional()
});
export const DraftCourseSchema = z.object({
  name: z.string(),
  sessions: z.array(DraftSessionSchema)
});
export const ScheduleImportDraftSchema = z.object({
  courses: z.array(DraftCourseSchema),
  issues: z.array(ExtractionIssueSchema)
});
export const ScheduleExtractionResultSchema = z.object({ draft: ScheduleImportDraftSchema, confidence: z.record(z.string(), z.number().min(0).max(1)) });
export const BackupSchema = z.object({ schemaVersion: z.literal(1), exportedAt: z.iso.datetime(), profile: StudentProfileSchema.nullable(), settings: AppSettingsSchema, terms: z.array(AcademicTermSchema), courses: z.array(CourseSchema), sessions: z.array(ClassSessionSchema) });

export type Faculty = z.infer<typeof FacultySchema>; export type Major = z.infer<typeof MajorSchema>; export type UniversityConfig = z.infer<typeof UniversityConfigSchema>; export type AcademicTerm = z.infer<typeof AcademicTermSchema>; export type RoomLocation = z.infer<typeof RoomLocationSchema>; export type ReminderPreference = z.infer<typeof ReminderPreferenceSchema>; export type ClassSession = z.infer<typeof ClassSessionSchema>; export type Course = z.infer<typeof CourseSchema>; export type StudentProfile = z.infer<typeof StudentProfileSchema>; export type AppSettings = z.infer<typeof AppSettingsSchema>; export type CalendarEvent = z.infer<typeof CalendarEventSchema>; export type AcademicCalendarEvent = z.infer<typeof AcademicCalendarEventSchema>; export type AcademicCalendar = z.infer<typeof AcademicCalendarSchema>; export type ExtractionIssue = z.infer<typeof ExtractionIssueSchema>; export type DraftSession = z.infer<typeof DraftSessionSchema>; export type DraftCourse = z.infer<typeof DraftCourseSchema>; export type ScheduleImportDraft = z.infer<typeof ScheduleImportDraftSchema>; export type ScheduleExtractionResult = z.infer<typeof ScheduleExtractionResultSchema>;

export interface ScheduleExtractor { extract(input: { fileName: string; bytes: Uint8Array; mimeType?: string }): Promise<ScheduleExtractionResult>; }
