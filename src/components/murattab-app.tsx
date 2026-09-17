"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useForm } from "react-hook-form";
import { ttuConfig, isLegacyAcademicSelection, isResolvableAcademicId } from "@/config/ttu";
import { makeBackup, readBackup } from "@/domain/backup";
import { type AcademicCalendarEvent, type AppSettings, type ClassSession, type Course, type DayCode, type StudentProfile } from "@/domain/models";
import { CURRENT_GUIDE_VERSION, TOUR_STEPS, TourOverlay } from "./tour-overlay";
import {
  autoTriggerTour,
  endTour as endTourStore,
  getOriginRoute,
  getTourSnapshot,
  startTour as startTourStore
} from "./tour-store";
import { CourseManagementDialog } from "./course-management-dialog";
import {
  calculateFreeTimeSlots,
  dayNames,
  expandRoom,
  findConflicts,
  formatArabicTime,
  formatDurationMinutes,
  makeSessions,
  orderedDays,
  sortSessions
} from "@/domain/schedule";
import { getEventsOnDate, ttuAcademicCalendar } from "@/domain/calendar";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import { LocalScheduleRepository } from "@/storage/local-repository";
import { ImportDialog } from "./import-dialog";

const repo = new LocalScheduleRepository();

type CourseForm = {
  name: string;
  kind: "lecture" | "lab" | "unspecified";
  days: DayCode[];
  startsAt: string;
  endsAt: string;
  room: string;
  reminder: boolean;
  minutesBefore: number;
};

const navigation = [
  { href: "/", label: "الرئيسية", icon: "home" as const, tourKey: "home" },
  { href: "/schedule", label: "جدولي", icon: "schedule" as const, tourKey: "schedule" },
  { href: "/calendar", label: "التقويم", icon: "calendar" as const, tourKey: "calendar" },
  { href: "/settings", label: "الإعدادات", icon: "settings" as const, tourKey: "settings" }
];

function NavIcon({ name }: { name: "home" | "schedule" | "calendar" | "settings" }) {
  const common = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
        </svg>
      );
    case "schedule":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M8 3v4M16 3v4M3.5 10h17" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M8 3v4M16 3v4M3.5 10h17M7.5 14h3M13.5 14h3M7.5 17h3" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.86l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.86-.34 1.7 1.7 0 0 0-1.03 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.86.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.86 1.7 1.7 0 0 0-1.55-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.86l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.86.34H9a1.7 1.7 0 0 0 1.03-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.55 1.7 1.7 0 0 0 1.86-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.86V9a1.7 1.7 0 0 0 1.55 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1.03Z" />
        </svg>
      );
  }
}

const arabicMonths = [
  "كانون الثاني (يناير)",
  "شباط (فبراير)",
  "آذار (مارس)",
  "نيسان (أبريل)",
  "أيار (مايو)",
  "حزيران (يونيو)",
  "تموز (يوليو)",
  "آب (أغسطس)",
  "أيلول (سبتمبر)",
  "تشرين الأول (أكتوبر)",
  "تشرين الثاني (نوفمبر)",
  "كانون الأول (ديسمبر)"
];

const dayOfWeekHeaders = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];

function getDayCodeFromJsDay(jsDay: number): DayCode | null {
  const map: Record<number, DayCode> = { 6: "س", 0: "ح", 1: "ن", 2: "ث", 3: "ر", 4: "خ" };
  return map[jsDay] ?? null;
}

function toIsoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const academicEventKindLabel: Record<AcademicCalendarEvent["kind"], string> = {
  registration: "تسجيل",
  exam: "امتحان",
  holiday: "عطلة",
  other: "حدث أكاديمي"
};

const academicEventKindToken: Record<AcademicCalendarEvent["kind"], string> = {
  registration: "var(--accent)",
  exam: "var(--warning)",
  holiday: "var(--success)",
  other: "var(--foreground-muted)"
};

export function MurattabApp() {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<AppSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(false);
  const [online, setOnline] = useState(true);
  const [modal, setModal] = useState<"course" | "restore" | "import" | "manage" | null>(null);
  const [returnToManage, setReturnToManage] = useState(false);
  const [courseToEdit, setCourseToEdit] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setData(await repo.snapshot());
  }, []);
  const dismissSplash = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("murattab-splash", "1");
    }
    setShowSplash(false);
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
      .then((snapshot) => setData(snapshot))
      .catch((error: unknown) => {
        console.error("Murattab storage error", error);
        setLoadError(error instanceof Error ? error.message : "تعذر فتح التخزين المحلي");
      });

    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/sw.js");
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

    if (!sessionStorage.getItem("murattab-splash")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShowSplash(true);
    }

    return () => {
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

    const completed = data.settings.completedGuideVersion ?? null;
    if (data.settings.guideAutoTrigger === true && (completed == null || completed < CURRENT_GUIDE_VERSION)) {
      autoTriggerTour();
    }
  }, [data]);

  useEffect(() => {
    const theme = data?.settings.theme;
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
    } else if (theme === "light") {
      document.documentElement.removeAttribute("data-theme");
    } else if (theme === "system" || !theme) {
      if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
    }
  }, [data?.settings.theme]);

  const active = navigation.find((item) => item.href === pathname)?.href ?? "/";

  const content = !data ? (
    <div className="empty">{loadError ? `تعذر فتح التخزين المحلي: ${loadError}` : "جارٍ تجهيز بياناتك المحلية…"}</div>
  ) : !data.profile ? (
    <Onboarding
      onComplete={async (profile, settings, term) => {
        await repo.bootstrap(profile, term, settings);
        await refresh();
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
        {content}
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

      {showSplash && <Splash onDismiss={dismissSplash} />}

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

type DeviceMode = "unknown" | "mobile" | "desktop";

function subscribeToViewport(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const smallQuery = window.matchMedia("(max-width: 768px)");
  const standaloneQuery = window.matchMedia("(display-mode: standalone)");
  smallQuery.addEventListener("change", callback);
  standaloneQuery.addEventListener("change", callback);
  window.addEventListener("resize", callback);
  return () => {
    smallQuery.removeEventListener("change", callback);
    standaloneQuery.removeEventListener("change", callback);
    window.removeEventListener("resize", callback);
  };
}

function getSmallViewportSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px)").matches || window.innerWidth <= 768;
}

function getStandaloneSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as unknown as { standalone?: boolean }).standalone)
  );
}

