"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { isLegacyAcademicSelection } from "@/config/ttu";
import type { AppSettings, Course } from "@/domain/models";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import { LocalScheduleRepository } from "@/storage/local-repository";

import { CURRENT_GUIDE_VERSION, TOUR_STEPS, TourOverlay } from "@/features/tour";
import {
  autoTriggerTour,
  endTour as endTourStore,
  getOriginRoute,
  getTourSnapshot,
  startTour as startTourStore
} from "@/features/tour";
import { CourseManagementDialog } from "@/features/settings/components/course-management-dialog";
import { SettingsView } from "@/features/settings/components/settings-view";
import { ImportDialog } from "@/features/smart-import/components/import-dialog";
import { HomeView } from "@/features/home/components/home-view";
import { ScheduleView } from "@/features/schedule/components/schedule-view";
import { CalendarView } from "@/features/calendar/components/calendar-view";
import { Onboarding } from "@/features/onboarding/components/onboarding";
import { LegacyAcademicRefresh } from "@/features/onboarding/components/legacy-academic-refresh";
import { NavIcon } from "@/components/shared/nav-icon";
import { Splash } from "@/components/shared/splash";
import { CourseDialog } from "@/components/shared/course-dialog";
import { RestoreDialog } from "@/components/shared/restore-dialog";
import { MurattabProvider, type MurattabContextValue } from "@/components/murattab-context";
import { refreshPushRegistration, syncPushReminders } from "@/features/notifications/push-client";
import { FirstRunPushPrompt } from "@/features/notifications/components/first-run-push-prompt";

const repo = new LocalScheduleRepository();

const navigation = [
  { href: "/", label: "الرئيسية", icon: "home" as const, tourKey: "home" },
  { href: "/schedule", label: "جدولي", icon: "schedule" as const, tourKey: "schedule" },
  { href: "/calendar", label: "التقويم", icon: "calendar" as const, tourKey: "calendar" },
  { href: "/settings", label: "الإعدادات", icon: "settings" as const, tourKey: "settings" }
];

