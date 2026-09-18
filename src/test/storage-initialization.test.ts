import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LocalScheduleRepository, initialSettings } from "@/storage/local-repository";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { StudentProfile } from "@/domain/models";

class StallingLocalScheduleRepository extends LocalScheduleRepository {
  public resolveStall?: (value: AppSnapshot) => void;
  public stallCount = 0;

  constructor(timeoutMs = 50) {
    super(timeoutMs);
  }

  protected override async dexieSnapshot(): Promise<AppSnapshot> {
    this.stallCount++;
    return new Promise<AppSnapshot>((resolve) => {
      this.resolveStall = resolve;
    });
  }
}

class RejectingLocalScheduleRepository extends LocalScheduleRepository {
  constructor(private readonly rejectionError: Error) {
    super(100);
  }

  protected override async dexieSnapshot(): Promise<AppSnapshot> {
    throw this.rejectionError;
  }
}

class MockEmptyDexieRepository extends LocalScheduleRepository {
  constructor() {
    super(100);
  }

  protected override async dexieSnapshot(): Promise<AppSnapshot> {
    return {
      profile: null,
      settings: initialSettings,
      terms: [],
      courses: [],
      sessions: []
    };
  }
}

describe("Phase 4.2.2: Real Device Storage Initialization & Bounded Fallback", () => {
  const originalLocalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  const originalIndexedDB = globalThis.indexedDB;

  // In-memory mock localStorage
  let mockStorage: Record<string, string> = {};
  const fakeLocalStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => {
      mockStorage[key] = String(val);
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {
      mockStorage = {};
    }
  };

  beforeEach(() => {
    mockStorage = {};
    Object.defineProperty(globalThis, "localStorage", {
      value: fakeLocalStorage,
      writable: true,
      configurable: true
    });
    // Simulate browser environment with indexedDB present
    Object.defineProperty(globalThis, "window", {
      value: globalThis,
      writable: true,
      configurable: true
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: {},
      writable: true,
      configurable: true
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: originalLocalStorage,
      writable: true,
      configurable: true
    });
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      writable: true,
      configurable: true
    });
    Object.defineProperty(globalThis, "indexedDB", {
      value: originalIndexedDB,
      writable: true,
      configurable: true
    });
    vi.restoreAllMocks();
  });

  it("A. IndexedDB unavailable → fallback resolves", async () => {
    // @ts-expect-error Simulating environments without IndexedDB
    delete globalThis.indexedDB;

    const repo = new LocalScheduleRepository(100);
    const snapshot = await repo.snapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.profile).toBeNull();
    expect(snapshot.settings.theme).toBe("light");
  });

  it("B. IndexedDB rejects → fallback resolves", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new RejectingLocalScheduleRepository(new Error("DatabaseCorruptError"));

    const snapshot = await repo.snapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.profile).toBeNull();
    expect(snapshot.settings).toEqual(initialSettings);
    expect(warnSpy).toHaveBeenCalledWith(
      "IndexedDB read failed, falling back to localStorage:",
      expect.any(Error)
    );
  });

  it("C. IndexedDB initialization stalls → fallback resolves within bounded time", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const timeoutMs = 60;
    const repo = new StallingLocalScheduleRepository(timeoutMs);

    const start = Date.now();
    const snapshot = await repo.snapshot();
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(40);
    expect(duration).toBeLessThan(350); // Must resolve promptly around timeoutMs
    expect(snapshot).toBeDefined();
    expect(snapshot.profile).toBeNull();
    expect(snapshot.settings).toEqual(initialSettings);
    expect(warnSpy).toHaveBeenCalledWith("IndexedDB initialization timed out; using local fallback");
  });

  it("D. Empty fallback → profile is null and onboarding can render", async () => {
    const repo = new StallingLocalScheduleRepository(50);
    const snapshot = await repo.snapshot();

    expect(snapshot.profile).toBeNull();
    expect(snapshot.courses).toEqual([]);
    expect(snapshot.sessions).toEqual([]);
    expect(snapshot.settings.onboardingComplete).toBe(false);
  });

  it("E. Existing localStorage fallback → preserved and returned on IndexedDB timeout", async () => {
    const existingSnapshot: AppSnapshot = {
      profile: {
        id: "existing-student-1",
        name: "ليان",
        universityId: "ttu",
        facultyId: "fac-1",
        majorId: "maj-1",
        createdAt: new Date().toISOString()
      },
      settings: {
        ...initialSettings,
        theme: "dark",
        onboardingComplete: true
      },
      terms: [],
      courses: [],
      sessions: []
    };

    localStorage.setItem("murattab-fallback-v1", JSON.stringify(existingSnapshot));

    const repo = new StallingLocalScheduleRepository(50);
    const snapshot = await repo.snapshot();

    expect(snapshot.profile).not.toBeNull();
    expect(snapshot.profile?.name).toBe("ليان");
    expect(snapshot.settings.theme).toBe("dark");
    expect(snapshot.settings.onboardingComplete).toBe(true);

    // Verify localStorage was not cleared or overwritten
    const stored = JSON.parse(localStorage.getItem("murattab-fallback-v1")!);
    expect(stored.profile.name).toBe("ليان");
  });

  it("F. Existing fallback is returned immediately when Dexie is empty without blocking on full restore", async () => {
    const existingSnapshot: AppSnapshot = {
      profile: {
        id: "existing-student-2",
        name: "صهيب",
        universityId: "ttu",
        facultyId: "fac-it",
        majorId: "maj-cs",
        createdAt: new Date().toISOString()
      },
      settings: {
        ...initialSettings,
        theme: "system",
        onboardingComplete: true
      },
      terms: [],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(existingSnapshot));

    const repo = new MockEmptyDexieRepository();
    const start = Date.now();
    const snapshot = await repo.snapshot();
    const duration = Date.now() - start;

    // Must return immediately without waiting for any background restore
    expect(duration).toBeLessThan(50);
    expect(snapshot.profile?.name).toBe("صهيب");
    expect(snapshot.settings.theme).toBe("system");
  });

  it("G. Late Dexie completion guard → resolves after timeout without overwriting fallback", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new StallingLocalScheduleRepository(40);

    // Initial snapshot times out and falls back to empty
    const snapshot1 = await repo.snapshot();
    expect(snapshot1.profile).toBeNull();
    expect(repo.resolveStall).toBeDefined();
    const resolveInitialStall = repo.resolveStall!;

    // User subsequently completes onboarding into fallback
    const newProfile: StudentProfile = {
      id: "student-new",
      name: "أحمد",
      universityId: "ttu",
      facultyId: "fac-1",
      majorId: "maj-1",
      createdAt: new Date().toISOString()
    };
    // Save to fallback storage directly to simulate user onboarding save
    const onboardedSnapshot: AppSnapshot = {
      profile: newProfile,
      settings: { ...initialSettings, onboardingComplete: true },
      terms: [],
      courses: [],
      sessions: []
    };
    localStorage.setItem("murattab-fallback-v1", JSON.stringify(onboardedSnapshot));

    // Late Dexie resolution from the stalled first call arrives with empty profile
    const staleEmptyDexieData: AppSnapshot = {
      profile: null,
      settings: initialSettings,
      terms: [],
      courses: [],
      sessions: []
    };
    resolveInitialStall(staleEmptyDexieData);

    // Allow promise microtasks to run
    await new Promise((r) => setTimeout(r, 20));

    // Fallback must NOT have been corrupted or overwritten by the stale empty Dexie resolution
    const storedFallback = JSON.parse(localStorage.getItem("murattab-fallback-v1")!);
    expect(storedFallback.profile.name).toBe("أحمد");
    expect(warnSpy).toHaveBeenCalledWith(
      "Dexie snapshot resolved after timeout or newer attempt; discarding stale result"
    );
  });

  it("H. Normal mutations are awaited directly without Promise.race timeout racing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new LocalScheduleRepository(50);

    // saveSettings persists to fallback and catches Dexie write failure gracefully
    const updatedSettings = {
      ...initialSettings,
      theme: "dark" as const
    };
    await repo.saveSettings(updatedSettings);

    const snapshot = await repo.snapshot();
    expect(snapshot.settings.theme).toBe("dark");
  });
});