function subscribeToReducedMotion(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionQuery.addEventListener("change", callback);
  return () => motionQuery.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function Splash({ onDismiss }: { onDismiss: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);

  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const smallViewport = useSyncExternalStore(
    subscribeToViewport,
    getSmallViewportSnapshot,
    () => false
  );

  const standalone = useSyncExternalStore(
    subscribeToViewport,
    getStandaloneSnapshot,
    () => false
  );

  const prefersReducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    getReducedMotionSnapshot,
    () => false
  );

  const deviceMode: DeviceMode = !isClient
    ? "unknown"
    : smallViewport || standalone
      ? "mobile"
      : "desktop";

  const shouldPlayVideo = deviceMode === "mobile" && !prefersReducedMotion && !videoFailed;

  const renderBranch: "video" | "logo" | "unknown" =
    deviceMode === "unknown"
      ? "unknown"
      : shouldPlayVideo
        ? "video"
        : "logo";

  // Quick transition for Desktop, Reduced Motion, or Video Failure (1000ms)
  // Automatically clears if deviceMode transitions to "mobile"
  useEffect(() => {
    if (deviceMode !== "desktop" && !prefersReducedMotion && !videoFailed) return;

    const timer = setTimeout(onDismiss, 1000);
    return () => clearTimeout(timer);
  }, [deviceMode, prefersReducedMotion, videoFailed, onDismiss]);

  // Safety fallback timeout for mobile video in case it stalls or fails to end
  useEffect(() => {
    if (!shouldPlayVideo) return;

    const safetyTimer = setTimeout(() => {
      onDismiss();
    }, 6000);
    return () => clearTimeout(safetyTimer);
  }, [shouldPlayVideo, onDismiss]);

  // Ensure mobile video starts playback automatically
  useEffect(() => {
    if (!shouldPlayVideo) return;

    const video = videoRef.current;
    if (video) {
      void video.play().catch((err: unknown) => {
        console.warn("[Murattab] Splash video play interrupted:", err);
      });
    }
  }, [shouldPlayVideo]);

  if (renderBranch === "video") {
    return (
      <div className="splash splash-fullscreen" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          preload="auto"
          src="/brand/splash.mp4"
          aria-label="فيديو هوية مرتب"
          onEnded={onDismiss}
          onError={(e) => {
            const err = e.currentTarget.error;
            console.error("[Murattab Splash Video Error]", {
              code: err?.code,
              message: err?.message,
              networkState: e.currentTarget.networkState,
              readyState: e.currentTarget.readyState,
              currentSrc: e.currentTarget.currentSrc
            });
            setVideoFailed(true);
          }}
        />
      </div>
    );
  }

  if (deviceMode === "mobile") {
    return (
      <div className="splash splash-fallback" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
        <Image
          src="/brand/logo.png"
          alt="شعار مرتب"
          className="splash-logo"
          width={120}
          height={120}
          priority
        />
      </div>
    );
  }

  return (
    <div className="splash splash-desktop" role="dialog" aria-modal="true" aria-label="شاشة بدء مرتب">
      <div className="splash-content">
        <Image
          src="/brand/logo.png"
          alt="شعار مرتب"
          className="splash-logo"
          width={120}
          height={120}
          priority
        />
        <h1>مرتب</h1>
        <p className="muted">جدولك الجامعي، أوضح وأقرب إليك.</p>
      </div>
    </div>
  );
}

