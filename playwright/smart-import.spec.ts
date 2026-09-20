import { test, expect } from "@playwright/test";

/** Helper to generate a realistic TTU synthetic schedule image inside the browser canvas */
async function generateSyntheticSchedulePng(page: any): Promise<Buffer> {
  return await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1400;
    canvas.height = 900;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000000";
    ctx.direction = "rtl";
    ctx.textAlign = "right";

    // Title
    ctx.font = "28px Arial, Tahoma, sans-serif";
    ctx.fillText("جامعة الطفيلة التقنية", 800, 60);

    // Headers (y = 130)
    ctx.font = "24px Arial, Tahoma, sans-serif";
    ctx.fillText("اسم المادة", 1250, 130);
    ctx.fillText("الشعبة", 950, 130);
    ctx.fillText("س.م", 820, 130);
    ctx.fillText("الموعد", 580, 130);
    ctx.fillText("القاعة", 240, 130);

    // Row 1 (y = 220)
    ctx.fillText("تصميم الدوائر المنطقية", 1250, 220);
    ctx.fillText("1", 950, 220);
    ctx.fillText("3", 820, 220);
    ctx.fillText("ح ث 11:30 - 13:00", 580, 220);
    ctx.fillText("DS-ICT 2", 240, 220);

    // Row 2 (y = 310)
    ctx.fillText("شبكات الحاسوب", 1250, 310);
    ctx.fillText("1", 950, 310);
    ctx.fillText("3", 820, 310);
    ctx.fillText("ح ث 08:30 - 10:00", 580, 310);
    ctx.fillText("DS-ICT 3", 240, 310);

    // Footer (y = 420)
    ctx.font = "18px Arial, Tahoma, sans-serif";
    ctx.fillText("تاريخ الطباعة 2026/09/20 - صفحة 1 من 1", 850, 420);

    const dataUrl = canvas.toDataURL("image/png");
    return dataUrl.split(",")[1];
  }).then((b64: string) => Buffer.from(b64, "base64"));
}

