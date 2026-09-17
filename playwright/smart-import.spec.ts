import { test, expect } from "@playwright/test";

test.describe("Smart Schedule Import - استيراد الجدول بالذكاء الاصطناعي", () => {
  test.beforeEach(async ({ page, isMobile }) => {
    await page.goto("/");
    const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
    const hasSplash = await splash.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false);
    if (hasSplash) {
      if (isMobile) {
        await expect(splash).toBeHidden({ timeout: 10000 });
      } else {
        const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
        if (await skipBtn.isVisible()) await skipBtn.click();
        await expect(splash).toBeHidden({ timeout: 8000 });
      }
    }

    // Wait to see if onboarding appears
    const nameInput = page.getByLabel("الاسم");
    const hasOnboarding = await nameInput.waitFor({ state: "visible", timeout: 6000 }).then(() => true).catch(() => false);
    if (hasOnboarding) {
      await nameInput.fill("أحمد");
      // Phase 3C: pick a faculty + major before submitting.
      // Use exact combobox locators to avoid the substring ambiguity between
      // the faculty <label> ("الكلية") and the major <select>'s placeholder
      // option text ("اختر الكلية أولًا").
      await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
      await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });
      await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();
      const tour = page.getByRole("dialog", { name: "محاضرتك القادمة" });
      if (await tour.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
        await page.keyboard.press("Escape");
        await expect(tour).toBeHidden({ timeout: 4000 });
      }
    }

    // Phase 3.5B: "استيراد الجدول" lives on /schedule, not on /.
    await page.getByRole("link", { name: "جدولي" }).last().click();
    await expect(page.getByRole("button", { name: "استيراد الجدول", exact: true })).toBeVisible({ timeout: 12000 });
  });

  test("عرض رسالة الخطأ عند فشل التحليل أو عدم تهيئة المفتاح", async ({ page }) => {
    // Intercept extract endpoint with 503 error
    await page.route("**/api/schedule/extract", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: "ميزة التحليل الذكي غير مهيأة في بيئة التشغيل الحالية."
        })
      });
    });

    // Open import dialog
    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    // Attach sample file
    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "sample_schedule.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-content")
    });

    // Verify button disabled without consent
    const submitBtn = page.getByRole("button", { name: "بدء تحليل الجدول" });
    await expect(submitBtn).toBeDisabled();

    // Check consent checkbox
    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await expect(submitBtn).toBeEnabled();

    // Submit
    await submitBtn.click();

    // Error notice should be shown
    await expect(page.getByText("ميزة التحليل الذكي غير مهيأة في بيئة التشغيل الحالية.")).toBeVisible({ timeout: 8000 });
  });

  test("حظر الاعتماد عندما يحتوي الجدول على حقول غير مكتملة أو معلقة حتى يتم تصحيحها", async ({ page }) => {
    // Mock extraction with an unresolved day and empty course name (no silent guessing)
    await page.route("**/api/schedule/extract", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: {
            draft: {
              courses: [
                {
                  name: "", // Unresolved course name
                  sessions: [
                    {
                      id: "session_unresolved",
                      courseId: "course_unresolved",
                      day: null, // Unresolved day
                      startsAt: "08:30",
                      endsAt: "10:00",
                      roomRaw: "207 م",
                      roomExpanded: "مجمع القاعات – قاعة 207",
                      kind: "lecture"
                    }
                  ]
                }
              ],
              issues: [
                {
                  field: "course_0_name",
                  message: "اسم المادة غير مقروء، يرجى إدخاله يدوياً.",
                  severity: "warning"
                }
              ]
            },
            confidence: {
              course_unresolved_name: 0,
              session_session_unresolved_day: 0
            }
          }
        })
      });
    });

    // Open import dialog
    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "partial_schedule.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-binary-data")
    });

    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await page.getByRole("button", { name: "بدء تحليل الجدول" }).click();

    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 8000 });

    // Verify warning banner for unresolved fields
    await expect(page.getByText(/يرجى استكمال الحقول الإلزامية/)).toBeVisible();

    // Verify approve button is disabled while unresolved
    const approveBtn = page.getByRole("button", { name: "اعتماد الجدول" });
    await expect(approveBtn).toBeDisabled();

    // Fix the course name
    const courseInput = page.locator('input[placeholder="اسم المادة (مطلوب)"]');
    await courseInput.fill("أمن الشبكات");

    // Button should still be disabled because day is not selected
    await expect(approveBtn).toBeDisabled();

    // Fix the day
    const daySelect = page.locator("select").filter({ hasText: "اختر اليوم" });
    await daySelect.selectOption("ح");

    // Now button should become enabled!
    await expect(approveBtn).toBeEnabled();
  });

  test("تدفق الاستيراد الكامل: رفع -> موافقة -> تحليل -> مراجعة وتعديل -> اعتماد وحفظ في الجدول مع عزل قاعات المحاضرة والمختبر", async ({ page }) => {
    // Intercept extract endpoint with realistic extracted schedule: course with lecture in 207 م and lab in ICT - 4
    await page.route("**/api/schedule/extract", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: {
            draft: {
              courses: [
                {
                  name: "تصميم البيانات",
                  sessions: [
                    {
                      id: "session_lec_sun",
                      courseId: "course_data_design",
                      day: "ح",
                      startsAt: "10:00",
                      endsAt: "11:00",
                      roomRaw: "207 م",
                      roomExpanded: "مجمع القاعات – قاعة 207",
                      kind: "lecture"
                    },
                    {
                      id: "session_lec_tue",
                      courseId: "course_data_design",
                      day: "ث",
                      startsAt: "10:00",
                      endsAt: "11:00",
                      roomRaw: "207 م",
                      roomExpanded: "مجمع القاعات – قاعة 207",
                      kind: "lecture"
                    },
                    {
                      id: "session_lec_thu",
                      courseId: "course_data_design",
                      day: "خ",
                      startsAt: "10:00",
                      endsAt: "11:00",
                      roomRaw: "207 م",
                      roomExpanded: "مجمع القاعات – قاعة 207",
                      kind: "lecture"
                    },
                    {
                      id: "session_lab_mon",
                      courseId: "course_data_design",
                      day: "ن",
                      startsAt: "08:30",
                      endsAt: "10:30",
                      roomRaw: "ICT - 4",
                      roomExpanded: "مختبر الحاسوب ICT - 4",
                      kind: "lab"
                    }
                  ]
                }
              ],
              issues: []
            },
            confidence: {
              course_0_name: 0.96,
              session_session_lec_sun_day: 0.95,
              session_session_lec_sun_time: 0.95,
              session_session_lec_sun_room: 0.92,
              session_session_lec_tue_day: 0.95,
              session_session_lec_tue_time: 0.95,
              session_session_lec_tue_room: 0.92,
              session_session_lec_thu_day: 0.95,
              session_session_lec_thu_time: 0.95,
              session_session_lec_thu_room: 0.92,
              session_session_lab_mon_day: 0.95,
              session_session_lab_mon_time: 0.95,
              session_session_lab_mon_room: 0.90
            }
          }
        })
      });
    });

    // Open import dialog
    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    // Attach sample file
    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "ttu_schedule.png",
      mimeType: "image/png",
      buffer: Buffer.from("fake-png-binary-data")
    });

    // Verify file name appears in preview
    await expect(page.getByText("ttu_schedule.png").first()).toBeVisible();

    // Check consent and submit
    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await page.getByRole("button", { name: "بدء تحليل الجدول" }).click();

    // Review stage should be reached
    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 8000 });

    // Verify course name appears
    await expect(page.locator('input[value="تصميم البيانات"]')).toBeVisible();

    // Verify kind badges in Review UI
    await expect(page.locator(".kind:not(.lab)").filter({ hasText: "نظري" })).toHaveCount(3);
    await expect(page.locator(".kind.lab").filter({ hasText: "عملي" })).toHaveCount(1);

    // Verify room labels in Review UI
    await expect(page.getByText("مجمع القاعات – قاعة 207")).toHaveCount(3);
    await expect(page.getByText("مختبر الحاسوب ICT - 4")).toHaveCount(1);

    // Click approve and save
    const approveBtn = page.getByRole("button", { name: "اعتماد الجدول" });
    await expect(approveBtn).toBeEnabled();
    await approveBtn.click();

    // Dialog should close
    await expect(dialog).toBeHidden({ timeout: 6000 });

    // Dismiss success notice dialog
    const noticeDialog = page.getByRole("alertdialog", { name: "إشعار" });
    await expect(noticeDialog).toBeVisible({ timeout: 8000 });
    await noticeDialog.getByRole("button", { name: "حسنًا" }).click();
    await expect(noticeDialog).toBeHidden({ timeout: 5000 });

    // Navigate to schedule view
    await page.getByRole("link", { name: "جدولي" }).last().click();

    // 1. Check Sunday (الأحد) tab: should contain 207 م (lecture), NO ICT - 4
    await page.getByRole("tab", { name: "الأحد" }).click();
    await expect(page.getByText("تصميم البيانات").first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("مجمع القاعات – قاعة 207")).toBeVisible();
    await expect(page.locator(".kind:not(.lab)").filter({ hasText: "نظري" }).first()).toBeVisible();
    await expect(page.getByText("ICT - 4")).not.toBeVisible();

    // 2. Check Monday (الاثنين) tab: should contain ICT - 4 (lab), NO 207 م
    await page.getByRole("tab", { name: "الاثنين" }).click();
    await expect(page.getByText("تصميم البيانات").first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("مختبر الحاسوب ICT - 4")).toBeVisible();
    await expect(page.locator(".kind.lab").filter({ hasText: "عملي" }).first()).toBeVisible();
    await expect(page.getByText("207 م")).not.toBeVisible();
  });
});
