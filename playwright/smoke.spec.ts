import { test, expect } from "@playwright/test";

async function dismissSplashIfVisible(page: import("@playwright/test").Page) {
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  if (await splash.isVisible().catch(() => false)) {
    const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
    if (await skipBtn.isVisible().catch(() => false)) await skipBtn.click();
    await expect(splash).toBeHidden({ timeout: 8000 });
  }
}

test("شاشة البداية تنتهي تلقائيًا أو عند النقر على تخطي", async ({ page, isMobile }) => {
  await page.goto("/");
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  await expect(splash).toBeVisible({ timeout: 10000 });

  if (isMobile) {
    const video = page.locator(".splash video");
    await expect(video).toHaveCount(1);
    await expect(page.locator(".splash button")).toHaveCount(0);
    await expect(page.locator(".splash").getByText("مرتب")).toHaveCount(0);
    await expect(page.locator(".splash").getByText(/جدولك الجامعي/)).toHaveCount(0);

    await page.waitForFunction(() => {
      const v = document.querySelector(".splash video") as HTMLVideoElement | null;
      return v && !v.paused && v.currentTime > 0 && v.duration >= 3.8;
    }, { timeout: 4000 });

    const playback = await video.evaluate((v: HTMLVideoElement) => ({
      paused: v.paused,
      currentTime: v.currentTime,
      duration: v.duration
    }));
    expect(playback.paused).toBe(false);
    expect(playback.currentTime).toBeGreaterThan(0);
    expect(playback.duration).toBeGreaterThanOrEqual(3.8);
  } else {
    const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
    if (await skipBtn.isVisible()) {
      await skipBtn.click();
    }
  }

  await expect(splash).toBeHidden({ timeout: 8000 });
});

