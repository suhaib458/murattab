import { TtuCalendarEnvelopeSchema } from "@/domain/ttu-api";
import { resolveTtuAcademicCalendar } from "@/server/ttu-api/calendar-service";

export const runtime = "nodejs";

export async function GET() {
  const result = TtuCalendarEnvelopeSchema.parse(await resolveTtuAcademicCalendar());

  return Response.json(result, {
    headers: {
      "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900"
    }
  });
}
