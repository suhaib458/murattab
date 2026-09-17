import { test, expect } from "@playwright/test";

/**
 * Phase 3.5C — Interactive first-run guide + Course Management relocation.
 *
 * Covers:
 *   A. new onboarding → guide auto-triggers → Next through all 6 steps → finish
 *   B. manual replay from Settings
 *   C. course management absent from Schedule
 *   D. course management available from Settings
 *   E. edit / delete still work from the new location
 *
 * We avoid pixel-perfect positioning assertions and use semantic
 * `getByRole("dialog", { name: ... })` to anchor each coach step to its
 * accessible title.
 */

async function dismissSplashIfVisible(page: import("@playwright/test").Page) {
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  if (await splash.isVisible().catch(() => false)) {
    const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
    if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
    await expect(splash).toBeHidden({ timeout: 8000 });
  }
}

async function seedOnboardedProfile(
  page: import("@playwright/test").Page,
  opts: { guideAutoTrigger?: boolean; completedGuideVersion?: number | null } = {}
) {
  const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
  const facultyId = "198b8f50-8932-5eea-b267-0b48dfde70fd";
  const majorId = "4d3811d3-7773-5c46-bdb4-373f2deb7222";
  const settings: Record<string, unknown> = {
    id: "settings",
    theme: "system",
    onboardingComplete: true,
    splashShown: true,
    activeTermId: termId,
    schemaVersion: 1
  };
  if (opts.guideAutoTrigger !== undefined) settings.guideAutoTrigger = opts.guideAutoTrigger;
  if (opts.completedGuideVersion !== undefined) settings.completedGuideVersion = opts.completedGuideVersion;
  const settingsJson = JSON.stringify(settings);
  await page.addInitScript((settingsStr: string) => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const facultyId = "198b8f50-8932-5eea-b267-0b48dfde70fd";
    const majorId = "4d3811d3-7773-5c46-bdb4-373f2deb7222";
    const settings = JSON.parse(settingsStr);
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "ليان",
        universityId: "ttu",
        facultyId,
        majorId,
        createdAt: new Date().toISOString()
      },
      settings,
      terms: [
        {
          id: termId,
          name: "الفصل الدراسي الأول 2026/2027",
          startsOn: "2026-10-04",
          endsOn: "2027-01-07",
          isCurrent: true
        }
      ],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  }, settingsJson);
}

