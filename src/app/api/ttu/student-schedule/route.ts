import { TtuStudentScheduleEnvelopeSchema } from "@/domain/ttu-api";
import { TtuApiError } from "@/server/ttu-api/client";
import { resolveTtuStudentSchedule } from "@/server/ttu-api/student-schedule-service";

export const runtime = "nodejs";

function isTrustedMurattabRequest(request: Request): boolean {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin) return false;

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  return request.headers.get("x-murattab-client") === "web";
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization) return null;

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export async function GET(request: Request) {
  if (!isTrustedMurattabRequest(request)) {
    return Response.json(
      { available: false, error: "طلب جدول الطالب غير مسموح من هذا المصدر." },
      { status: 403, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  const delegatedToken = readBearerToken(request);
  if (!delegatedToken) {
    return Response.json(
      {
        available: false,
        error: "يلزم تسجيل دخول جامعي مصرح به للوصول إلى الجدول الرسمي."
      },
      { status: 401, headers: { "Cache-Control": "private, no-store" } }
    );
  }

  try {
    const result = TtuStudentScheduleEnvelopeSchema.parse(
      await resolveTtuStudentSchedule(delegatedToken)
    );

    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    const unavailable = error instanceof TtuApiError && error.code === "CONFIG";

    return Response.json(
      {
        available: false,
        error: unavailable
          ? "تكامل جدول الطالب الرسمي غير مفعّل حاليًا."
          : "تعذّر جلب جدول الطالب الرسمي من الجامعة حاليًا."
      },
      {
        status: unavailable ? 503 : 502,
        headers: { "Cache-Control": "private, no-store" }
      }
    );
  }
}