function Onboarding({
  onComplete
}: {
  onComplete: (
    profile: StudentProfile,
    settings: AppSettings,
    term: { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean }
  ) => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<{ name: string; facultyId: string; majorId: string }>({
    defaultValues: { facultyId: "", majorId: "" }
  });
  const facultyId = watch("facultyId");
  const majorId = watch("majorId");
  const majors = ttuConfig.majors.filter((major) => major.facultyId === facultyId);

  // If the chosen faculty does not contain the currently selected major, reset major.
  const majorIsValidForFaculty = facultyId
    ? ttuConfig.majors.some((m) => m.id === majorId && m.facultyId === facultyId)
    : false;

  return (
    <section className="onboarding card">
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <Image
          src="/icons/icon-192.png"
          alt="شعار مرتب"
          width={72}
          height={72}
          style={{ borderRadius: 16, margin: "0 auto", display: "inline-block", boxShadow: "var(--shadow)" }}
          priority
        />
      </div>
      <p className="eyebrow">مرحبًا بك في مرتب</p>
      <h1>لنرتّب فصلك الدراسي</h1>
      <p className="muted">
        هذه البيانات تبقى على جهازك محليًا بالكامل. تعتمد القوائم أدناه على بيانات جامعة الطفيلة التقنية الرسمية الحالية.
      </p>
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          if (!values.facultyId) {
            return;
          }
          const allowedMajors = ttuConfig.majors.filter((m) => m.facultyId === values.facultyId);
          if (!allowedMajors.some((m) => m.id === values.majorId)) {
            return;
          }
          const profile: StudentProfile = {
            id: crypto.randomUUID(),
            name: values.name.trim(),
            universityId: "ttu",
            facultyId: values.facultyId,
            majorId: values.majorId,
            createdAt: new Date().toISOString()
          };
          // Production AcademicTerm: first semester 2026/2027.
          // teaching start = 2026-10-04, last teaching day = 2027-01-07 (verified)
          const term = {
            id: crypto.randomUUID(),
            name: "الفصل الدراسي الأول 2026/2027",
            startsOn: "2026-10-04",
            endsOn: "2027-01-07",
            isCurrent: true
          };
          await onComplete(
            profile,
            {
              id: "settings",
              theme: "system",
              onboardingComplete: true,
              splashShown: true,
              activeTermId: term.id,
              guideSeen: true,
              completedGuideVersion: null,
              guideAutoTrigger: true,
              schemaVersion: 1
            },
            term
          );
        })}
      >
        <label className="field">
          الاسم
          <input
            autoFocus
            {...register("name", {
              required: "اكتب اسمك أولًا",
              validate: (value) => value.trim().length > 0 || "اكتب اسمك أولًا"
            })}
          />
          {errors.name && <span role="alert">{errors.name.message}</span>}
        </label>
        <label className="field">
          الكلية
          <select
            {...register("facultyId", {
              required: "اختر الكلية أولًا"
            })}
          >
            <option value="">اختر الكلية</option>
            {ttuConfig.faculties.map((faculty) => (
              <option value={faculty.id} key={faculty.id}>
                {faculty.name}
              </option>
            ))}
          </select>
          {errors.facultyId && <span role="alert">{errors.facultyId.message}</span>}
        </label>
        <label className="field">
          التخصص
          <select
            {...register("majorId", {
              validate: (value) => {
                if (!facultyId) return "اختر الكلية أولًا";
                if (!value) return "اختر التخصص";
                return ttuConfig.majors.some((m) => m.id === value && m.facultyId === facultyId) ||
                  "التخصص لا يتبع الكلية المختارة";
              }
            })}
            disabled={!facultyId}
          >
            <option value="">{facultyId ? "اختر التخصص" : "اختر الكلية أولًا"}</option>
            {majors.map((major) => (
              <option value={major.id} key={major.id}>
                {major.name}
              </option>
            ))}
          </select>
          {errors.majorId && <span role="alert">{errors.majorId.message}</span>}
        </label>
        <button
          className="button"
          disabled={isSubmitting || !facultyId || !majorIsValidForFaculty}
        >
          {isSubmitting ? "جارٍ الحفظ…" : "ابدأ مع مرتب"}
        </button>
      </form>
    </section>
  );
}

/**
 * Non-destructive "Refresh faculty/major" flow.
 *
 * Shown when an existing profile's facultyId/majorId is either a V0
 * legacy placeholder UUID or simply no longer resolvable in the
 * current canonical TTU dataset. The profile, name, courses, sessions,
 * and settings are kept untouched. Only facultyId and majorId are updated.
 */
