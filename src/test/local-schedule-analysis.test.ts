import { describe, expect, it, vi } from "vitest";
import type { OcrImageResult } from "@/domain/ocr/types";
import {
  analyzeScheduleImageLocally,
  LocalAnalysisError,
  LOCAL_ANALYSIS_STAGES
} from "@/features/smart-import/local-schedule-analysis";
import { buildEditableReviewCourses } from "@/features/smart-import/components/import-dialog";
import { toScheduleExtractionResult } from "@/domain/ttu-schedule-parser";
import type { TtuParsedSchedule } from "@/domain/ttu-schedule-parser/types";
import type { Course } from "@/domain/models";

// Mock helper to create synthetic OCR image results
function createMockOcrResult(lines: Array<{ text: string; y0: number; y1: number }>): OcrImageResult {
  const ocrLines = lines.map((l) => ({
    text: l.text,
    confidence: 0.95,
    bbox: { x0: 50, y0: l.y0, x1: 950, y1: l.y1 },
    words: l.text.split(/\s+/).map((w, idx) => ({
      text: w,
      confidence: 0.95,
      bbox: { x0: 50 + idx * 80, y0: l.y0, x1: 120 + idx * 80, y1: l.y1 }
    }))
  }));

  return {
    text: lines.map((l) => l.text).join("\n"),
    confidence: 0.95,
    width: 1000,
    height: 800,
    lines: ocrLines,
    words: ocrLines.flatMap((l) => l.words)
  };
}

describe("Local Schedule Analysis Integration Layer", () => {
  it("orchestrates OCR -> Geometry -> Semantics -> Adapter with full pipeline integration", async () => {
    // Synthetic TTU schedule lines
    const mockOcr = createMockOcrResult([
      { text: "جامعة الطفيلة التقنية", y0: 30, y1: 55 },
      { text: "اسم المادة الشعبة س.م الموعد القاعة", y0: 70, y1: 95 },
      { text: "تصميم الدوائر المنطقية 1 3 ح ث 11:30 - 13:00 DS-ICT 2", y0: 120, y1: 155 },
      { text: "شبكات الحاسوب 1 3 ح ث 08:30 - 10:00 DS-ICT 3", y0: 170, y1: 205 },
      { text: "تاريخ الطباعة 2026/09/20 - صفحة 1 من 1", y0: 300, y1: 325 }
    ]);

    const mockEngine = {
      recognizeImage: vi.fn().mockResolvedValue(mockOcr),
      dispose: vi.fn().mockResolvedValue(undefined)
    } as any;

    const stages: string[] = [];
    const dummyBlob = new Blob(["fake-image"], { type: "image/png" });

    const result = await analyzeScheduleImageLocally(dummyBlob, {
      ocrEngine: mockEngine,
      onProgress: (stage) => stages.push(stage)
    });

    // 1. Verify all stages were reported
    expect(stages).toContain(LOCAL_ANALYSIS_STAGES.PREPARING);
    expect(stages).toContain(LOCAL_ANALYSIS_STAGES.RECOGNIZING);
    expect(stages).toContain(LOCAL_ANALYSIS_STAGES.GEOMETRY);
    expect(stages).toContain(LOCAL_ANALYSIS_STAGES.SEMANTICS);
    expect(stages).toContain(LOCAL_ANALYSIS_STAGES.FINALIZING);

    // 2. Verify courses were extracted
    expect(result.draft.courses.length).toBeGreaterThanOrEqual(1);

    // 3. Verify Phase 2 geometry issues were preserved (footer detected)
    const footerIssue = result.draft.issues.find((i) => i.message.includes("تاريخ الطباعة") || i.field === "table_geometry");
    expect(footerIssue).toBeDefined();

    // 4. Verify course confidence key compatibility
    const firstCourse = result.draft.courses[0];
    const courseId = firstCourse.sessions[0]?.courseId;
    expect(courseId).toBeDefined();
    expect(result.confidence[`course_${courseId}_name`]).toBeDefined();
  });

  it("throws LocalAnalysisError when no table structure or zero course rows are detected", async () => {
    // Blank or non-schedule OCR text
    const emptyOcr = createMockOcrResult([
      { text: "مرحبا بكم في الصفحة الرئيسية", y0: 50, y1: 80 }
    ]);

    const mockEngine = {
      recognizeImage: vi.fn().mockResolvedValue(emptyOcr),
      dispose: vi.fn()
    } as any;

    const dummyBlob = new Blob(["fake"], { type: "image/png" });

    await expect(
      analyzeScheduleImageLocally(dummyBlob, { ocrEngine: mockEngine })
    ).rejects.toThrow(LocalAnalysisError);
  });

  it("preserves unresolved fields as null/empty without inventing defaults", async () => {
    // Schedule with course having invalid/unresolved day & time
    const mockOcr = createMockOcrResult([
      { text: "اسم المادة الشعبة س.م الموعد القاعة", y0: 70, y1: 95 },
      { text: "مادة تجريبية 1 3 11:00 - 10:30 207 م", y0: 120, y1: 155 } // reversed time, missing day
    ]);

    const mockEngine = {
      recognizeImage: vi.fn().mockResolvedValue(mockOcr),
      dispose: vi.fn()
    } as any;

    const dummyBlob = new Blob(["fake"], { type: "image/png" });
    const result = await analyzeScheduleImageLocally(dummyBlob, { ocrEngine: mockEngine });

    expect(result.draft.courses).toHaveLength(1);
    const sess = result.draft.courses[0].sessions[0];
    // Must remain unresolved
    expect(sess.startsAt).toBeNull();
    expect(sess.endsAt).toBeNull();
  });
});

