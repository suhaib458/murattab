import { TtuCourseCatalogEnvelopeSchema } from "@/domain/ttu-api";
import { TtuApiError } from "@/server/ttu-api/client";
import { resolveTtuCourseCatalog } from "@/server/ttu-api/course-catalog-service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const result = TtuCourseCatalogEnvelopeSchema.parse(await resolveTtuCourseCatalog());

    return Response.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900"
      }
    });
  } catch (error) {
    const unavailable = error instanceof TtuApiError && error.code === "CONFIG";

    return Response.json(
      {
        available: false,
        error: unavailable
          ? "تكامل دليل المواد الرسمي غير مفعّل حاليًا."
          : "تعذّر جلب دليل المواد الرسمي من الجامعة حاليًا."
      },
      {
        status: unavailable ? 503 : 502,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }
}
