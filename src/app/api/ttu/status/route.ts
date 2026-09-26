import { TtuIntegrationStatusSchema } from "@/domain/ttu-api";
import {
  isTtuCalendarApiConfigured,
  isTtuCourseCatalogApiConfigured,
  isTtuStudentScheduleApiConfigured,
  readTtuApiConfig
} from "@/server/ttu-api/config";

export const runtime = "nodejs";

export async function GET() {
  const config = readTtuApiConfig();
  const academicCalendar = isTtuCalendarApiConfigured(config);
  const courseCatalog = isTtuCourseCatalogApiConfigured(config);
  const studentSchedule = isTtuStudentScheduleApiConfigured(config);
  const hasAnyOfficialCapability = academicCalendar || courseCatalog || studentSchedule;

  const status = TtuIntegrationStatusSchema.parse({
    universityId: "ttu",
    mode: hasAnyOfficialCapability ? "api-with-static-fallback" : "static-only",
    enabled: config.enabled,
    capabilities: {
      academicCalendar,
      courseCatalog,
      studentSchedule
    }
  });

  return Response.json(status, {
    headers: {
      "Cache-Control": "private, no-store"
    }
  });
}
