import { test, expect } from "@playwright/test";

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
  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

  // التأكد من الوصول للشاشة الرئيسية بعد إتمام onboarding
  await expect(page.getByRole("button", { name: "إضافة مادة يدويًا" })).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "إضافة مادة يدويًا" }).click();

  // ملء بيانات المادة
  await expect(page.getByRole("heading", { name: "إضافة مادة يدويًا" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("اسم المادة").fill("برمجة الويب");
  await page.getByLabel("الأحد").check();
  await page.getByLabel("الثلاثاء").check();
  await page.getByLabel(/القاعة/).fill("207 م");
  await page.getByRole("button", { name: "حفظ المادة" }).click();

  // الانتقال إلى شاشة جدولي والتأكد من ظهور المادة في إدارة المواد
  await page.getByRole("link", { name: "جدولي" }).last().click();
  await expect(page.getByText("برمجة الويب").first()).toBeVisible({ timeout: 8000 });

  // تعديل المادة
  await page.getByRole("button", { name: "تعديل" }).first().click();
  await expect(page.getByRole("heading", { name: "تعديل المادة" })).toBeVisible({ timeout: 5000 });
  await page.getByLabel("اسم المادة").fill("برمجة الويب المتقدمة");
  await page.getByRole("button", { name: "تحديث المادة" }).click();
  await expect(page.getByText("برمجة الويب المتقدمة").first()).toBeVisible({ timeout: 5000 });

  // التحقق من شاشة التقويم والتنقل
  await page.getByRole("link", { name: "التقويم" }).last().click();
  await expect(page.getByRole("grid", { name: /تقويم/ })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "الشهر السابق" }).click();
  await page.getByRole("button", { name: "الشهر التالي" }).click();

  // حذف المادة وتأكيد الحذف
  await page.getByRole("link", { name: "جدولي" }).last().click();
  await page.getByRole("button", { name: "حذف" }).first().click();
  await expect(page.getByRole("heading", { name: "تأكيد حذف المادة" })).toBeVisible();
  await page.getByRole("button", { name: "نعم، احذف المادة" }).click();
  await expect(page.getByText("لا توجد جلسات يوم")).toBeVisible({ timeout: 5000 });
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
  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();

  await page.goto("/settings");
  await page.getByLabel("المظهر").selectOption("dark");
  await expect(page.locator('[data-theme="dark"]')).toBeVisible({ timeout: 5000 });
  await page.reload();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible({ timeout: 5000 });

  // فتح الدليل الإرشادي والتأكد من إمكانية الوصول
  await page.getByRole("button", { name: "فتح الدليل" }).click();
  await expect(page.getByRole("heading", { name: "دليل استخدام «مرتب»" })).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "فهمت ذلك" }).click();
});