test.describe("Phase 3.5C", () => {
  test("A. onboarding جديد → الجولة تظهر تلقائيًا ولا تعود بعد إعادة التحميل", async ({ page }) => {
    await page.goto("/");
    await dismissSplashIfVisible(page);
    await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 10000 });
    await page.getByLabel("الاسم").fill("ليان");
    await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
    await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });
    await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

    // The tour dialog opens on the new-card (next-class target).
    const tour1 = page.getByRole("dialog", { name: "محاضرتك القادمة" });
    await expect(tour1).toBeVisible({ timeout: 8000 });
    await expect(page.locator("text=الخطوة 1 من 6")).toBeVisible();

    // Step 2: schedule-nav. The tour navigates to /schedule for us.
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "جدولك الأسبوعي" })).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/schedule$/);
    await expect(page.locator("text=الخطوة 2 من 6")).toBeVisible();

    // Step 3: schedule-actions.
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "أضف جدولك بطريقتك" })).toBeVisible({ timeout: 8000 });

    // Step 4: calendar-nav → /calendar.
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "التقويم الأكاديمي" })).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/calendar$/);

    // Step 5: settings-nav → /settings.
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "تحكم بتطبيقك" })).toBeVisible({ timeout: 8000 });
    await expect(page).toHaveURL(/\/settings$/);

    // Step 6: final centered card.
    await page.getByRole("button", { name: "التالي", exact: true }).click();
    const tourFinal = page.getByRole("dialog", { name: "كل شيء جاهز" });
    await expect(tourFinal).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "ابدأ استخدام مرتب" }).click();
    await expect(tourFinal).toBeHidden({ timeout: 5000 });

    // Reload — the tour must NOT reappear because the version field is persisted.
    await page.reload();
    await dismissSplashIfVisible(page);
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "كل شيء جاهز" })).toHaveCount(0);
  });

  test("A2. تخطي الجولة يحفظ الإصدار ولا يعيد فتحها تلقائيًا", async ({ page }) => {
    await page.goto("/");
    await dismissSplashIfVisible(page);
    await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 10000 });
    await page.getByLabel("الاسم").fill("ليان");
    await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
    await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });
    await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeVisible({ timeout: 8000 });
    await page.getByRole("button", { name: "تخطي الدليل" }).click();
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeHidden({ timeout: 5000 });

    await page.reload();
    await dismissSplashIfVisible(page);
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toHaveCount(0);
  });

  test("B. إعادة تشغيل الدليل يدويًا من الإعدادات", async ({ page }) => {
    await seedOnboardedProfile(page);
    await page.goto("/settings");
    await dismissSplashIfVisible(page);

    await page.getByRole("button", { name: "دليل استخدام «مرتب»" }).click();
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeVisible({ timeout: 5000 });
    // Escape ينهي الجولة ولا يحذف أي بيانات.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeHidden({ timeout: 3000 });
    await expect(page).toHaveURL(/\/settings$/, { timeout: 8000 });

    // البيانات لا تزال موجودة.
    await expect(page.getByText("ليان")).toBeVisible();
  });

  test("B2. مستخدم قديم لا تظهر له الجولة تلقائيًا بعد التحديث", async ({ page }) => {
    // Existing users: pre-3.5C snapshot → no guideAutoTrigger field.
    await seedOnboardedProfile(page);
    await page.goto("/");
    await dismissSplashIfVisible(page);
    // Tour must not auto-open.
    await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toHaveCount(0);
  });

  test("C. إدارة المواد غير ظاهرة في صفحة جدولي", async ({ page }) => {
    await seedOnboardedProfile(page, { guideAutoTrigger: false });
    await page.goto("/schedule");
    await dismissSplashIfVisible(page);
    await expect(page.getByRole("heading", { name: /إدارة المواد/ })).toHaveCount(0);
    // The primary schedule actions remain.
    await expect(page.getByRole("button", { name: "إضافة مادة", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "استيراد الجدول", exact: true })).toBeVisible();
  });

  test("D. إدارة المواد متاحة من الإعدادات (مع مادة موجودة)", async ({ page }) => {
    await page.addInitScript(() => {
      const snapshot = {
        profile: {
          id: "p1",
          name: "ليان",
          universityId: "ttu",
          facultyId: "f1",
          majorId: "m1",
          createdAt: new Date().toISOString()
        },
        settings: { id: "settings", theme: "system", onboardingComplete: true, splashShown: true, activeTermId: "t1", schemaVersion: 1 },
        terms: [{ id: "t1", name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
        courses: [
          { id: "c1", termId: "t1", name: "هندسة البرمجيات", reminder: { enabled: true, minutesBefore: 10 }, createdAt: new Date().toISOString() }
        ],
        sessions: [
          { id: "s1", courseId: "c1", day: "ح", startsAt: "10:00", endsAt: "11:30", kind: "lecture", room: { raw: "مختبر 2" } }
        ]
      };
      localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
    });
    await page.goto("/settings");
    await dismissSplashIfVisible(page);
    await page.getByRole("button", { name: /إدارة المواد/ }).click();
    const manageDlg = page.getByRole("dialog", { name: "إدارة المواد" });
    await expect(manageDlg).toBeVisible({ timeout: 5000 });
    await expect(manageDlg.getByRole("heading", { name: "إدارة المواد", level: 2 })).toBeVisible();
    await expect(manageDlg.getByText("هندسة البرمجيات")).toBeVisible();
    // Edit + Delete controls are exposed.
    await expect(manageDlg.getByRole("button", { name: "تعديل" })).toBeVisible();
    await expect(manageDlg.getByRole("button", { name: "حذف" })).toBeVisible();
  });

  test("E. تعديل/حذف المادة من اللوحة الجديدة", async ({ page }) => {
    await page.addInitScript(() => {
      const snapshot = {
        profile: {
          id: "p1",
          name: "ليان",
          universityId: "ttu",
          facultyId: "f1",
          majorId: "m1",
          createdAt: new Date().toISOString()
        },
        settings: { id: "settings", theme: "system", onboardingComplete: true, splashShown: true, activeTermId: "t1", schemaVersion: 1 },
        terms: [{ id: "t1", name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
        courses: [
          { id: "c1", termId: "t1", name: "هندسة البرمجيات", reminder: { enabled: true, minutesBefore: 10 }, createdAt: new Date().toISOString() }
        ],
        sessions: [
          { id: "s1", courseId: "c1", day: "ح", startsAt: "10:00", endsAt: "11:30", kind: "lecture", room: { raw: "مختبر 2" } }
        ]
      };
      localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
    });
    await page.goto("/settings");
    await dismissSplashIfVisible(page);
    await page.getByRole("button", { name: /إدارة المواد/ }).click();
    const manageDlg = page.getByRole("dialog", { name: "إدارة المواد" });
    await expect(manageDlg).toBeVisible({ timeout: 5000 });

    // Edit
    await manageDlg.getByRole("button", { name: "تعديل" }).first().click();
    await expect(page.getByRole("heading", { name: "تعديل المادة" })).toBeVisible({ timeout: 5000 });
    await page.getByLabel("اسم المادة").fill("هندسة البرمجيات المتقدمة");
    await page.getByRole("button", { name: "تحديث المادة" }).click();
    await expect(manageDlg.getByText("هندسة البرمجيات المتقدمة")).toBeVisible({ timeout: 5000 });

    // Delete with confirmation
    await manageDlg.getByRole("button", { name: "حذف" }).first().click();
    await expect(page.getByRole("heading", { name: "تأكيد حذف المادة" })).toBeVisible();
    await page.getByRole("button", { name: "نعم، احذف المادة" }).click();
    await expect(manageDlg.getByText("ما عندك مواد مضافة لسه")).toBeVisible({ timeout: 5000 });
  });

  test("F. الجولة لا تتجاوز 6 خطوات والأرقام صحيحة", async ({ page }) => {
    await page.goto("/");
    await dismissSplashIfVisible(page);
    await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 10000 });
    await page.getByLabel("الاسم").fill("ليان");
    await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
    await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });
    await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

    for (const expected of [
      { num: 1, name: "محاضرتك القادمة" },
      { num: 2, name: "جدولك الأسبوعي" },
      { num: 3, name: "أضف جدولك بطريقتك" },
      { num: 4, name: "التقويم الأكاديمي" },
      { num: 5, name: "تحكم بتطبيقك" },
      { num: 6, name: "كل شيء جاهز" }
    ]) {
      const dlg = page.getByRole("dialog", { name: expected.name });
      await expect(dlg).toBeVisible({ timeout: 8000 });
      await expect(page.locator(`text=الخطوة ${expected.num} من 6`)).toBeVisible();
      // First step has no Previous button, so the only available secondary
      // action is the "تخطي الدليل" affordance.
      if (expected.num === 1) {
        await expect(page.getByRole("button", { name: "تخطي الدليل" })).toBeVisible();
        await expect(page.getByRole("button", { name: "السابق" })).toHaveCount(0);
      }
      if (expected.num === 6) {
        await expect(page.getByRole("button", { name: "ابدأ استخدام مرتب" })).toBeVisible();
        // Close so the test doesn't leave a dialog open.
        await page.getByRole("button", { name: "ابدأ استخدام مرتب" }).click();
      } else {
        await page.getByRole("button", { name: "التالي", exact: true }).click();
      }
    }
  });
});
