import { test, expect } from "@playwright/test";

// Allow service workers specifically for this regression test file
test.use({ serviceWorkers: "allow" });

const TEST_SNAPSHOT = {
  profile: {
    id: "44444444-4444-4444-8444-444444444444",
    name: "سالم",
    universityId: "ttu",
    facultyId: "198b8f50-8932-5eea-b267-0b48dfde70fd",
    majorId: "4d3811d3-7773-5c46-bdb4-373f2deb7222",
    createdAt: new Date().toISOString(),
  },
  settings: {
    id: "settings",
    theme: "system",
    onboardingComplete: true,
    splashShown: true,
    activeTermId: "4649c262-4d89-4dec-ae0b-ad8f3426d0ed",
    guideSeen: true,
    completedGuideVersion: 1,
    schemaVersion: 1,
  },
  terms: [
    {
      id: "4649c262-4d89-4dec-ae0b-ad8f3426d0ed",
      name: "الفصل الدراسي الأول 2026/2027",
      startsOn: "2026-10-11",
      endsOn: "2027-01-07",
      isCurrent: true,
    },
  ],
  courses: [],
  sessions: [],
};

test.describe("PWA Service Worker Update & Offline Regression", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Service Worker inspection in Playwright requires Chromium");

  test("Navigation is NETWORK FIRST: online reload ignores stale cached HTML and serves latest deployed UI", async ({ page }) => {
    await page.addInitScript((snapshot) => {
      localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
    }, TEST_SNAPSHOT);

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();

    // Ensure Service Worker is registered and active
    await page.waitForFunction(async () => {
      if (!navigator.serviceWorker) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg && (reg.active || navigator.serviceWorker.controller));
    }, { timeout: 10000 });

    // Seed the runtime cache with an obviously stale navigation response for /settings
    await page.evaluate(async () => {
      const cache = await caches.open("murattab-runtime-v3");
      const staleHtml = `
        <!DOCTYPE html>
        <html lang="ar">
          <head><meta charset="utf-8"><title>Stale</title></head>
          <body>
            <h1 id="stale-cache-marker">نسخة قديمة جداً من الكاش</h1>
          </body>
        </html>
      `;
      await cache.put("/settings", new Response(staleHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }));
    });

    // Confirm that the stale response was stored in cache
    const cacheHasStale = await page.evaluate(async () => {
      const cache = await caches.open("murattab-runtime-v3");
      const match = await cache.match("/settings");
      if (!match) return false;
      const text = await match.text();
      return text.includes("stale-cache-marker");
    });
    expect(cacheHasStale).toBe(true);

    // Reload the page while ONLINE
    await page.reload();

    // Verify: stale cache marker is NEVER shown; fresh real application UI is shown
    await expect(page.locator("#stale-cache-marker")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();
    await expect(page.getByText("صُنع بجهد وحب لطلاب الجامعة")).toBeVisible();

    // Verify: the runtime cache has been refreshed with the latest network response
    const cacheRefreshed = await page.evaluate(async () => {
      const cache = await caches.open("murattab-runtime-v3");
      const match = await cache.match("/settings");
      if (!match) return false;
      const text = await match.text();
      return !text.includes("stale-cache-marker");
    });
    expect(cacheRefreshed).toBe(true);
  });

  test("Offline Fallback: cached route renders offline; unvisited route falls back to offline page", async ({ page, context }) => {
    await page.addInitScript((snapshot) => {
      localStorage.setItem("murattab-fallback-v1", JSON.stringify(snapshot));
    }, TEST_SNAPSHOT);

    // 1. Visit /settings while online so it is saved in runtime cache
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();

    // Wait for SW ready and controlling
    await page.waitForFunction(async () => {
      if (!navigator.serviceWorker) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg && navigator.serviceWorker.controller);
    }, { timeout: 10000 });

    // Reload once while online so the controlling SW intercepts and caches /settings in runtime cache
    await page.reload();
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();

    // Verify /settings was cached in runtime cache
    const isCached = await page.evaluate(async () => {
      const cache = await caches.open("murattab-runtime-v3");
      const match = await cache.match("/settings");
      return Boolean(match);
    });
    expect(isCached).toBe(true);

    // 2. Go offline
    await context.setOffline(true);

    // 3. Reload /settings: should successfully load from runtime cache offline
    await page.reload();
    await expect(page.getByRole("heading", { name: "الإعدادات", exact: true })).toBeVisible();

    // 4. Navigate to an unvisited route: should fall back to cached /offline page
    await page.goto("/unvisited-offline-route-test", { failOnStatusCode: false }).catch(() => {});
    await expect(page.getByText(/أنت غير متصل الآن|لا يوجد اتصال بالإنترنت|الخدمة غير متوفرة دون اتصال/)).toBeVisible();

    // Restore online state
    await context.setOffline(false);
  });

  test("Service Worker registration is configured with updateViaCache: 'none'", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForFunction(async () => {
      if (!navigator.serviceWorker) return false;
      const reg = await navigator.serviceWorker.ready;
      return Boolean(reg);
    }, { timeout: 10000 });

    const updateViaCache = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return reg?.updateViaCache;
    });
    expect(updateViaCache).toBe("none");
  });
});