function LegacyAcademicRefresh({
  currentName,
  onSave,
  onSkip
}: {
  currentName: string;
  onSave: (facultyId: string, majorId: string) => Promise<void>;
  onSkip: () => Promise<void>;
}) {
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<{ facultyId: string; majorId: string }>({
    defaultValues: { facultyId: "", majorId: "" }
  });
  const facultyId = watch("facultyId");
  const majorId = watch("majorId");
  const majors = ttuConfig.majors.filter((m) => m.facultyId === facultyId);
  const majorIsValidForFaculty = facultyId
    ? ttuConfig.majors.some((m) => m.id === majorId && m.facultyId === facultyId)
    : false;

  return (
    <section className="onboarding card">
      <p className="eyebrow">تحديث بياناتك الجامعية</p>
      <h1>حدّث بياناتك الجامعية</h1>
      <p className="muted">
        أهلًا {currentName}. اعتمدنا قوائم جامعة الطفيلة التقنية الرسمية في «مرتب»، لذلك نحتاج منك اختيار كليتك وتخصصك الحاليين فقط. جدولك وإعداداتك ستبقى كما هي.
      </p>
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          if (!values.facultyId) return;
          if (!ttuConfig.majors.some((m) => m.id === values.majorId && m.facultyId === values.facultyId)) {
            return;
          }
          await onSave(values.facultyId, values.majorId);
        })}
      >
        <label className="field">
          الكلية
          <select {...register("facultyId", { required: "اختر الكلية" })}>
            <option value="">اختر الكلية</option>
            {ttuConfig.faculties.map((f) => (
              <option value={f.id} key={f.id}>{f.name}</option>
            ))}
          </select>
          {errors.facultyId && <span role="alert">{errors.facultyId.message}</span>}
        </label>
        <label className="field">
          التخصص
          <select
            {...register("majorId", {
              validate: (value) => {
                if (!facultyId) return "اختر الكلية أولًا";
                if (!value) return "اختر التخصص";
                return ttuConfig.majors.some((m) => m.id === value && m.facultyId === facultyId) ||
                  "التخصص لا يتبع الكلية المختارة";
              }
            })}
            disabled={!facultyId}
          >
            <option value="">{facultyId ? "اختر التخصص" : "اختر الكلية أولًا"}</option>
            {majors.map((m) => (
              <option value={m.id} key={m.id}>{m.name}</option>
            ))}
          </select>
          {errors.majorId && <span role="alert">{errors.majorId.message}</span>}
        </label>
        <div className="actions" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            type="submit"
            className="button"
            disabled={isSubmitting || !facultyId || !majorIsValidForFaculty}
          >
            {isSubmitting ? "جارٍ الحفظ…" : "حفظ"}
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void onSkip()}
            disabled={isSubmitting}
          >
            تخطي الآن
          </button>
        </div>
      </form>
    </section>
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

  // Home view
  const todayJsDay = new Date().getDay();
  const todayCode = getDayCodeFromJsDay(todayJsDay);
  const todaySessions = todayCode ? sortSessions(data.sessions.filter((session) => session.day === todayCode)) : [];
  const nowTime = new Date().toTimeString().slice(0, 5);

  const currentSession = todaySessions.find((s) => s.startsAt <= nowTime && s.endsAt > nowTime);
  const upcomingSession = todaySessions.find((s) => s.startsAt > nowTime);
  const activeSession = currentSession ?? upcomingSession;
  const activeCourse = data.courses.find((item) => item.id === activeSession?.courseId);
  const allEnded = todaySessions.length > 0 && !activeSession;

  const freeSlots = calculateFreeTimeSlots(todaySessions);
  const remainingTodaySessions = todaySessions.filter((s) => s.endsAt > nowTime);

  return (
    <>
      <section className="hero">
        <div className="next-card" aria-live="polite" data-tour="next-class">
          {currentSession && activeCourse ? (
            <>
              <p className="eyebrow">المحاضرة الحالية (جارية الآن)</p>
              <h2>{activeCourse.name}</h2>
              <div className="row">
                <div>
                  <div className="label">الوقت</div>
                  <div className="value time">
                    {formatArabicTime(currentSession.startsAt)} — {formatArabicTime(currentSession.endsAt)}
                  </div>
                </div>
                <span className={`kind ${currentSession.kind === "lab" ? "lab" : ""}`}>
                  {currentSession.kind === "lecture" ? "نظري" : currentSession.kind === "lab" ? "عملي" : "غير محدد"}
                </span>
              </div>
              <p className="muted">القاعة: {currentSession.room.label}</p>
            </>
          ) : upcomingSession && activeCourse ? (
            <>
              <p className="eyebrow">المحاضرة القادمة</p>
              <h2>{activeCourse.name}</h2>
              <div className="row">
                <div>
                  <div className="label">الوقت</div>
                  <div className="value time">
                    {formatArabicTime(upcomingSession.startsAt)} — {formatArabicTime(upcomingSession.endsAt)}
                  </div>
                </div>
                <span className={`kind ${upcomingSession.kind === "lab" ? "lab" : ""}`}>
                  {upcomingSession.kind === "lecture" ? "نظري" : upcomingSession.kind === "lab" ? "عملي" : "غير محدد"}
                </span>
              </div>
              <p className="muted">القاعة: {upcomingSession.room.label}</p>
            </>
          ) : allEnded ? (
            <>
              <p className="eyebrow">محاضرات اليوم</p>
              <h2>انتهت جميع محاضراتك اليوم</h2>
              <p className="muted">لقد أتممت جدول هذا اليوم بنجاح.</p>
            </>
          ) : todayCode ? (
            <>
              <p className="eyebrow">محاضرات اليوم · {dayNames[todayCode]}</p>
              <h2>لا توجد محاضرات مجدولة لهذا اليوم</h2>
              <p className="muted">استمتع بوقت فراغك، أو تفقّد جدول بقية الأسبوع.</p>
            </>
          ) : (
            <>
              <p className="eyebrow">عطلة نهاية الأسبوع (الجمعة)</p>
              <h2>عطلة نهاية الأسبوع</h2>
              <p className="muted">لا توجد محاضرات يوم الجمعة.</p>
            </>
          )}
        </div>
      </section>

      {freeSlots.length > 0 && (
        <aside className="free-time-card" aria-label="فترات الفراغ اليوم">
          <h3>فترات الفراغ بين المحاضرات اليوم</h3>
          {freeSlots.map((slot, index) => (
            <div className="free-time-item" key={index}>
              <span>
                استراحة من {formatArabicTime(slot.startsAt)} إلى {formatArabicTime(slot.endsAt)}
              </span>
              <span className="badge subtle">{formatDurationMinutes(slot.durationMinutes)}</span>
            </div>
          ))}
        </aside>
      )}

      <section>
        <div className="section-head">
          <h2>بقية اليوم {todayCode ? `· ${dayNames[todayCode]}` : ""}</h2>
          <Link className="button secondary" href="/schedule">
            عرض جدولي الكامل
          </Link>
        </div>
        <SessionList
          sessions={remainingTodaySessions}
          courses={data.courses}
          empty={todayCode ? `لا توجد جلسات متبقية اليوم (${dayNames[todayCode]}).` : "لا توجد جلسات متبقية اليوم."}
        />
      </section>
    </>
  );
}

