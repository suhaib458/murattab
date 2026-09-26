import { z } from "zod";
import { AcademicCalendarSchema, dayCodes, sessionKinds } from "@/domain/models";

export const TtuApiDataSourceSchema = z.enum(["official-api", "local-static"]);
export type TtuApiDataSource = z.infer<typeof TtuApiDataSourceSchema>;

export const TtuCalendarMetaSchema = z.object({
  source: TtuApiDataSourceSchema,
  fetchedAt: z.iso.datetime(),
  apiConfigured: z.boolean(),
  fallbackReason: z.string().nullable()
});

export const TtuCalendarEnvelopeSchema = z.object({
  calendar: AcademicCalendarSchema,
  meta: TtuCalendarMetaSchema
});

export type TtuCalendarEnvelope = z.infer<typeof TtuCalendarEnvelopeSchema>;

const HhMmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const TtuCatalogSessionSchema = z
  .object({
    day: z.enum(dayCodes),
    startsAt: HhMmSchema,
    endsAt: HhMmSchema,
    room: z.string().min(1),
    kind: z.enum(sessionKinds).default("unspecified")
  })
  .refine((value) => value.endsAt > value.startsAt, {
    message: "وقت نهاية جلسة الشعبة يجب أن يأتي بعد وقت البداية.",
    path: ["endsAt"]
  });

export const TtuCourseSectionSchema = z.object({
  id: z.string().min(1),
  number: z.string().min(1).optional(),
  instructorName: z.string().min(1).optional(),
  capacity: z.number().int().nonnegative().optional(),
  enrolled: z.number().int().nonnegative().optional(),
  sessions: z.array(TtuCatalogSessionSchema)
});

export const TtuCatalogCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  creditHours: z.number().nonnegative().optional(),
  facultyId: z.string().min(1).optional(),
  majorId: z.string().min(1).optional(),
  sections: z.array(TtuCourseSectionSchema)
});

export const TtuCourseCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  universityId: z.literal("ttu"),
  academicYear: z.string().min(1),
  term: z.string().min(1),
  courses: z.array(TtuCatalogCourseSchema)
});

export type TtuCourseCatalog = z.infer<typeof TtuCourseCatalogSchema>;

export const TtuCourseCatalogEnvelopeSchema = z.object({
  catalog: TtuCourseCatalogSchema,
  meta: z.object({
    source: z.literal("official-api"),
    fetchedAt: z.iso.datetime(),
    apiConfigured: z.literal(true)
  })
});

export type TtuCourseCatalogEnvelope = z.infer<typeof TtuCourseCatalogEnvelopeSchema>;

export const TtuStudentScheduleCourseSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  sectionId: z.string().min(1),
  sectionNumber: z.string().min(1).optional(),
  instructorName: z.string().min(1).optional(),
  creditHours: z.number().nonnegative().optional(),
  sessions: z.array(TtuCatalogSessionSchema)
});

export const TtuStudentScheduleSchema = z.object({
  schemaVersion: z.literal(1),
  universityId: z.literal("ttu"),
  academicYear: z.string().min(1),
  term: z.string().min(1),
  courses: z.array(TtuStudentScheduleCourseSchema)
});

export type TtuStudentSchedule = z.infer<typeof TtuStudentScheduleSchema>;

export const TtuStudentScheduleEnvelopeSchema = z.object({
  schedule: TtuStudentScheduleSchema,
  meta: z.object({
    source: z.literal("official-api"),
    fetchedAt: z.iso.datetime(),
    apiConfigured: z.literal(true),
    authMode: z.literal("delegated-bearer")
  })
});

export type TtuStudentScheduleEnvelope = z.infer<typeof TtuStudentScheduleEnvelopeSchema>;

export const TtuIntegrationStatusSchema = z.object({
  universityId: z.literal("ttu"),
  mode: z.enum(["static-only", "api-with-static-fallback"]),
  enabled: z.boolean(),
  capabilities: z.object({
    academicCalendar: z.boolean(),
    courseCatalog: z.boolean(),
    studentSchedule: z.boolean()
  })
});

export type TtuIntegrationStatus = z.infer<typeof TtuIntegrationStatusSchema>;
