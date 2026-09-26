import { z } from "zod";
import { AcademicCalendarSchema } from "@/domain/models";

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