function SessionList({
  sessions,
  courses,
  empty
}: {
  sessions: ClassSession[];
  courses: Course[];
  empty: string;
}) {
  if (!sessions.length) return <div className="card empty">{empty}</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {sessions.map((session) => {
        const course = courses.find((item) => item.id === session.courseId);
        return (
          <article className="session-card" key={session.id}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span className={`kind ${session.kind === "lab" ? "lab" : ""}`}>
                  {session.kind === "lecture" ? "نظري" : session.kind === "lab" ? "عملي" : "غير محدد"}
                </span>
              </div>
              <h3>{course?.name ?? "مادة غير معروفة"}</h3>
              <p className="room-line">{session.room.label}</p>
            </div>
            <div className="time-block">
              <div className="start">{formatArabicTime(session.startsAt)}</div>
              <div className="end">— {formatArabicTime(session.endsAt)}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ScheduleView({
  data,
  openCourse,
  openImport
}: {
  data: AppSnapshot;
  openCourse: () => void;
  openImport: () => void;
}) {
  const [day, setDay] = useState<DayCode>("ح");
  const sessions = sortSessions(data.sessions.filter((item) => item.day === day));

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">جدولي</p>
          <h1>أسبوعك الدراسي</h1>
        </div>
        <div className="actions" data-tour="schedule-actions">
          <button className="button" onClick={openCourse}>
            إضافة مادة
          </button>
          <button className="button secondary" onClick={openImport}>
            استيراد الجدول
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="أيام الأسبوع">
        {orderedDays.map((code) => {
          const count = data.sessions.filter((s) => s.day === code).length;
          return (
            <button
              role="tab"
              aria-selected={day === code}
              key={code}
              onClick={() => setDay(code)}
            >
              {dayNames[code]} {count > 0 && `(${count})`}
            </button>
          );
        })}
      </div>

      <SessionList
        sessions={sessions}
        courses={data.courses}
        empty={`لا توجد جلسات يوم ${dayNames[day]}.`}
      />

      {data.courses.length === 0 && (
        <div className="card glass" style={{ textAlign: "center", padding: "32px 16px", marginTop: 24 }}>
          <p className="eyebrow">جدولك فارغ حاليًا</p>
          <h2>ابدأ بإنشاء جدولك الدراسي</h2>
          <p className="muted" style={{ maxWidth: 440, margin: "0 auto 20px" }}>
            يمكنك استيراد جدولك مباشرة برفع صورة أو ملف PDF، أو إضافة المواد والمحاضرات يدويًا.
          </p>
          <div className="actions" style={{ justifyContent: "center" }}>
            <button className="button" onClick={openImport}>
              استيراد الجدول (صورة أو PDF)
            </button>
            <button className="button secondary" onClick={openCourse}>
              إضافة مادة يدويًا
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function CalendarView({ data }: { data: AppSnapshot }) {
  // Calendar state: Year and Month
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDayNum, setSelectedDayNum] = useState<number>(() => new Date().getDate());

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  // Saturday-first indexing (0 = Saturday, 1 = Sunday, ..., 6 = Friday)
  const firstDayJs = new Date(year, month, 1).getDay();
  const firstDayOffset = (firstDayJs + 1) % 7;
  const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

  const daysArray = Array.from({ length: totalDaysInMonth }, (_, index) => index + 1);

  // Selected date details
  const safeSelected = Math.min(selectedDayNum, totalDaysInMonth);
  const selectedDateObj = new Date(year, month, safeSelected);
  const selectedDayCode = getDayCodeFromJsDay(selectedDateObj.getDay());
  const selectedDaySessions = selectedDayCode
    ? sortSessions(data.sessions.filter((session) => session.day === selectedDayCode))
    : [];

  const selectedIsoDate = toIsoDateLocal(selectedDateObj);
  const selectedEvents = getEventsOnDate(ttuAcademicCalendar.events, selectedIsoDate);

  const isToday = (dayNum: number) => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNum;
  };

  return (
    <section>
      <p className="eyebrow">التقويم الشهري</p>
      <h1 style={{ marginBottom: 14 }}>{arabicMonths[month]} {year}</h1>

      <div className="calendar-shell">
        <div className="calendar-header">
          <button className="button secondary" onClick={prevMonth} aria-label="الشهر السابق">
            الشهر السابق
          </button>
          <h2>{arabicMonths[month]} {year}</h2>
          <button className="button secondary" onClick={nextMonth} aria-label="الشهر التالي">
            الشهر التالي
          </button>
        </div>

        <div className="week-headers" role="row" aria-hidden="true">
          {dayOfWeekHeaders.map((name) => (
            <div key={name}>{name}</div>
          ))}
        </div>

        <div className="month" role="grid" aria-label={`تقويم ${arabicMonths[month]} ${year}`}>
          {Array.from({ length: firstDayOffset }).map((_, i) => (
            <div className="day-cell empty-cell" key={`empty-${i}`} aria-hidden="true" />
          ))}

          {daysArray.map((date) => {
            const cellDateObj = new Date(year, month, date);
            const cellDayCode = getDayCodeFromJsDay(cellDateObj.getDay());
            const sessionCount = cellDayCode
              ? data.sessions.filter((session) => session.day === cellDayCode).length
              : 0;
            const cellIsoDate = toIsoDateLocal(cellDateObj);
            const cellEvents = getEventsOnDate(ttuAcademicCalendar.events, cellIsoDate);
            const isSelected = safeSelected === date;

            return (
              <button
                className={`day-cell ${sessionCount ? "has-session" : ""} ${isSelected ? "selected" : ""} ${isToday(date) ? "today" : ""}`}
                key={date}
                onClick={() => setSelectedDayNum(date)}
                aria-label={`${date} ${arabicMonths[month]}، ${sessionCount} جلسات${cellEvents.length ? `، ${cellEvents.length} أحداث` : ""}`}
              >
                <span className="day-num">{date}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  {cellEvents.length > 0 && (
                    <span
                      className="event-strip"
                      title={cellEvents.map((e) => `${academicEventKindLabel[e.kind]}: ${e.title}`).join("\n")}
                      aria-label={`${cellEvents.length} أحداث`}
                    >
                      {cellEvents.slice(0, 3).map((e) => (
                        <span key={e.id} className={`event-dot ${e.kind}`} />
                      ))}
                    </span>
                  )}
                  {sessionCount > 0 && (
                    <span className="badge" title={`${sessionCount} محاضرات`}>
                      {sessionCount}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-head">
        <h2>
          محاضرات يوم {selectedDayCode ? dayNames[selectedDayCode] : "الجمعة"} {safeSelected} {arabicMonths[month]}
        </h2>
      </div>

      <SessionList
        sessions={selectedDaySessions}
        courses={data.courses}
        empty={
          selectedDayCode
            ? `لا توجد جلسات مجدولة ليوم ${dayNames[selectedDayCode]} ${safeSelected} ${arabicMonths[month]}.`
            : "يوم الجمعة عطلة أسبوعية؛ لا توجد محاضرات."
        }
      />

      {selectedEvents.length > 0 && (
        <section className="settings-group" style={{ marginTop: 16 }} aria-label={`أحداث التقويم الأكاديمي ليوم ${safeSelected} ${arabicMonths[month]}`}>
          <h3>أحداث التقويم الأكاديمي</h3>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {selectedEvents.map((event) => (
              <li
                key={event.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  background: "var(--surface-muted)",
                  borderRadius: "var(--radius-md)"
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: "inline-block",
                    minWidth: 6,
                    height: 28,
                    borderRadius: 3,
                    backgroundColor: academicEventKindToken[event.kind]
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{event.title}</div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    {event.endsOn && event.endsOn !== event.startsOn
                      ? `${event.startsOn} → ${event.endsOn}`
                      : event.startsOn}
                    {" · "}
                    {academicEventKindLabel[event.kind]}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function SettingsView({
  data,
  openRestore,
  openImport,
  openManage,
  openCourse,
  startTour,
  refresh,
  notify
}: {
  data: AppSnapshot;
  openRestore: () => void;
  openImport: () => void;
  openManage: () => void;
  openCourse: () => void;
  startTour: () => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);

  const update = async (patch: Partial<AppSettings>) => {
    await repo.saveSettings({ ...data.settings, ...patch });
    await refresh();
  };

  const download = () => {
    const backupData = makeBackup(data);
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `murattab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    notify("تم تصدير النسخة الاحتياطية بنجاح.");
  };

  const activeTerm = data.terms.find((term) => term.id === data.settings.activeTermId) ?? data.terms[0];
  const facultyName = ttuConfig.faculties.find((f) => f.id === data.profile?.facultyId)?.name ?? "كلية عامة";
  const majorName = ttuConfig.majors.find((m) => m.id === data.profile?.majorId)?.name ?? "تخصص عام";

  const profileName = data.profile?.name ?? "طالب";
  const profileInitials = (() => {
    const parts = profileName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "م";
    if (parts.length === 1) return parts[0].slice(0, 1);
    return (parts[0][0] + parts[parts.length - 1][0]);
  })();

  const setTheme = (value: AppSettings["theme"]) => {
    void update({ theme: value });
  };

  return (
    <section className="settings-shell">
      <p className="eyebrow">الإعدادات</p>
      <h1 style={{ marginBottom: 16 }}>الإعدادات</h1>

      <div className="profile-card" aria-label="بطاقة الطالب">
        <div className="avatar" aria-hidden="true">
          <span>{profileInitials}</span>
        </div>
        <div className="body">
          <h2>{profileName}</h2>
          <p>{ttuConfig.name}</p>
          <p className="meta">
            <span>{facultyName}</span>
            <span>·</span>
            <span>{majorName}</span>
          </p>
        </div>
      </div>

      <div className="settings-group" aria-label="المظهر">
        <h3>المظهر</h3>
        <div className="setting" style={{ display: "block" }}>
          <div style={{ marginBottom: 10 }}>
            <h2>الوضع</h2>
            <p className="muted">فاتح، داكن، أو تلقائي حسب جهازك.</p>
          </div>
          <div className="segmented" role="group" aria-label="اختر وضع المظهر">
            <button
              type="button"
              aria-pressed={data.settings.theme === "light"}
              onClick={() => setTheme("light")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              فاتح
            </button>
            <button
              type="button"
              aria-pressed={data.settings.theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
              </svg>
              داكن
            </button>
            <button
              type="button"
              aria-pressed={data.settings.theme === "system"}
              onClick={() => setTheme("system")}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="13" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
              تلقائي
            </button>
          </div>
        </div>
      </div>

      <div className="settings-group" aria-label="الأكاديمي">
        <h3>الأكاديمي</h3>
        <div className="settings-row" role="group" aria-label="الفصل الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 9h18M8 3v4M16 3v4" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الفصل الأكاديمي الحالي</h2>
            <p>
              {activeTerm ? `${activeTerm.name} (${activeTerm.startsOn} → ${activeTerm.endsOn})` : "غير محدد"}
            </p>
          </div>
        </div>
        <div className="settings-row" role="group" aria-label="الملف الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الملف الأكاديمي</h2>
            <p>{facultyName} · {majorName}</p>
          </div>
        </div>
      </div>

      <div className="settings-group" aria-label="الجدول">
        <h3>الجدول</h3>
        <button
          type="button"
          className="settings-row"
          onClick={openManage}
          data-tour="course-management"
        >
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 5h16v4H4zM4 12h16v4H4zM4 19h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>إدارة المواد</h2>
            <p>تعديل أو حذف المواد المسجلة في جدولك ({data.courses.length})</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openImport}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="M12 9v6M9 12h6M7 3v2M17 3v2" />
            </svg>
          </span>
          <div className="row-body">
            <h2>استيراد جدول</h2>
            <p>تحليل صورة أو PDF لجدولك ومراجعته قبل الحفظ.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <Link href="/calendar" className="settings-row" aria-label="افتح التقويم الأكاديمي">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <rect x="3" y="5" width="18" height="15" rx="2" />
              <path d="M8 3v4M16 3v4M3.5 10h17" />
            </svg>
          </span>
          <div className="row-body">
            <h2>التقويم الأكاديمي</h2>
            <p>عرض أحداث الفصل الرسمي للجامعة.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </Link>
      </div>

      <div className="settings-group" aria-label="البيانات والنسخ الاحتياطي">
        <h3>البيانات والنسخ الاحتياطي</h3>
        <button type="button" className="settings-row" onClick={download}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 4v12M6 12l6 6 6-6M4 20h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>تصدير نسخة احتياطية</h2>
            <p>احفظ ملف JSON لجدولك وملفك على جهازك.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openRestore}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 20V8M6 14l6-6 6 6M4 4h16" />
            </svg>
          </span>
          <div className="row-body">
            <h2>استعادة نسخة احتياطية</h2>
            <p>استرجع بياناتك من ملف JSON محفوظ مسبقًا.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={() => setConfirmClear(true)}>
          <span className="row-icon danger" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
            </svg>
          </span>
          <div className="row-body">
            <h2>حذف جميع البيانات</h2>
            <p>مسح كامل للملف والمواد والجلسات من هذا المتصفح.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>

      <div className="settings-group" aria-label="المساعدة">
        <h3>المساعدة</h3>
        <button type="button" className="settings-row" onClick={startTour} data-tour="replay-guide">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .8-1.5 1.3-1.5 2.5M12 17h.01" />
            </svg>
          </span>
          <div className="row-body">
            <h2>دليل استخدام «مرتب»</h2>
            <p>تعرّف على أهم مزايا التطبيق خطوة بخطوة</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
        <button type="button" className="settings-row" onClick={openCourse}>
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </span>
          <div className="row-body">
            <h2>إضافة مادة يدويًا</h2>
            <p>افتح نموذج إضافة مادة جديدة لجدولك.</p>
          </div>
          <span className="row-chevron" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </span>
        </button>
      </div>

      <div className="settings-group" aria-label="حول التطبيق">
        <h3>حول التطبيق</h3>
        <div className="settings-row" role="group" aria-label="الخصوصية والإصدار">
          <span className="row-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
              <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4Z" />
            </svg>
          </span>
          <div className="row-body">
            <h2>الخصوصية والإصدار</h2>
            <p>مرتب 0.1.0 · محلي بالكامل. لا تُرسل بياناتك إلى أي خادم.</p>
          </div>
        </div>
      </div>

      {confirmClear && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="clear-title">
          <div className="dialog">
            <h2 id="clear-title">تأكيد حذف جميع البيانات</h2>
            <p>
              تحذير: سيؤدي هذا إلى مسح كافة بياناتك وجدولك والمواد المسجلة من هذا المتصفح. لن تتمكن من التراجع عن هذه الخطوة إلا إذا كان لديك ملف نسخة احتياطية.
            </p>
            <div className="actions" style={{ marginTop: 20 }}>
              <button
                className="button danger"
                onClick={async () => {
                  await repo.clear();
                  setConfirmClear(false);
                  await refresh();
                  notify("تم مسح كافة البيانات المحلية.");
                }}
              >
                نعم، امسح كل البيانات
              </button>
              <button className="button ghost" onClick={() => setConfirmClear(false)}>
                إلغاء
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function CourseDialog({
  data,
  courseToEdit,
  close,
  saved
}: {
  data: AppSnapshot;
  courseToEdit?: Course | null;
  close: () => void;
  saved: () => Promise<void>;
}) {
  const existingForCourse = courseToEdit ? data.sessions.filter((s) => s.courseId === courseToEdit.id) : [];
  const defaultDays = existingForCourse.length ? existingForCourse.map((s) => s.day) : [];
  const defaultStartsAt = existingForCourse[0]?.startsAt ?? "08:00";
  const defaultEndsAt = existingForCourse[0]?.endsAt ?? "09:00";
  const defaultKind = existingForCourse[0]?.kind ?? "lecture";
  const defaultRoom = existingForCourse[0]?.room.raw ?? "";
  const defaultReminder = courseToEdit?.reminder.enabled ?? true;
  const defaultMinutesBefore = courseToEdit?.reminder.minutesBefore ?? 10;

  const [conflictWarning, setConflictWarning] = useState<string | null>(null);
  const [pendingSessions, setPendingSessions] = useState<{ course: Course; sessions: ClassSession[] } | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting }
  } = useForm<CourseForm>({
    defaultValues: {
      name: courseToEdit?.name ?? "",
      kind: defaultKind,
      days: defaultDays,
      startsAt: defaultStartsAt,
      endsAt: defaultEndsAt,
      room: defaultRoom,
      reminder: defaultReminder,
      minutesBefore: defaultMinutesBefore
    }
  });

  const onSubmit = async (values: CourseForm) => {
    const courseId = courseToEdit?.id ?? crypto.randomUUID();
    const termId = data.settings.activeTermId ?? data.terms[0]?.id;
    if (!termId) return;

    const sessions = makeSessions({
      courseId,
      days: values.days,
      startsAt: values.startsAt,
      endsAt: values.endsAt,
      room: expandRoom(values.room),
      kind: values.kind
    });

    const conflicts = findConflicts(sessions, data.sessions, courseToEdit?.id);

    const courseData: Course = {
      id: courseId,
      termId,
      name: values.name.trim(),
      reminder: {
        enabled: values.reminder,
        minutesBefore: Number(values.minutesBefore)
      },
      createdAt: courseToEdit?.createdAt ?? new Date().toISOString()
    };

    if (conflicts.length > 0) {
      const details = conflicts
        .map((c) => {
          const conflictingCourse = data.courses.find((item) => item.id === c.other.courseId);
          return `«${conflictingCourse?.name ?? "مادة أخرى"}» يوم ${dayNames[c.other.day]} (${formatArabicTime(c.other.startsAt)} إلى ${formatArabicTime(c.other.endsAt)})`;
        })
        .join("، ");

      setConflictWarning(`يوجد تعارض زمني مع: ${details}.`);
      setPendingSessions({ course: courseData, sessions });
      return;
    }

    await repo.saveCourse(courseData, sessions);
    await saved();
  };

  const confirmConflictSave = async () => {
    if (!pendingSessions) return;
    await repo.saveCourse(pendingSessions.course, pendingSessions.sessions);
    await saved();
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-title">
      <div className="dialog">
        <div className="section-head">
          <h2 id="add-title">{courseToEdit ? "تعديل المادة" : "إضافة مادة يدويًا"}</h2>
          <button className="button ghost" aria-label="إغلاق" onClick={close}>
            إغلاق
          </button>
        </div>

        {conflictWarning && (
          <div className="notice" role="alert" style={{ marginBottom: 16 }}>
            <p><strong>تنبيه تعارض المواعيد:</strong></p>
            <p>{conflictWarning}</p>
            <p>هل تريد حفظ المادة رغم هذا التعارض؟</p>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="button warning" onClick={confirmConflictSave}>
                نعم، احفظ رغم التعارض
              </button>
              <button className="button secondary" onClick={() => setConflictWarning(null)}>
                الرجوع والتعديل
              </button>
            </div>
          </div>
        )}

        <form className="form" onSubmit={handleSubmit(onSubmit)}>
          <label className="field">
            اسم المادة
            <input
              autoFocus
              {...register("name", {
                required: "اسم المادة مطلوب",
                validate: (value) => value.trim().length > 0 || "اسم المادة مطلوب"
              })}
            />
            {errors.name && <span role="alert">{errors.name.message}</span>}
          </label>

          <label className="field">
            النوع
            <select {...register("kind")}>
              <option value="lecture">نظري</option>
              <option value="lab">عملي</option>
              <option value="unspecified">غير محدد</option>
            </select>
          </label>

          <fieldset className="field">
            <legend>الأيام</legend>
            <div className="check-grid">
              {orderedDays.map((day) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    value={day}
                    {...register("days", {
                      validate: (value) => value.length > 0 || "اختر يومًا واحدًا على الأقل"
                    })}
                  />
                  {dayNames[day]}
                </label>
              ))}
            </div>
            {errors.days && <span role="alert">{errors.days.message}</span>}
          </fieldset>

          <div className="grid">
            <label className="field">
              وقت البداية
              <input type="time" {...register("startsAt")} />
            </label>
            <label className="field">
              وقت النهاية
              <input
                type="time"
                {...register("endsAt", {
                  validate: (value) => value > watch("startsAt") || "يجب أن يأتي وقت النهاية بعد وقت البداية"
                })}
              />
              {errors.endsAt && <span role="alert">{errors.endsAt.message}</span>}
            </label>
          </div>

          <label className="field">
            القاعة أو عبر الإنترنت
            <input
              placeholder="مثال: 207 م، 105 هـ، 204 ع، أو Online"
              {...register("room", { required: "اكتب القاعة أو Online" })}
            />
            {errors.room && <span role="alert">{errors.room.message}</span>}
          </label>

          <label className="field">
            التنبيه قبل المحاضرة (بالدقائق)
            <input
              type="number"
              min="0"
              max="10080"
              {...register("minutesBefore", { valueAsNumber: true })}
            />
          </label>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" {...register("reminder")} /> تفعيل تنبيه داخل ملف التقويم (ICS)
          </label>

          <button className="button" disabled={isSubmitting}>
            {isSubmitting ? "جارٍ الحفظ…" : courseToEdit ? "تحديث المادة" : "حفظ المادة"}
          </button>
        </form>
      </div>
    </div>
  );
}

function RestoreDialog({ close, restored }: { close: () => void; restored: () => Promise<void> }) {
  const [candidate, setCandidate] = useState<ReturnType<typeof readBackup>["data"] | null>(null);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError("الملف المحدد ليس بصيغة JSON صالحة أو به تلف.");
        setCandidate(null);
        return;
      }

      const result = readBackup(parsed);
      if (result.success) {
        setCandidate(result.data);
        setError("");
      } else {
        setError("ملف النسخة الاحتياطية غير متوافق مع هيكل بيانات مرتب.");
        setCandidate(null);
      }
    } catch {
      setError("تعذر قراءة ملف النسخة الاحتياطية.");
      setCandidate(null);
    }
  };

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="restore-title">
      <div className="dialog">
        <div className="section-head">
          <h2 id="restore-title">استعادة نسخة احتياطية</h2>
          <button className="button ghost" onClick={close} aria-label="إغلاق">
            إغلاق
          </button>
        </div>

        <p className="muted">اختر ملف النسخة الاحتياطية (JSON) المحفوظ على جهازك لاسترجاع جدولك وبياناتك.</p>

        <label className="field" style={{ margin: "16px 0" }}>
          <span>ملف النسخة (JSON)</span>
          <input type="file" accept="application/json" onChange={(e) => startTransition(() => void handleFile(e))} />
        </label>

        {error && <p role="alert" style={{ color: "var(--destructive)", fontWeight: 700 }}>{error}</p>}

        {candidate && (
          <div className="card" style={{ margin: "16px 0" }}>
            <h3>تفاصيل النسخة الجاهزة للاستعادة:</h3>
            <p><strong>اسم الطالب:</strong> {candidate.profile?.name ?? "غير مسجل"}</p>
            <p><strong>عدد المواد:</strong> {candidate.courses.length}</p>
            <p><strong>عدد الجلسات الأسبوعية:</strong> {candidate.sessions.length}</p>
            <p><strong>تاريخ التصدير:</strong> {new Date(candidate.exportedAt).toLocaleString("ar-JO")}</p>
            <div className="notice" style={{ marginTop: 12 }}>
              سيتم استبدال الجدول والبيانات المحلية الحالية بالكامل بمحتويات هذا الملف.
            </div>
            <div className="actions" style={{ marginTop: 16 }}>
              <button
                className="button warning"
                onClick={async () => {
                  await repo.replace(candidate);
                  await restored();
                }}
              >
                تأكيد الاستبدال والاستعادة
              </button>
            </div>
          </div>
        )}

        <div className="actions" style={{ marginTop: 16 }}>
          <button className="button ghost" onClick={close}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

