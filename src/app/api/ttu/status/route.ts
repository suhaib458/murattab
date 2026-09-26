import { TtuIntegrationStatusSchema } from "@/domain/ttu-api";
import {
  isTtuCalendarApiConfigured,
  readTtuApiConfig
} from "@/server/ttu-api/config";

export const runtime = "nodejs";

export async function GET() {
  const config = readTtuApiConfig();
  const academicCalendar = isTtuCalendarApiConfigured(config);

  const status = TtuIntegrationStatusSchema.parse({
    universityId: "ttu",
    mode: academicCalendar ? "api-with-static-fallback" : "static-only",
    enabled: config.enabled,
    capabilities: {
      academicCalendar,
      courseCatalog: Boolean(config.enabled && config.baseUrl && config.courseCatalogPath),
      studentSchedule: Boolean(config.enabled && config.baseUrl && config.studentSchedulePath)
    }
  });

  return Response.json(status, {
    headers: {
      "Cache-Control": "private, no-store"
    }
  });
}
