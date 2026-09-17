import { test, expect } from "@playwright/test";

test("شاشة البداية تنتهي خلال أربع ثوانٍ", async ({ page }) => {
  await page.goto("/");
  const splash = page.getByRole("dialog", { name: "شاشة بدء مرتب" });
  await expect(splash).toBeVisible();
  await expect(splash).toBeHidden({ timeout: 4100 });
});

test("onboarding ثم إضافة مادة وحفظها", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 7000 });
  await page.getByLabel("الاسم").fill("ليان");
  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();
  await page.getByRole("button", { name: "إضافة مادة يدويًا" }).click();
  await page.getByLabel("اسم المادة").fill("برمجة الويب");
  await page.getByLabel("الأحد").check();
  await page.getByLabel("القاعة أو Online").fill("207 م");
  await page.getByRole("button", { name: "حفظ المادة" }).click();
  await expect(page.getByText("برمجة الويب").first()).toBeVisible();
  await page.getByRole("link", { name: "جدولي" }).last().click();
  await expect(page.getByText("برمجة الويب").first()).toBeVisible();
  await page.getByRole("link", { name: "التقويم" }).last().click();
  await expect(page.getByRole("grid", { name: "تقويم شهري" })).toBeVisible();
});

test("الوضع الداكن والبيانات يبقيان بعد إعادة التحميل", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("لنرتّب فصلك الدراسي")).toBeVisible({ timeout: 7000 });
  await page.getByLabel("الاسم").fill("سالم");
  await page.getByRole("button", { name: "ابدأ مع مرتب" }).click();
  await page.goto("/settings");
  await page.getByLabel("المظهر").selectOption("dark");
  await page.reload();
  await expect(page.locator('[data-theme="dark"]')).toBeVisible();
});