describe("buildEditableReviewCourses Shared Review Mapper", () => {
  const mockExistingCourses: Course[] = [
    {
      id: "course-uuid-1",
      termId: "term-1",
      name: "شبكات الحاسوب",
      reminder: { enabled: true, minutesBefore: 15 },
      createdAt: "2026-09-20T00:00:00Z"
    }
  ];

  it("correctly maps extraction result into EditableCourse structure with confidence reading", () => {
    const extractionResult = {
      draft: {
        courses: [
          {
            name: "تصميم الدوائر المنطقية",
            sessions: [
              {
                id: "sess-1",
                courseId: "cid-logic",
                day: "ح" as const,
                startsAt: "11:30",
                endsAt: "13:00",
                roomRaw: "DS-ICT 2",
                kind: "unspecified" as const
              }
            ]
          }
        ],
        issues: []
      },
      confidence: {
        "course_cid-logic_name": 0.94,
        "session_sess-1_day": 0.95,
        "session_sess-1_time": 0.95,
        "session_sess-1_room": 0.90
      }
    };

    const reviewCourses = buildEditableReviewCourses(extractionResult, mockExistingCourses);
    expect(reviewCourses).toHaveLength(1);

    const c = reviewCourses[0];
    expect(c.name).toBe("تصميم الدوائر المنطقية");
    expect(c.nameConfidence).toBe(0.94);
    expect(c.duplicateAction).toBe("add");
    expect(c.sessions).toHaveLength(1);
    expect(c.sessions[0].day).toBe("ح");
    expect(c.sessions[0].startsAt).toBe("11:30");
    expect(c.sessions[0].endsAt).toBe("13:00");
    expect(c.sessions[0].roomRaw).toBe("DS-ICT 2");
    expect(c.sessions[0].confidenceDay).toBe(0.95);
  });

  it("identifies duplicate courses against existing schedule and defaults duplicateAction to 'replace'", () => {
    const extractionResult = {
      draft: {
        courses: [
          {
            name: "شبكات الحاسوب", // Matches mockExistingCourses!
            sessions: [
              {
                id: "sess-net",
                courseId: "cid-net",
                day: "ث" as const,
                startsAt: "08:30",
                endsAt: "10:00",
                roomRaw: "DS-ICT 3",
                kind: "unspecified" as const
              }
            ]
          }
        ],
        issues: []
      },
      confidence: {
        course_cid_net_name: 0.95
      }
    };

    const reviewCourses = buildEditableReviewCourses(extractionResult, mockExistingCourses);
    expect(reviewCourses[0].duplicateAction).toBe("replace");
  });

  it("proves buildEditableReviewCourses retrieves name confidence via adapter-generated courseId", () => {
    // 1. Create a pure semantic parser result
    const pureSemanticResult: TtuParsedSchedule = {
      courses: [
        {
          courseName: "تراكيب البيانات",
          rawCourseName: "تراكيب البيانات",
          confidence: 0.88,
          sessions: [
            {
              day: "ح",
              startsAt: "09:30",
              endsAt: "11:00",
              roomRaw: "208 م",
              roomExpanded: "مجمع القاعات – قاعة 208",
              kind: "lecture",
              source: {
                meetingSegmentText: "ح 09:30 - 11:00",
                roomSegmentText: "208 م"
              },
              confidence: {
                day: 0.95,
                time: 0.92,
                room: 0.89,
                pairing: 0.95
              }
            }
          ]
        }
      ],
      issues: [],
      confidence: 0.88
    };

    // 2. Pass through adapter to generate canonical ScheduleExtractionResult
    const extractionResult = toScheduleExtractionResult(pureSemanticResult);

    // Verify courseId contract
    const generatedCourseId = extractionResult.draft.courses[0].sessions[0].courseId;
    expect(generatedCourseId).toBeDefined();
    // Canonical key exists
    expect(extractionResult.confidence[`course_${generatedCourseId}_name`]).toBe(0.88);

    // 3. Pass extractionResult to ImportDialog's review mapper
    const reviewCourses = buildEditableReviewCourses(extractionResult, []);
    expect(reviewCourses).toHaveLength(1);

    // Prove nameConfidence was retrieved from course_${generatedCourseId}_name
    expect(reviewCourses[0].name).toBe("تراكيب البيانات");
    expect(reviewCourses[0].nameConfidence).toBe(0.88);
  });

  describe("Analysis Attempt Token Invalidation (Cancellation Safety)", () => {
    it("discards results from stale attempts when a new run or cancellation occurs", async () => {
      let activeAttempt = 0;
      let reviewResult: any = null;
      let errorMessage: string | null = null;

      // Simulated runner adhering to the ImportDialog attempt token contract
      const runAttempt = async (
        attemptNum: number,
        task: () => Promise<any>
      ) => {
        try {
          const res = await task();
          if (attemptNum !== activeAttempt) return; // Discard stale result
          reviewResult = res;
        } catch (err: any) {
          if (attemptNum !== activeAttempt) return; // Do not show error for stale run
          errorMessage = err.message;
        }
      };

      // 1. Run 1 starts
      activeAttempt += 1;
      const attempt1 = activeAttempt;
      let resolveRun1: (v: any) => void;
      const promise1 = new Promise((resolve) => {
        resolveRun1 = resolve;
      });
      const run1Task = runAttempt(attempt1, () => promise1);

      // 2. User selects new file or cancels -> activeAttempt increments
      activeAttempt += 1;
      const attempt2 = activeAttempt;
      const run2Task = runAttempt(attempt2, async () => "result-from-attempt-2");

      // Wait for run 2 to finish
      await run2Task;
      expect(reviewResult).toBe("result-from-attempt-2");

      // Now run 1 finishes late
      resolveRun1!("stale-result-from-attempt-1");
      await run1Task;

      // Ensure run 1 did NOT overwrite run 2
      expect(reviewResult).toBe("result-from-attempt-2");

      // 3. Stale error handling: if a stale attempt throws, it must not set errorMessage
      activeAttempt += 1;
      const attempt3 = activeAttempt;
      let rejectRun3: (err: any) => void;
      const promise3 = new Promise((_, reject) => {
        rejectRun3 = reject;
      });
      const run3Task = runAttempt(attempt3, () => promise3);

      // Cancel before run 3 fails
      activeAttempt += 1; // cancelled!
      rejectRun3!(new Error("Late OCR failure"));
      await run3Task;

      // errorMessage must NOT be set
      expect(errorMessage).toBeNull();
    });
  });
});