export function MurattabApp({ children }: { children?: React.ReactNode } = {}) {
  const router = useRouter();
  const pathname = usePathname();

  const [data, setData] = useState<AppSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [splashFinished, setSplashFinished] = useState(false);
  const [online, setOnline] = useState(true);
  const [modal, setModal] = useState<"course" | "restore" | "import" | "manage" | null>(null);
  const [returnToManage, setReturnToManage] = useState(false);
  const [courseToEdit, setCourseToEdit] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showFirstRunPushPrompt, setShowFirstRunPushPrompt] = useState(false);
  const showSplash = !splashFinished || (!data && !loadError);

  const refresh = useCallback(async () => {
    setData(await repo.snapshot());
  }, []);
  const dismissSplash = useCallback(() => {
    setSplashFinished(true);
  }, []);
  const dismissFirstRunPushPrompt = useCallback(() => {
    setShowFirstRunPushPrompt(false);
  }, []);

  // Auto-start the tour once per onboarding. Existing users who never set
  // `guideAutoTrigger` (because they onboarded before this patch) are NOT
  // shown the tour automatically. The user can always replay manually from
  // Settings. See `CURRENT_GUIDE_VERSION` for the version field.
  const startTour = useCallback(() => {
    startTourStore(pathname);
  }, [pathname]);
  const endTour = useCallback(async () => {
    const origin = getOriginRoute();
    const snap = getTourSnapshot();
    const currentStepRoute = TOUR_STEPS[snap.step]?.route;
    endTourStore();
    if (data) {
      const next: AppSettings = {
        ...data.settings,
        completedGuideVersion: CURRENT_GUIDE_VERSION,
        guideAutoTrigger: false,
        guideSeen: true
      };
      try {
        await repo.saveSettings(next);
      } catch (err) {
        console.error("Failed to persist tour state", err);
      }
    }
    if (origin && (origin !== pathname || origin !== currentStepRoute)) {
      router.push(origin);
    } else {
      await refresh();
    }
  }, [data, refresh, pathname, router]);

  useEffect(() => {
    void repo
      .snapshot()
      .then((snapshot) => {
        setData(snapshot);
      })
      .catch((error: unknown) => {
        console.error("Murattab storage error", error);
        setLoadError(error instanceof Error ? error.message : "تعذر فتح التخزين المحلي");
      });

    let unmountCleanup: (() => void) | undefined;

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let refreshing = false;

      const handleControllerChange = () => {
        if (!hadController) return;
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      };

      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((registration) => {
          void registration.update().catch((err: unknown) => {
            console.warn("[Murattab SW] Update check failed:", err);
          });
        })
        .catch((err: unknown) => {
          console.warn("[Murattab SW] Registration failed:", err);
        });

      const handleVisibility = () => {
        if (document.visibilityState === "visible") {
          navigator.serviceWorker
            .getRegistration()
            .then((reg) => {
              void reg?.update().catch(() => {});
            })
            .catch(() => {});
        }
      };
      document.addEventListener("visibilitychange", handleVisibility);

      unmountCleanup = () => {
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
        document.removeEventListener("visibilitychange", handleVisibility);
      };
    } else if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) {
          void reg.unregister().then((ok) => {
            if (ok) console.warn("[Murattab Dev] Unregistered stale service worker:", reg.scope);
          });
        }
      }).catch((err) => console.error("Error unregistering service workers:", err));

      if ("caches" in window) {
        void caches.keys().then((keys) => {
          for (const key of keys) {
            void caches.delete(key).then(() => {
              console.warn("[Murattab Dev] Cleared stale cache:", key);
            });
          }
        }).catch((err) => console.error("Error clearing caches:", err));
      }
    }

    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);

    return () => {
      unmountCleanup?.();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (modal) setModal(null);
        if (courseToEdit) setCourseToEdit(null);
        if (notice) setNotice(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modal, courseToEdit, notice]);

  // First-run auto-trigger: runs once per client lifecycle when data is first available
  // after onboarding. Guarded by `guideAutoTrigger`, version check, and autoTriggerTour
  // so existing users are not interrupted and repeated repository refreshes / route changes do not re-trigger.
  useEffect(() => {
    if (!data) return;
    if (!data.profile) return;
    if (showSplash) return;
    if (showFirstRunPushPrompt) return;

    const completed = data.settings.completedGuideVersion ?? null;
    if (data.settings.guideAutoTrigger === true && (completed == null || completed < CURRENT_GUIDE_VERSION)) {
      autoTriggerTour();
    }
  }, [data, showSplash, showFirstRunPushPrompt]);

  const theme = data?.settings.theme;

  useEffect(() => {
    if (!theme) return;

    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("murattab-theme", theme);
      } catch {
        // ignore in restricted storage environments
      }
    }

    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      document.documentElement.removeAttribute("data-theme");
    } else if (theme === "system") {
      if (typeof window !== "undefined") {
        const mql = window.matchMedia("(prefers-color-scheme: dark)");
        const applyTheme = (matches: boolean) => {
          if (matches) {
            document.documentElement.setAttribute("data-theme", "dark");
          } else {
            document.documentElement.removeAttribute("data-theme");
          }
        };
        applyTheme(mql.matches);
        const listener = (e: MediaQueryListEvent) => applyTheme(e.matches);
        mql.addEventListener("change", listener);
        return () => mql.removeEventListener("change", listener);
      }
    }
  }, [theme]);

  useEffect(() => {
    if (!data || !online) return;

    const refreshPush = async () => {
      try {
        const refreshed = await refreshPushRegistration(data);
        if (!refreshed) await syncPushReminders(data);
      } catch (error: unknown) {
        console.warn("Unable to refresh push registration:", error);
      }
    };

    void refreshPush();

    const handleReturnToApp = () => {
      if (document.visibilityState === "visible") void refreshPush();
    };

    document.addEventListener("visibilitychange", handleReturnToApp);
    window.addEventListener("focus", handleReturnToApp);
    return () => {
      document.removeEventListener("visibilitychange", handleReturnToApp);
      window.removeEventListener("focus", handleReturnToApp);
    };
  }, [data, online]);

  const active = navigation.find((item) => item.href === pathname)?.href ?? "/";

  if (pathname === "/offline") {
    return <>{children}</>;
  }

  if (showSplash) {
    return <Splash onDismiss={dismissSplash} />;
  }

  const contextValue: MurattabContextValue | null = data
    ? {
        data,
        refresh,
        openCourse: (course) => {
          setCourseToEdit(course ?? null);
          setModal("course");
        },
        openRestore: () => setModal("restore"),
        openImport: () => setModal("import"),
        openManage: () => setModal("manage"),
        startTour,
        notify: setNotice
      }
    : null;

  const content = !data ? (
    <div className="empty">{loadError ? `تعذر فتح التخزين المحلي: ${loadError}` : "جارٍ تجهيز بياناتك المحلية…"}</div>
  ) : !data.profile ? (
    <Onboarding
      onComplete={async (profile, settings, term) => {
        await repo.bootstrap(profile, term, settings);
        await refresh();
        setShowFirstRunPushPrompt(true);
      }}
    />
  ) : isLegacyAcademicSelection(data.profile.facultyId, data.profile.majorId) ? (
    <LegacyAcademicRefresh
      currentName={data.profile.name}
      onSave={async (facultyId, majorId) => {
        if (!data.profile) return;
        await repo.saveProfile({ ...data.profile, facultyId, majorId });
        await refresh();
        setNotice("تم تحديث بياناتك الجامعية بنجاح.");
      }}
      onSkip={async () => {
        setNotice("حتى الآن ستظهر بياناتك كغير محدد في الواجهة. يمكنك التحديث من الإعدادات لاحقًا.");
        // Forcing a refresh will let the dashboard render; the lookup fallbacks
        // in SettingsView will show "كلية عامة"/"تخصص عام" until the user updates.
        await refresh();
      }}
    />
  ) : (
    children ?? (
      <Dashboard
        data={data}
        pathname={pathname}
        openCourse={() => {
          setCourseToEdit(null);
          setModal("course");
        }}
        openRestore={() => setModal("restore")}
        openImport={() => setModal("import")}
        openManage={() => setModal("manage")}
        startTour={startTour}
        refresh={refresh}
        notify={setNotice}
      />
    )
  );

  return (
    <>
      <main className="app">
        <header className="topbar">
          <Link href="/" className="brand" aria-label="مرتب، الصفحة الرئيسية">
            <span className="brand-mark" aria-hidden="true" />
            مرتب
          </Link>
          <nav className="nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active === item.href ? "page" : undefined}
                data-tour={`${item.tourKey}-nav`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        {contextValue ? (
          <MurattabProvider value={contextValue}>
            {content}
          </MurattabProvider>
        ) : (
          content
        )}
      </main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي للهاتف">
        {navigation.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active === item.href ? "page" : undefined}
            data-tour={`${item.tourKey}-nav`}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {modal === "course" && data && (
        <CourseDialog
          data={data}
          courseToEdit={courseToEdit}
          close={() => {
            setModal(returnToManage ? "manage" : null);
            setCourseToEdit(null);
            setReturnToManage(false);
          }}
          saved={async () => {
            setModal(returnToManage ? "manage" : null);
            setCourseToEdit(null);
            setReturnToManage(false);
            await refresh();
          }}
        />
      )}

      {modal === "restore" && data && (
        <RestoreDialog
          close={() => setModal(null)}
          restored={async () => {
            await refresh();
            setModal(null);
            setNotice("تمت استعادة البيانات بنجاح.");
          }}
        />
      )}

      {modal === "manage" && data && (
        <CourseManagementDialog
          data={data}
          editCourse={(course) => {
            setCourseToEdit(course);
            setReturnToManage(true);
            setModal("course");
          }}
          openCourse={() => {
            setCourseToEdit(null);
            setReturnToManage(true);
            setModal("course");
          }}
          close={() => {
            setModal(null);
            setReturnToManage(false);
          }}
          refresh={refresh}
          notify={setNotice}
          repo={repo}
        />
      )}

      {modal === "import" && data && (
        <ImportDialog
          data={data}
          repo={repo}
          close={() => setModal(null)}
          saved={async () => {
            await refresh();
            setModal(null);
          }}
          notify={setNotice}
        />
      )}

      {showFirstRunPushPrompt && data?.profile && (
        <FirstRunPushPrompt
          data={data}
          onClose={dismissFirstRunPushPrompt}
          notify={setNotice}
        />
      )}

      <TourOverlay
        onComplete={() => void endTour()}
      />

      {notice && (
        <div className="dialog-backdrop" role="alertdialog" aria-modal="true" aria-label="إشعار">
          <div className="dialog">
            <p>{notice}</p>
            <button className="button" onClick={() => setNotice(null)}>
              حسنًا
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Dashboard({
  data,
  pathname,
  openCourse,
  openRestore,
  openImport,
  openManage,
  startTour,
  refresh,
  notify
}: {
  data: AppSnapshot;
  pathname: string;
  openCourse: () => void;
  openRestore: () => void;
  openImport: () => void;
  openManage: () => void;
  startTour: () => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  if (pathname === "/schedule") {
    return (
      <ScheduleView
        data={data}
        openCourse={openCourse}
        openImport={openImport}
      />
    );
  }
  if (pathname === "/calendar") {
    return <CalendarView data={data} />;
  }
  if (pathname === "/settings") {
    return <SettingsView
      data={data}
      openRestore={openRestore}
      openImport={openImport}
      openManage={openManage}
      openCourse={openCourse}
      startTour={startTour}
      refresh={refresh}
      notify={notify}
    />;
  }

  return <HomeView data={data} />;
}
