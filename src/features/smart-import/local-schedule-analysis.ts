/**
 * Local Schedule Analysis Orchestrator.
 *
 * Coordinates the full browser-only schedule analysis pipeline:
 * LocalOcrEngine (Tesseract.js)
 * -> parseTtuTableGeometry (Phase 2 Geometry Parser)
 * -> parseTtuScheduleSemantics (Phase 3 Semantic Parser)
 * -> toScheduleExtractionResult (ScheduleExtractionResult Adapter)
 *
 * Invariants:
 * - 100% Client-side. The image never leaves the browser.
 * - Dynamic import of LocalOcrEngine ensures no SSR or server-side bundling.
 * - Progress callbacks report local stages without network/upload claims.
 * - Geometry issues are preserved in the final extraction result.
 * - Hard failure if 0 course rows or 0 courses extracted.
 */

import type { ScheduleExtractionResult, ExtractionIssue } from "@/domain/models";
import type { LocalOcrEngine } from "@/domain/ocr/tesseract-engine";
import { parseTtuTableGeometry } from "@/domain/ttu-table";
import { parseTtuScheduleSemantics, toScheduleExtractionResult } from "@/domain/ttu-schedule-parser";

export interface LocalAnalysisOptions {
  onProgress?: (stage: string) => void;
  signal?: AbortSignal;
  ocrEngine?: LocalOcrEngine;
}

export class LocalAnalysisError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LocalAnalysisError";
    this.code = code;
  }
}

/**
 * Stages of local image schedule analysis.
 */
export const LOCAL_ANALYSIS_STAGES = {
  PREPARING: "تجهيز الصورة محليًا…",
  RECOGNIZING: "قراءة النص من الجدول على جهازك…",
  GEOMETRY: "تحديد صفوف وأعمدة الجدول…",
  REFINING: "تحسين قراءة بعض الخلايا…",
  SEMANTICS: "تحليل الأيام والمواعيد والقاعات…",
  FINALIZING: "تجهيز النتائج للمراجعة…"
} as const;

/**
 * Analyzes a schedule image entirely within the client's browser.
 *
 * @param file - Input image file or blob (PNG, JPEG, WebP)
 * @param options - Progress callback and optional existing engine instance
 */
export async function analyzeScheduleImageLocally(
  file: Blob | File,
  options?: LocalAnalysisOptions
): Promise<ScheduleExtractionResult> {
  const onProgress = options?.onProgress;

  // Stage 1: Preparing image & engine
  onProgress?.(LOCAL_ANALYSIS_STAGES.PREPARING);

  // Dynamic import of LocalOcrEngine ensures clean browser-only usage
  const { LocalOcrEngine } = await import("@/domain/ocr/tesseract-engine");
  const engine = options?.ocrEngine ?? new LocalOcrEngine();

  // Stage 2: OCR Recognition
  onProgress?.(LOCAL_ANALYSIS_STAGES.RECOGNIZING);
  const ocrResult = await engine.recognizeImage(file);

  // Stage 3: Table Geometry
  onProgress?.(LOCAL_ANALYSIS_STAGES.GEOMETRY);
  const geometryResult = parseTtuTableGeometry(ocrResult);

  if (!geometryResult.rows || geometryResult.rows.length === 0) {
    throw new LocalAnalysisError(
      "NO_TABLE_DETECTED",
      "لم يتم العثور على جدول دراسي واضح في الصورة."
    );
  }

  // Baseline Semantic Parsing to identify problematic cells
  const baselineSemantics = parseTtuScheduleSemantics(geometryResult);

  // Stage 4: Targeted Cell Refinement (Phase 5B)
  const { refineTableCells } = await import("./local-cell-refinement");
  const { refinedGeometry } = await refineTableCells(file, geometryResult, engine, {
    onProgress,
    signal: options?.signal,
    baselineSemantics,
  });

  // Stage 5: Final Semantic Parsing on refined geometry
  onProgress?.(LOCAL_ANALYSIS_STAGES.SEMANTICS);
  const semanticResult = parseTtuScheduleSemantics(refinedGeometry);

  if (!semanticResult.courses || semanticResult.courses.length === 0) {
    throw new LocalAnalysisError(
      "NO_COURSES_DETECTED",
      "لم يتم العثور على أي مواد دراسية صالحة في الجدول."
    );
  }

  // Stage 6: Adaptation & Geometry Issue Preservation
  onProgress?.(LOCAL_ANALYSIS_STAGES.FINALIZING);
  const extractionResult = toScheduleExtractionResult(semanticResult);

  // Merge Phase 2 geometry issues into draft issues without duplicates
  const existingMessages = new Set(extractionResult.draft.issues.map((i) => i.message));

  for (const geoIssue of refinedGeometry.issues) {
    if (!existingMessages.has(geoIssue.message)) {
      existingMessages.add(geoIssue.message);
      const mappedIssue: ExtractionIssue = {
        field: geoIssue.column ? `column_${geoIssue.column}` : "table_geometry",
        message: geoIssue.message,
        severity: geoIssue.severity
      };
      extractionResult.draft.issues.push(mappedIssue);
    }
  }

  return extractionResult;
}