test("onboarding ثم إضافة مادة وتعديلها وحذفها", async ({ page }) => {
  await page.goto("/");
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  if (await splash.isVisible()) {
    const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
    if (await skipBtn.isVisible()) await skipBtn.click();
    await expect(splash).toBeHidden({ timeout: 8000 });
  }

  await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 10000 });
  await page.getByLabel("الاسم").fill("ليان");

  // Phase 3C: faculty + major must be chosen explicitly.
  // Use exact combobox role locators to avoid the substring ambiguity that
  // exists between the faculty <label> ("الكلية") and the major <select>'s
  // placeholder option text ("اختر الكلية أولًا"), which makes plain
  // getByLabel("الكلية") match both controls.
  await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
  await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "علم الحاسوب /الذكاء الاصطناعي وعلم البيانات" });

  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

  // Phase 3.5C: the interactive first-run tour opens automatically once
  // onboarding finishes. The new-card on Home is its first target.
  const tour = page.getByRole("dialog", { name: "محاضرتك القادمة" });
  await expect(tour).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  // Step 2: schedule-nav, route navigates to /schedule.
  await expect(page.getByRole("dialog", { name: "جدولك الأسبوعي" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  // Step 3: schedule-actions, still on /schedule.
  await expect(page.getByRole("dialog", { name: "أضف جدولك بطريقتك" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  // Step 4: calendar-nav → /calendar.
  await expect(page.getByRole("dialog", { name: "التقويم الأكاديمي" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  // Step 5: settings-nav → /settings.
  await expect(page.getByRole("dialog", { name: "تحكم بتطبيقك" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "التالي", exact: true }).click();
  // Step 6: final centered card.
  await expect(page.getByRole("dialog", { name: "كل شيء جاهز" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "ابدأ استخدام مرتب" }).click();
  await expect(tour).toBeHidden({ timeout: 5000 });

  // Phase 3.5B: Home is the Next-Class hero; navigate to /schedule to add a course.
  await page.getByRole("link", { name: "جدولي" }).last().click();
  await expect(page.getByRole("button", { name: "إضافة مادة", exact: true })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "إضافة مادة", exact: true }).click();

  // ملء بيانات المادة
  await expect(page.getByRole("heading", { name: "إضافة مادة يدويًا" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("اسم المادة").fill("برمجة الويب");
  await page.getByLabel("الأحد").check();
  await page.getByLabel("الثلاثاء").check();
  await page.getByLabel(/القاعة/).fill("207 م");
  await page.getByRole("button", { name: "حفظ المادة" }).click();

  // Phase 3.5C: course management moved to Settings.
  // Sanity: Schedule must NOT render a "إدارة المواد" list.
  await expect(page.getByRole("heading", { name: /إدارة المواد/ })).toHaveCount(0);

  // Open the dedicated management panel from Settings.
  const manageDlg = page.getByRole("dialog", { name: "إدارة المواد" });
  await page.getByRole("link", { name: "الإعدادات" }).last().click();
  await page.getByRole("button", { name: /إدارة المواد/ }).click();
  await expect(manageDlg).toBeVisible({ timeout: 5000 });
  await expect(manageDlg.getByText("برمجة الويب").first()).toBeVisible();

  // تعديل المادة من داخل اللوحة
  await manageDlg.getByRole("button", { name: "تعديل" }).first().click();
  await expect(page.getByRole("heading", { name: "تعديل المادة" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("اسم المادة").fill("برمجة الويب المتقدمة");
  await page.getByRole("button", { name: "تحديث المادة" }).click();
  await expect(manageDlg.getByText("برمجة الويب المتقدمة").first()).toBeVisible({ timeout: 5000 });

  // التحقق من شاشة التقويم والتنقل
  await manageDlg.getByRole("button", { name: "إغلاق إدارة المواد" }).click();
  await page.getByRole("link", { name: "التقويم" }).last().click();
  await expect(page.getByRole("grid", { name: /تقويم/ })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "الشهر السابق" }).click();
  await page.getByRole("button", { name: "الشهر التالي" }).click();

  // حذف المادة من اللوحة الجديدة مع التأكيد
  await page.getByRole("link", { name: "الإعدادات" }).last().click();
  await page.getByRole("button", { name: /إدارة المواد/ }).click();
  await expect(manageDlg).toBeVisible({ timeout: 5000 });
  await manageDlg.getByRole("button", { name: "حذف" }).first().click();
  await expect(page.getByRole("heading", { name: "تأكيد حذف المادة" })).toBeVisible();
  await page.getByRole("button", { name: "نعم، احذف المادة" }).click();
  await expect(manageDlg.getByText("ما عندك مواد مضافة لسه")).toBeVisible({ timeout: 5000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "إشعار" })).toBeHidden({ timeout: 3000 }).catch(() => {});
  // العودة إلى جدولي يجب أن تعرض اليوم فارغًا
  await page.getByRole("link", { name: "جدولي" }).last().click();
  await expect(page.getByText("لا توجد جلسات يوم")).toBeVisible({ timeout: 5000 });
});

test("تدفق التحديث غير المدمر: ملف شخصي قديم يحتاج تحديث الكلية والتخصص فقط", async ({ page }) => {
  await page.addInitScript(() => {
    const legacySnapshot = {
      profile: {
        id: "p-legacy",
        name: "خالد",
        universityId: "ttu",
        facultyId: "11111111-1111-4111-8111-111111111111",
        majorId: "22222222-2222-4222-8222-222222222222",
        createdAt: "2026-09-01T00:00:00.000Z"
      },
      settings: {
        id: "settings",
        theme: "light",
        onboardingComplete: true,
        splashShown: true,
        activeTermId: "4649c262-4d89-4dec-ae0b-ad8f3426d0ed",
        schemaVersion: 1
      },
      terms: [
        {
          id: "4649c262-4d89-4dec-ae0b-ad8f3426d0ed",
          name: "الفصل الدراسي الأول 2026/2027",
          startsOn: "2026-10-04",
          endsOn: "2027-01-07",
          isCurrent: true
        }
      ],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(legacySnapshot));
  });

  await page.goto("/");
  // Refresh screen must appear with the existing user name
  await expect(page.getByText("حدّث بياناتك الجامعية")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("خالد")).toBeVisible();

  // Pick a real faculty/major using exact combobox locators (see comment above).
  await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية تكنولوجيا المعلومات والاتصالات" });
  await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "الأمن السيبراني" });
  await page.getByRole("button", { name: "حفظ" }).click();

  // Dashboard appears with the Next-Class hero (the new home primary card).
  await expect(page.locator(".next-card")).toBeVisible({ timeout: 8000 });
});

test("الوضع الداكن والبيانات يبقيان بعد إعادة التحميل", async ({ page }) => {
  await page.goto("/");
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  if (await splash.isVisible()) {
    const skipBtn = page.getByRole("button", { name: "تخطي الفيديو" });
    if (await skipBtn.isVisible()) await skipBtn.click();
    await expect(splash).toBeHidden({ timeout: 6000 });
  }

  await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 10000 });
  await page.getByLabel("الاسم").fill("سالم");
  // Phase 3C: pick a faculty + major using exact combobox locators (see comment above).
  await page.getByRole("combobox", { name: "الكلية", exact: true }).selectOption({ label: "كلية الأعمال" });
  await page.getByRole("combobox", { name: "التخصص", exact: true }).selectOption({ label: "إدارة الأعمال" });
  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();
  const tour = page.getByRole("dialog", { name: "محاضرتك القادمة" });
  await expect(tour).toBeVisible({ timeout: 8000 });
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden({ timeout: 3000 });

  await page.getByRole("link", { name: "الإعدادات" }).last().click();
  await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible({ timeout: 5000 });
  // Phase 3.5B: المظهر is a segmented control, not a <select>.
  await page.getByRole("group", { name: "اختر وضع المظهر" }).getByRole("button", { name: "داكن" }).click();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible({ timeout: 5000 });

  // إعادة تشغيل الدليل الإرشادي من الإعدادات (Phase 3.5C).
  // "دليل استخدام مرتب" يفتح الدليل التفاعلي الجديد.
  await page.getByRole("button", { name: "دليل استخدام «مرتب»" }).click();
  // أول خطوة من الجولة: نافذة محاضرتك القادمة.
  await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeVisible({ timeout: 5000 });
  // Escape يخرج من الجولة في وضع إعادة التشغيل.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "محاضرتك القادمة" })).toBeHidden({ timeout: 3000 });
});

// -------------------------------------------------------------------------
// Phase 3.5B regression checks: removed text, layout sanity, settings rows.
// These are intentionally lightweight and avoid pixel-perfect assertions.
// -------------------------------------------------------------------------
test("Home لا يحوي بطاقة مقدمة أو نص «متصل» أو زر تصدير", async ({ page, isMobile }) => {
  // Pre-seed an onboarded profile so the Home hero renders.
  await page.addInitScript(() => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "ليان",
        universityId: "ttu",
        facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
        majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
        createdAt: new Date().toISOString()
      },
      settings: { id: "settings", theme: "system", onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, completedGuideVersion: 1, schemaVersion: 1 },
      terms: [{ id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  });

  await page.goto("/");

  // Removed Home intro card
  await expect(page.getByText("جدولك في مكانه الصحيح.")).toHaveCount(0);

  // Removed connection badge
  await expect(page.locator(".status")).toHaveCount(0);
  await expect(page.getByText("متصل", { exact: true })).toHaveCount(0);

  // Removed ICS export on Home
  await expect(page.getByRole("button", { name: /تصدير التقويم/ })).toHaveCount(0);

  // No horizontal overflow at the active viewport
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // Next-class hero exists
  await expect(page.locator(".next-card")).toBeVisible();

  // On mobile, bottom nav is visible
  if (isMobile) {
    const nav = page.locator(".bottom-nav");
    await expect(nav).toBeVisible();
  }
});

test("الإعدادات تعرض بطاقة الطالب ومتغيرات المظهر كزر ثلاثي", async ({ page }) => {
  await page.addInitScript(() => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "سالم",
        universityId: "ttu",
        facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
        majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
        createdAt: new Date().toISOString()
      },
      settings: { id: "settings", theme: "system", onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, completedGuideVersion: 1, schemaVersion: 1 },
      terms: [{ id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  });

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();
  await expect(page.getByText("سالم")).toBeVisible();
  await expect(page.getByText("جامعة الطفيلة التقنية")).toBeVisible();

  // Segmented appearance control exposes three options
  const seg = page.locator('[role="group"][aria-label="اختر وضع المظهر"]');
  await expect(seg).toBeVisible();
  await expect(seg.getByRole("button", { name: "فاتح" })).toBeVisible();
  await expect(seg.getByRole("button", { name: "داكن" })).toBeVisible();
  await expect(seg.getByRole("button", { name: "تلقائي" })).toBeVisible();

  // Grouped rows: data, calendar, about
  await expect(page.getByText("البيانات والنسخ الاحتياطي")).toBeVisible();
  await expect(page.getByRole("heading", { name: "التقويم الأكاديمي", level: 2 })).toBeVisible();
  await expect(page.getByText("حول التطبيق")).toBeVisible();
});

test("Phase 4.1: Home تعرض ذكاء اليوم (المحاضرة الحالية، الملخص، والفراغ)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-04T09:30:00")); // 2026-10-04 is Sunday (ح)
  await page.addInitScript(() => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const courseId1 = "11111111-1111-4111-8111-111111111111";
    const courseId2 = "22222222-2222-4222-8222-222222222222";
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "ليان",
        universityId: "ttu",
        facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
        majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
        createdAt: new Date().toISOString()
      },
      settings: { id: "settings", theme: "system", onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, completedGuideVersion: 1, schemaVersion: 1 },
      terms: [{ id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
      courses: [
        { id: courseId1, termId, name: "برمجة الويب", createdAt: "2026-10-04T00:00:00.000Z" },
        { id: courseId2, termId, name: "هياكل البيانات", createdAt: "2026-10-04T00:00:00.000Z" }
      ],
      sessions: [
        { id: "s1", courseId: courseId1, day: "ح", startsAt: "09:00", endsAt: "10:00", room: { raw: "207 م", label: "مجمع القاعات – قاعة 207", isOnline: false }, kind: "lecture" },
        { id: "s2", courseId: courseId2, day: "ح", startsAt: "11:30", endsAt: "13:00", room: { raw: "105 هـ", label: "كلية الهندسة – قاعة 105", isOnline: false }, kind: "lecture" }
      ]
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  });

  await page.goto("/");

  // 1. Hero displays active lecture at 09:30
  const hero = page.locator(".next-card");
  await expect(hero).toBeVisible();
  await expect(hero.getByText("المحاضرة الحالية")).toBeVisible();
  await expect(hero.getByText("برمجة الويب")).toBeVisible();
  await expect(hero.locator(".hero-status-pill")).toHaveText("متبقي 30 دقيقة");

  // 2. Daily summary chips are visible
  const summary = page.locator(".daily-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("2 محاضرات")).toBeVisible();
  await expect(summary.getByText("2 متبقية")).toBeVisible();

  // 3. Free-time card displays upcoming break
  const freeTime = page.locator(".free-time-card");
  await expect(freeTime).toBeVisible();
  await expect(freeTime.getByText("فترة الفراغ القادمة")).toBeVisible();
  await expect(freeTime.getByText("ساعة و30 دقيقة")).toBeVisible();
});

test("Phase 4.2: Schedule يعرض ذكاء اليوم (المحاضرة الحالية، الملخص، الفراغ، والتعارض)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-04T09:30:00")); // 2026-10-04 is Sunday (ح)
  await page.addInitScript(() => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const courseId1 = "11111111-1111-4111-8111-111111111111";
    const courseId2 = "22222222-2222-4222-8222-222222222222";
    const courseId3 = "33333333-3333-4333-8333-333333333333";
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "ليان",
        universityId: "ttu",
        facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
        majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
        createdAt: new Date().toISOString()
      },
      settings: { id: "settings", theme: "light", onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, completedGuideVersion: 1, schemaVersion: 1 },
      terms: [{ id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
      courses: [
        { id: courseId1, termId, name: "برمجة الويب", createdAt: "2026-10-04T00:00:00.000Z", reminder: { enabled: false, minutesBefore: 15 } },
        { id: courseId2, termId, name: "هياكل البيانات", createdAt: "2026-10-04T00:00:00.000Z", reminder: { enabled: false, minutesBefore: 15 } },
        { id: courseId3, termId, name: "قواعد البيانات", createdAt: "2026-10-04T00:00:00.000Z", reminder: { enabled: false, minutesBefore: 15 } }
      ],
      sessions: [
        { id: "s1", courseId: courseId1, day: "ح", startsAt: "09:00", endsAt: "10:00", room: { raw: "207 م", label: "مجمع القاعات – قاعة 207", isOnline: false }, kind: "lecture" },
        { id: "s2", courseId: courseId2, day: "ح", startsAt: "11:30", endsAt: "13:00", room: { raw: "105 هـ", label: "كلية الهندسة – قاعة 105", isOnline: false }, kind: "lecture" },
        // Conflicting with s2 (overlaps 12:00-13:30 with 11:30-13:00)
        { id: "s3", courseId: courseId3, day: "ح", startsAt: "12:00", endsAt: "13:30", room: { raw: "301 هـ", label: "كلية الهندسة – قاعة 301", isOnline: false }, kind: "lab" },
        // Monday session for day-switching test
        { id: "s4", courseId: courseId1, day: "ن", startsAt: "08:00", endsAt: "09:00", room: { raw: "207 م", label: "مجمع القاعات – قاعة 207", isOnline: false }, kind: "lecture" }
      ]
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  });

  // Navigate to Schedule
  await page.goto("/schedule");

  // 1. Day selector defaults to today (Sunday / ح)
  const sundayTab = page.getByRole("tab", { name: /الأحد/ });
  await expect(sundayTab).toHaveAttribute("aria-selected", "true");

  // 2. Day summary is visible
  const summary = page.locator(".schedule-day-summary");
  await expect(summary).toBeVisible();
  await expect(summary.getByText("3 محاضرات")).toBeVisible();

  // 3. Current session has "الآن" badge (and no "القادمة" badge shown simultaneously)
  const currentBadge = page.locator(".session-status-badge.current");
  await expect(currentBadge).toBeVisible();
  await expect(currentBadge).toHaveText("الآن");
  await expect(page.locator(".session-status-badge.upcoming")).toHaveCount(0);

  // 4. Time gap between sessions is displayed
  const timeGap = page.locator(".time-gap").first();
  await expect(timeGap).toBeVisible();

  // 5. Conflict banner appears (s2 and s3 overlap)
  const conflictBanner = page.locator(".conflict-banner");
  await expect(conflictBanner).toBeVisible();
  await expect(conflictBanner).toContainText("تعارض");

  // 6. Conflict badge on affected session cards
  const conflictBadges = page.locator(".session-status-badge.conflict");
  await expect(conflictBadges).toHaveCount(2);

  // 7. "Go to Today" button is NOT visible (we're already on today)
  await expect(page.locator(".today-btn")).toHaveCount(0);

  // 8. Switch to Monday → "Go to Today" appears
  const mondayTab = page.getByRole("tab", { name: /الاثنين/ });
  await mondayTab.click();
  await expect(mondayTab).toHaveAttribute("aria-selected", "true");
  const todayBtn = page.locator(".today-btn");
  await expect(todayBtn).toBeVisible();

  // 9. Click "Go to Today" → returns to Sunday
  await todayBtn.click();
  await expect(sundayTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".today-btn")).toHaveCount(0);
});

test("Phase 4.2.1: Bottom navigation مستقر تمامًا والمظهر يعرض تلقائي مع حالة الجهاز", async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    const termId = "4649c262-4d89-4dec-ae0b-ad8f3426d0ed";
    const snapshot = {
      profile: {
        id: "44444444-4444-4444-8444-444444444444",
        name: "ليان",
        universityId: "ttu",
        facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
        majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
        createdAt: new Date().toISOString()
      },
      settings: { id: "settings", theme: "light", onboardingComplete: true, splashShown: true, activeTermId: termId, guideSeen: true, completedGuideVersion: 1, schemaVersion: 1 },
      terms: [{ id: termId, name: "الفصل الدراسي الأول 2026/2027", startsOn: "2026-10-04", endsOn: "2027-01-07", isCurrent: true }],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
  });

  await page.goto("/");

  if (isMobile) {
    const bottomNav = page.locator(".bottom-nav");
    await expect(bottomNav).toBeVisible();

    // 1. Verify bottom-nav has NO animation applied
    const animName = await bottomNav.evaluate((el) => window.getComputedStyle(el).animationName);
    expect(animName).toBe("none");

    // 2. Mobile navigation sequence: Home -> Schedule -> Calendar -> Settings -> Home
    const scheduleLink = bottomNav.getByRole("link", { name: "جدولي" });
    const calendarLink = bottomNav.getByRole("link", { name: "التقويم" });
    const settingsLink = bottomNav.getByRole("link", { name: "الإعدادات" });
    const homeLink = bottomNav.getByRole("link", { name: "الرئيسية" });

    // Home -> Schedule
    await scheduleLink.click();
    await expect(scheduleLink).toHaveAttribute("aria-current", "page");
    await expect(homeLink).not.toHaveAttribute("aria-current", "page");

    // Schedule -> Calendar
    await calendarLink.click();
    await expect(calendarLink).toHaveAttribute("aria-current", "page");
    await expect(scheduleLink).not.toHaveAttribute("aria-current", "page");

    // Calendar -> Settings
    await settingsLink.click();
    await expect(settingsLink).toHaveAttribute("aria-current", "page");
    await expect(calendarLink).not.toHaveAttribute("aria-current", "page");

    // Settings -> Home
    await homeLink.click();
    await expect(homeLink).toHaveAttribute("aria-current", "page");
    await expect(settingsLink).not.toHaveAttribute("aria-current", "page");

    // Verify tap-highlight-color is transparent on mobile navigation
    const tapHighlight = await scheduleLink.evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return cs.getPropertyValue("-webkit-tap-highlight-color") || cs.webkitTapHighlightColor || "";
    });
    expect(["transparent", "rgba(0, 0, 0, 0)", ""].includes(tapHighlight)).toBe(true);
  }

  // Navigate to Settings to verify theme copy and behavior
  await page.goto("/settings");
  const autoBtn = page.getByRole("button", { name: "تلقائي" });
  await expect(autoBtn).toBeVisible();
  await expect(autoBtn).toHaveAttribute("aria-label", "تلقائي — حسب إعداد جهازك");

  // Click auto/system
  await autoBtn.click();
  await expect(page.getByText(/تلقائي — حسب إعداد جهازك/)).toBeVisible();
});

