import { NextResponse } from "next/server";
import { XKiroScheduleExtractor } from "@/domain/ai/xkiro-extractor";
import { isSupportedMimeType, MAX_FILE_SIZE_BYTES } from "@/domain/ai/extraction-schema";
import { ScheduleExtractionResultSchema, type ScheduleExtractor } from "@/domain/models";

export const runtime = "nodejs";
export const maxDuration = 60;

// Allows overriding extractor during integration tests if needed
let defaultExtractor: ScheduleExtractor | null = null;
export function setTestScheduleExtractor(extractor: ScheduleExtractor | null) {
  defaultExtractor = extractor;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { success: false, error: "تعذر قراءة بيانات الطلب المرسلة." },
        { status: 400 }
      );
    }

    const consent = formData.get("consent");
    if (consent !== "true") {
      return NextResponse.json(
        { success: false, error: "الموافقة الصريحة على معالجة الملف مطلوبة لمتابعة التحليل." },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { success: false, error: "يرجى اختيار ملف صالح للجدول الدراسي (صورة أو PDF)." },
        { status: 400 }
      );
    }

    if (!isSupportedMimeType(file.type)) {
      return NextResponse.json(
        { success: false, error: "نوع الملف غير مدعوم. الصيغ المسموحة هي: JPG، PNG، WebP، و PDF فقط." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { success: false, error: "حجم الملف يتجاوز الحد الأقصى المسموح به (4 ميجابايت)." },
        { status: 400 }
      );
    }

    // Check API Key unless a test extractor is injected
    if (!defaultExtractor && !process.env.XKIRO_API_KEY) {
      return NextResponse.json(
        { success: false, error: "ميزة التحليل الذكي غير مهيأة في بيئة التشغيل الحالية." },
        { status: 503 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const extractor = defaultExtractor || new XKiroScheduleExtractor();
    const result = await extractor.extract({
      fileName: (file as any).name || "schedule_file",
      bytes,
      mimeType: file.type
    });

    const parsedResult = ScheduleExtractionResultSchema.parse(result);

    return NextResponse.json({
      success: true,
      result: parsedResult
    });
  } catch (error: any) {
    console.error("Schedule extraction error:", error);

    if (error.message === "AI_API_KEY_MISSING" || error.message === "GEMINI_API_KEY_MISSING") {
      return NextResponse.json(
        { success: false, error: "ميزة التحليل الذكي غير مهيأة في بيئة التشغيل الحالية." },
        { status: 503 }
      );
    }

    if (error.message === "AI_INVALID_KEY" || error.message === "GEMINI_API_INVALID_KEY") {
      return NextResponse.json(
        { success: false, error: "مفتاح التحليل غير صالح أو منتهي الصلاحية." },
        { status: 503 }
      );
    }

    if (
      error.message === "AI_MODEL_UNAVAILABLE" ||
      error.message === "GEMINI_MODEL_UNAVAILABLE" ||
      error.message?.includes("404")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "نموذج التحليل غير متاح حاليًا. يرجى تحديث إعدادات مزود الذكاء الاصطناعي أو المحاولة لاحقًا."
        },
        { status: 503 }
      );
    }

    if (
      error.message === "AI_SERVICE_UNAVAILABLE" ||
      error.message === "GEMINI_SERVICE_UNAVAILABLE" ||
      error.message?.includes("503")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "خدمة التحليل الذكي مشغولة حاليًا بسبب ضغط مرتفع. يرجى المحاولة مرة أخرى بعد قليل."
        },
        { status: 503 }
      );
    }

    if (
      error.message === "AI_RATE_LIMITED" ||
      error.message === "GEMINI_RATE_LIMITED" ||
      error.message?.includes("429")
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "تم الوصول إلى حد الاستخدام المؤقت لخدمة التحليل. يرجى المحاولة لاحقًا."
        },
        { status: 429 }
      );
    }

    if (error.message === "AI_INVALID_INPUT_PDF_PAGE_LIMIT") {
      return NextResponse.json(
        {
          success: false,
          error: "ملف PDF يتجاوز الحد الأقصى للصفحات المدعومة للجدول الدراسي (بحد أقصى 5 صفحات)."
        },
        { status: 400 }
      );
    }

    if (error.message === "AI_INVALID_INPUT_PDF_TOO_LARGE") {
      return NextResponse.json(
        {
          success: false,
          error: "أبعاد صفحات ملف PDF تتجاوز الحد المسموح به للمعالجة الآمنة."
        },
        { status: 400 }
      );
    }

    if (error.message === "AI_INVALID_INPUT_PAYLOAD_TOO_LARGE") {
      return NextResponse.json(
        {
          success: false,
          error: "حجم البيانات الناتجة عن معالجة صفحات الجدول يتجاوز الحد الداخلي الآمن للإرسال."
        },
        { status: 400 }
      );
    }

    if (error.message === "AI_INVALID_INPUT" || error.message === "GEMINI_INVALID_INPUT") {
      return NextResponse.json(
        {
          success: false,
          error: "تعذر على مزود الذكاء الاصطناعي معالجة هذا الملف. يرجى التأكد من وضوح الصورة وصلاحيتها والمحاولة مجددًا."
        },
        { status: 400 }
      );
    }

    if (
      error.message === "AI_INVALID_RESPONSE" ||
      error.message === "EMPTY_AI_RESPONSE" ||
      error.message === "INVALID_JSON_FROM_AI"
    ) {
      return NextResponse.json(
        {
          success: false,
          error: "تعذر قراءة نتائج التحليل من مزود الذكاء الاصطناعي. يرجى إعادة المحاولة."
        },
        { status: 502 }
      );
    }

    if (error.message === "AI_PROVIDER_TIMEOUT") {
      return NextResponse.json(
        { success: false, error: "استغرق تحليل الجدول وقتاً طويلاً. يرجى إعادة المحاولة أو التحقق من جودة الاتصال." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { success: false, error: "حدث خطأ غير متوقع أثناء تحليل الجدول. يرجى إعادة المحاولة." },
      { status: 500 }
    );
  }
}