test.describe("Smart Schedule Import - استيراد الجدول بالذكاء الاصطناعي والمحلي", () => {
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
      await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
      await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });
      await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();
      const tour = page.getByRole("dialog", { name: "محاضرتك القادمة" });
      if (await tour.waitFor({ state: "visible", timeout: 4000 }).then(() => true).catch(() => false)) {
        await page.keyboard.press("Escape");
        await expect(tour).toBeHidden({ timeout: 4000 });
      }
    }

    await page.getByRole("link", { name: "جدولي" }).last().click();
    await expect(page.getByRole("button", { name: "استيراد الجدول", exact: true })).toBeVisible({ timeout: 12000 });
  });

  test("A. تدفق الاستيراد المحلي للصور: خصوصية تامة دون موافقة سحابية ودون إرسال طلب إلى الخادم", async ({ page }) => {
    test.setTimeout(90000);

    let apiExtractCalled = false;
    await page.route("**/api/schedule/extract", (route) => {
      apiExtractCalled = true;
      return route.fulfill({ status: 500 });
    });

    // Generate synthetic schedule image
    const imageBuffer = await generateSyntheticSchedulePng(page);

    // Open import dialog
    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    // Attach synthetic image
    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "synthetic_schedule.png",
      mimeType: "image/png",
      buffer: imageBuffer
    });

    // Verify privacy disclosure message is shown
    await expect(page.getByText("يتم تحليل الصورة محليًا على جهازك، ولا يتم رفعها إلى خادم خارجي.")).toBeVisible();

    // Verify NO cloud consent checkbox is shown for local image
    await expect(page.getByLabel(/أوافق صراحة على إرسال الملف/)).not.toBeVisible();

    // Verify submit button is immediately enabled without consent
    const submitBtn = page.getByRole("button", { name: "بدء تحليل الجدول" });
    await expect(submitBtn).toBeEnabled();

    // Start local analysis
    await submitBtn.click();

    // Review screen should be reached
    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 60000 });

    // Verify local analysis source badge is displayed
    const sourceBadge = page.getByTestId("analysis-source-badge");
    await expect(sourceBadge).toBeVisible();
    await expect(sourceBadge).toContainText("تم تحليل الصورة محليًا على جهازك");

    // Strictly assert NO POST request to /api/schedule/extract was made
    expect(apiExtractCalled).toBe(false);
  });


  test("B. الفشل المحلي للصور: لا يستدعي السحابة تلقائيًا، ويعرض خيار التحليل المتقدم بعد الموافقة الصريحة", async ({ page }) => {
    let apiCallCount = 0;
    await page.route("**/api/schedule/extract", async (route) => {
      apiCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: {
            draft: {
              courses: [
                {
                  name: "مادة من السحابة",
                  sessions: [
                    {
                      id: "cloud_s1",
                      courseId: "cid_cloud",
                      day: "ح",
                      startsAt: "08:30",
                      endsAt: "10:00",
                      roomRaw: "207 م",
                      kind: "lecture"
                    }
                  ]
                }
              ],
              issues: []
            },
            confidence: {
              course_cid_cloud_name: 0.95
            }
          }
        })
      });
    });

    // Open import dialog
    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    // Attach tiny non-table image (fails local table detection)
    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "empty_image.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
    });

    // Click local analysis
    await page.getByRole("button", { name: "بدء تحليل الجدول" }).click();

    // Verify local error appears without automatic cloud upload
    await expect(page.getByText(/لم يتم العثور على جدول دراسي واضح/)).toBeVisible({ timeout: 15000 });
    expect(apiCallCount).toBe(0);

    // Verify fallback card appears
    const fallbackCard = page.getByTestId("local-fallback-card");
    await expect(fallbackCard).toBeVisible();

    // Fallback button is disabled until consent is checked
    const cloudBtn = page.getByRole("button", { name: "استخدام التحليل المتقدم" });
    await expect(cloudBtn).toBeDisabled();

    // Check cloud consent checkbox
    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await expect(cloudBtn).toBeEnabled();

    // Trigger cloud extraction
    await cloudBtn.click();

    // Review stage reached via cloud
    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 15000 });
    const sourceBadge = page.getByTestId("analysis-source-badge");
    await expect(sourceBadge).toContainText("تم التحليل باستخدام الخدمة المتقدمة");

    // Exactly 1 cloud call occurred after explicit consent
    expect(apiCallCount).toBe(1);
  });

  test("C. تدفق ملفات PDF: يتطلب موافقة سحابية صريحة ويستخدم مسار التحليل المتقدم", async ({ page }) => {
    let apiCallCount = 0;
    await page.route("**/api/schedule/extract", async (route) => {
      apiCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          result: {
            draft: {
              courses: [
                {
                  name: "تطوير الويب",
                  sessions: [
                    {
                      id: "pdf_s1",
                      courseId: "cid_pdf",
                      day: "ن",
                      startsAt: "10:00",
                      endsAt: "11:30",
                      roomRaw: "105 هـ",
                      kind: "lecture"
                    }
                  ]
                }
              ],
              issues: []
            },
            confidence: {
              course_cid_pdf_name: 0.95
            }
          }
        })
      });
    });

    await page.getByRole("button", { name: "استيراد الجدول" }).first().click();
    const dialog = page.getByRole("dialog", { name: "استيراد الجدول" });
    await expect(dialog).toBeVisible();

    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "my_schedule.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test")
    });

    // Verify PDF cloud disclosure is shown
    await expect(page.getByText("ملفات PDF يتم تحليلها حاليًا عبر خدمة التحليل المتقدم.")).toBeVisible();

    // Verify button is disabled without consent
    const submitBtn = page.getByRole("button", { name: "بدء تحليل الجدول (متقدم)" });
    await expect(submitBtn).toBeDisabled();

    // Check cloud consent
    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await expect(submitBtn).toBeEnabled();

    await submitBtn.click();

    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 15000 });
    const sourceBadge = page.getByTestId("analysis-source-badge");
    await expect(sourceBadge).toContainText("تم التحليل باستخدام الخدمة المتقدمة");

    expect(apiCallCount).toBe(1);
  });

  test("D. تدفق المراجعة والحفظ الكامل مع عزل قاعات المحاضرة والمختبر", async ({ page }) => {
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
              course_course_data_design_name: 0.96,
              session_session_lec_sun_day: 0.95,
              session_session_lec_sun_time: 0.95,
              session_session_lec_sun_room: 0.92,
              session_session_lec_tue_day: 0.95,
              session_session_lec_tue_time: 0.95,
              session_session_lec_tue_room: 0.92,
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

    // Attach PDF to use cloud review mock
    const fileInput = page.locator("#file-upload-input");
    await fileInput.setInputFiles({
      name: "ttu_schedule.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 test")
    });

    await page.getByLabel(/أوافق صراحة على إرسال الملف/).check();
    await page.getByRole("button", { name: "بدء تحليل الجدول (متقدم)" }).click();

    // Review stage should be reached
    await expect(page.getByRole("heading", { name: "راجع جدولك قبل الاعتماد" })).toBeVisible({ timeout: 8000 });

    // Verify course name appears
    await expect(page.locator('input[value="تصميم البيانات"]')).toBeVisible();

    // Verify kind badges in Review UI
    await expect(page.locator(".kind:not(.lab)").filter({ hasText: "نظري" })).toHaveCount(2);
    await expect(page.locator(".kind.lab").filter({ hasText: "عملي" })).toHaveCount(1);

    // Verify room labels in Review UI
    await expect(page.getByText("مجمع القاعات – قاعة 207")).toHaveCount(2);
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
    await expect(page.getByText("ICT - 4")).not.toBeVisible();

    // 2. Check Monday (الاثنين) tab: should contain ICT - 4 (lab), NO 207 م
    await page.getByRole("tab", { name: "الاثنين" }).click();
    await expect(page.getByText("تصميم البيانات").first()).toBeVisible({ timeout: 6000 });
    await expect(page.getByText("مختبر الحاسوب ICT - 4")).toBeVisible();
    await expect(page.getByText("207 م")).not.toBeVisible();
  });
});
