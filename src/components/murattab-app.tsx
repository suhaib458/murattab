"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useForm } from "react-hook-form";
import { ttuConfig } from "@/config/ttu";
import { makeBackup, readBackup } from "@/domain/backup";
import { type AppSettings, type ClassSession, type Course, type DayCode, type StudentProfile } from "@/domain/models";
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
import { generateCourseIcs, generateIcs } from "@/domain/calendar";
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
  { href: "/", label: "الرئيسية" },
  { href: "/schedule", label: "جدولي" },
  { href: "/calendar", label: "التقويم" },
  { href: "/settings", label: "الإعدادات" }
];

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

export function MurattabApp() {
  const pathname = usePathname();
  const [data, setData] = useState<AppSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSplash, setShowSplash] = useState(false);
  const [online, setOnline] = useState(true);
  const [modal, setModal] = useState<"course" | "restore" | "guide" | "import" | null>(null);
  const [courseToEdit, setCourseToEdit] = useState<Course | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = async () => setData(await repo.snapshot());
  const dismissSplash = useCallback(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("murattab-splash", "1");
    }
    setShowSplash(false);
  }, []);

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
  ) : (
    <Dashboard
      data={data}
      pathname={pathname}
      openCourse={() => {
        setCourseToEdit(null);
        setModal("course");
      }}
      editCourse={(course) => {
        setCourseToEdit(course);
        setModal("course");
      }}
      openRestore={() => setModal("restore")}
      openGuide={() => setModal("guide")}
      openImport={() => setModal("import")}
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
          <div className={`status ${online ? "online" : ""}`}>{online ? "متصل" : "دون اتصال"}</div>
          <nav className="nav" aria-label="التنقل الرئيسي">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
                {item.label}
              </Link>
            ))}
          </nav>
        </header>
        {content}
      </main>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي للهاتف">
        {navigation.map((item) => (
          <Link key={item.href} href={item.href} aria-current={active === item.href ? "page" : undefined}>
            {item.label}
          </Link>
        ))}
      </nav>

      {showSplash && <Splash onDismiss={dismissSplash} />}

      {modal === "course" && data && (
        <CourseDialog
          data={data}
          courseToEdit={courseToEdit}
          close={() => {
            setModal(null);
            setCourseToEdit(null);
          }}
          saved={async () => {
            setModal(null);
            setCourseToEdit(null);
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

      {modal === "guide" && (
        <GuideModal close={() => setModal(null)} />
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
    defaultValues: { facultyId: ttuConfig.faculties[0].id, majorId: ttuConfig.majors[0].id }
  });
  const facultyId = watch("facultyId");
  const majors = ttuConfig.majors.filter((major) => major.facultyId === facultyId);

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
        هذه البيانات تبقى على جهازك محليًا بالكامل. قوائم الكليات والتخصصات الحالية مخصّصة للتطوير حتى اعتماد بيانات الجامعة الرسمية.
      </p>
      <form
        className="form"
        onSubmit={handleSubmit(async (values) => {
          const profile: StudentProfile = {
            id: crypto.randomUUID(),
            name: values.name.trim(),
            universityId: "ttu",
            facultyId: values.facultyId,
            majorId: values.majorId,
            createdAt: new Date().toISOString()
          };
          const term = {
            id: crypto.randomUUID(),
            name: "الفصل الحالي",
            startsOn: "2026-09-01",
            endsOn: "2026-12-31",
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
          <select {...register("facultyId")}>
            {ttuConfig.faculties.map((faculty) => (
              <option value={faculty.id} key={faculty.id}>
                {faculty.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          التخصص
          <select {...register("majorId")}>
            {majors.map((major) => (
              <option value={major.id} key={major.id}>
                {major.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={isSubmitting}>
          {isSubmitting ? "جارٍ الحفظ…" : "ابدأ مع مرتب"}
        </button>
      </form>
    </section>
  );
}

function Dashboard({
  data,
  pathname,
  openCourse,
  editCourse,
  openRestore,
  openGuide,
  openImport,
  refresh,
  notify
}: {
  data: AppSnapshot;
  pathname: string;
  openCourse: () => void;
  editCourse: (course: Course) => void;
  openRestore: () => void;
  openGuide: () => void;
  openImport: () => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  if (pathname === "/schedule") {
    return (
      <ScheduleView
        data={data}
        openCourse={openCourse}
        openImport={openImport}
        editCourse={editCourse}
        refresh={refresh}
        notify={notify}
      />
    );
  }
  if (pathname === "/calendar") {
    return <CalendarView data={data} />;
  }
  if (pathname === "/settings") {
    return <SettingsView data={data} openRestore={openRestore} openGuide={openGuide} refresh={refresh} notify={notify} />;
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

  const exportIcs = () => {
    const term = data.terms.find((item) => item.id === data.settings.activeTermId) ?? data.terms[0];
    if (!term) return;
    const blob = new Blob([generateIcs(data.courses, data.sessions, term)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "murattab-schedule.ics";
    link.click();
    URL.revokeObjectURL(url);
    notify("تم تصدير ملف التقويم للجدول كاملًا.");
  };

  return (
    <>
      <section className="hero">
        <div className="card">
          <p className="eyebrow">أهلًا، {data.profile?.name}</p>
          <h1>جدولك في مكانه الصحيح.</h1>
          <p className="muted">أضف جلساتك يدويًا، ثم اعرضها بتفاصيل أوضح على يومك وتقويمك وصدّرها لهاتفك.</p>
          <div className="actions">
            <button className="button" onClick={openCourse}>
              إضافة مادة يدويًا
            </button>
            <button className="button secondary" onClick={openImport}>
              استيراد الجدول
            </button>
            {data.courses.length > 0 && (
              <button className="button secondary" onClick={exportIcs}>
                تصدير التقويم (ICS)
              </button>
            )}
          </div>
        </div>

        <div className="next-card">
          {currentSession && activeCourse ? (
            <>
              <p className="eyebrow">المحاضرة الحالية (جارية الآن)</p>
              <h2>{activeCourse.name}</h2>
              <p>
                {formatArabicTime(currentSession.startsAt)} — {formatArabicTime(currentSession.endsAt)}
              </p>
              <p className="muted">{currentSession.room.label}</p>
            </>
          ) : upcomingSession && activeCourse ? (
            <>
              <p className="eyebrow">المحاضرة القادمة</p>
              <h2>{activeCourse.name}</h2>
              <p>
                {formatArabicTime(upcomingSession.startsAt)} — {formatArabicTime(upcomingSession.endsAt)}
              </p>
              <p className="muted">{upcomingSession.room.label}</p>
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
          sessions={todaySessions}
          courses={data.courses}
          empty={todayCode ? `لا توجد جلسات مجدولة ليوم ${dayNames[todayCode]}.` : "لا توجد جلسات لهذا اليوم."}
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
    <div className="card">
      {sessions.map((session) => {
        const course = courses.find((item) => item.id === session.courseId);
        return (
          <article className="session" key={session.id}>
            <div>
              <span className={`kind ${session.kind === "lab" ? "lab" : ""}`}>
                {session.kind === "lecture" ? "نظري" : session.kind === "lab" ? "عملي" : "غير محدد"}
              </span>
              <h3>{course?.name ?? "مادة غير معروفة"}</h3>
              <p className="muted">{session.room.label}</p>
            </div>
            <div className="time">
              {formatArabicTime(session.startsAt)}
              <br />
              {formatArabicTime(session.endsAt)}
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
  openImport,
  editCourse,
  refresh,
  notify
}: {
  data: AppSnapshot;
  openCourse: () => void;
  openImport: () => void;
  editCourse: (course: Course) => void;
  refresh: () => Promise<void>;
  notify: (value: string) => void;
}) {
  const [day, setDay] = useState<DayCode>("ح");
  const sessions = sortSessions(data.sessions.filter((item) => item.day === day));
  const [courseToDelete, setCourseToDelete] = useState<Course | null>(null);

  const exportAllIcs = () => {
    const term = data.terms.find((item) => item.id === data.settings.activeTermId) ?? data.terms[0];
    if (!term) return;
    const blob = new Blob([generateIcs(data.courses, data.sessions, term)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "murattab-schedule.ics";
    link.click();
    URL.revokeObjectURL(url);
    notify("تم تصدير ملف التقويم للجدول كاملًا.");
  };

  const exportSingleIcs = (course: Course) => {
    const term = data.terms.find((item) => item.id === data.settings.activeTermId) ?? data.terms[0];
    if (!term) return;
    const blob = new Blob([generateCourseIcs(course, data.sessions, term)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `murattab-${course.name}.ics`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`تم تصدير تقويم مادة ${course.name}.`);
  };

  return (
    <section>
      <div className="section-head">
        <div>
          <p className="eyebrow">جدولي</p>
          <h1>أسبوعك الدراسي</h1>
        </div>
        <div className="actions">
          <button className="button" onClick={openCourse}>
            إضافة مادة
          </button>
          <button className="button secondary" onClick={openImport}>
            استيراد الجدول
          </button>
          {data.courses.length > 0 && (
            <button className="button secondary" onClick={exportAllIcs}>
              تصدير الجدول (ICS)
            </button>
          )}
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
        <div className="card" style={{ textAlign: "center", padding: "32px 16px", marginTop: 24 }}>
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

      {data.courses.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="section-head">
            <h2>إدارة المواد ({data.courses.length})</h2>
          </div>
          {data.courses.map((course) => {
            const courseSessionsList = data.sessions.filter((s) => s.courseId === course.id);
            return (
              <div className="setting" key={course.id}>
                <div>
                  <strong>{course.name}</strong>
                  <p className="muted">
                    {courseSessionsList.length} جلسات أسبوعية
                    {course.reminder.enabled ? ` · تنبيه قبل ${course.reminder.minutesBefore} د` : ""}
                  </p>
                </div>
                <div className="actions">
                  <button className="button secondary" onClick={() => editCourse(course)}>
                    تعديل
                  </button>
                  <button className="button ghost" onClick={() => exportSingleIcs(course)} title="تصدير ICS لهذه المادة">
                    تصدير
                  </button>
                  <button className="button danger" onClick={() => setCourseToDelete(course)}>
                    حذف
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {courseToDelete && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="del-course-title">
          <div className="dialog">
            <h2 id="del-course-title">تأكيد حذف المادة</h2>
            <p>
              هل أنت متأكد من حذف مادة <strong>«{courseToDelete.name}»</strong>؟ سيتم حذف جميع الجلسات المرتبطة بها في مختلف الأيام.
            </p>
            <div className="actions" style={{ marginTop: 20 }}>
              <button
                className="button danger"
                onClick={async () => {
                  await repo.deleteCourse(courseToDelete.id);
                  setCourseToDelete(null);
                  await refresh();
                  notify("تم حذف المادة وجلساتها بنجاح.");
                }}
              >
                نعم، احذف المادة
              </button>
              <button className="button ghost" onClick={() => setCourseToDelete(null)}>
                إلغاء
              </button>
            </div>
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

  const isToday = (dayNum: number) => {
    const today = new Date();
    return today.getFullYear() === year && today.getMonth() === month && today.getDate() === dayNum;
  };

  return (
    <section>
      <p className="eyebrow">التقويم الشهري</p>
      <h1>{arabicMonths[month]} {year}</h1>

      <div className="card">
        <div className="calendar-header">
          <button className="button secondary" onClick={prevMonth} aria-label="الشهر السابق">
            &rarr; الشهر السابق
          </button>
          <h2>{arabicMonths[month]} {year}</h2>
          <button className="button secondary" onClick={nextMonth} aria-label="الشهر التالي">
            الشهر التالي &larr;
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
            const isSelected = safeSelected === date;

            return (
              <button
                className={`day-cell ${sessionCount ? "has-session" : ""} ${isSelected ? "selected" : ""} ${isToday(date) ? "today" : ""}`}
                key={date}
                onClick={() => setSelectedDayNum(date)}
                aria-label={`${date} ${arabicMonths[month]}، ${sessionCount} جلسات`}
              >
                <span>{date}</span>
                {sessionCount > 0 && (
                  <span className="badge" title={`${sessionCount} محاضرات`}>
                    {sessionCount}
                  </span>
                )}
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
    </section>
  );
}

function SettingsView({
  data,
  openRestore,
  openGuide,
  refresh,
  notify
}: {
  data: AppSnapshot;
  openRestore: () => void;
  openGuide: () => void;
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

  return (
    <section>
      <p className="eyebrow">الإعدادات</p>
      <h1>إعداداتك المحلية</h1>

      <div className="card settings">
        <div className="setting">
          <div>
            <h2>المظهر</h2>
            <p className="muted">اختر الوضع الفاتح أو الداكن أو اتباع إعداد النظام.</p>
          </div>
          <select
            aria-label="المظهر"
            value={data.settings.theme}
            onChange={(event) => void update({ theme: event.target.value as AppSettings["theme"] })}
          >
            <option value="system">إعداد الجهاز</option>
            <option value="light">فاتح</option>
            <option value="dark">داكن</option>
          </select>
        </div>

        <div className="setting">
          <div>
            <h2>الفصل الأكاديمي الحالي</h2>
            <p className="muted">
              {activeTerm ? `${activeTerm.name} (${activeTerm.startsOn} إلى ${activeTerm.endsOn})` : "غير محدد"}
            </p>
          </div>
        </div>

        <div className="setting">
          <div>
            <h2>الملف الأكاديمي المحلي</h2>
            <p className="muted">
              {data.profile?.name} · {facultyName} — {majorName} ({ttuConfig.name})
            </p>
          </div>
        </div>

        <div className="setting">
          <div>
            <h2>النسخة الاحتياطية (JSON)</h2>
            <p className="muted">تصدير واستعادة جدولك وملفك المحلي بصيغة JSON دون حاجة إلى أي خادم.</p>
          </div>
          <div className="actions">
            <button className="button secondary" onClick={download}>
              تصدير
            </button>
            <button className="button ghost" onClick={openRestore}>
              استعادة
            </button>
          </div>
        </div>

        <div className="setting">
          <div>
            <h2>الدليل الإرشادي</h2>
            <p className="muted">استعراض دليل استخدام مرتب التأسيسي في أي وقت.</p>
          </div>
          <button className="button secondary" onClick={openGuide}>
            فتح الدليل
          </button>
        </div>

        <div className="setting">
          <div>
            <h2>إدارة البيانات المحلية</h2>
            <p className="muted">حذف جميع المواد والملف والإعدادات المحلية من هذا المتصفح نهائيًا.</p>
          </div>
          <button className="button danger" onClick={() => setConfirmClear(true)}>
            حذف جميع البيانات
          </button>
        </div>

        <div className="setting">
          <div>
            <h2>الخصوصية والإصدار</h2>
            <p className="muted">
              مرتب 0.1.0 · تطبيق محلي (Local-first) مخصص لجامعة الطفيلة التقنية. لا تُرسل بيانات الطالب أو جدوله إلى أي خادم خارجي.
            </p>
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

function GuideModal({ close }: { close: () => void }) {
  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <div className="dialog">
        <div className="section-head">
          <h2 id="guide-title">دليل استخدام «مرتب»</h2>
          <button className="button ghost" onClick={close} aria-label="إغلاق">
            إغلاق
          </button>
        </div>
        <div style={{ display: "grid", gap: 16, marginTop: 10 }}>
          <article>
            <h3>1. إضافة وإدارة المواد</h3>
            <p className="muted">
              يمكنك إضافة مواد جدولك من شاشة «الرئيسية» أو «جدولي». تدعم المادة الواحدة جلسات متعددة على أيام مختلفة مع تحديد القاعة ونوع الجلسة (نظري أو عملي).
            </p>
          </article>
          <article>
            <h3>2. كشف تعارض المواعيد</h3>
            <p className="muted">
              يفحص التطبيق تلقائيًا أي تداخل بين الجلسات في نفس اليوم والوقت، وينبهك فورًا باسم المادة المتعارضة مع إمكانية تأكيد الحفظ إذا رغبت.
            </p>
          </article>
          <article>
            <h3>3. متابعة اليوم وأوقات الفراغ</h3>
            <p className="muted">
              تعرض لك الشاشة الرئيسية محاضرتك الحالية أو القادمة، وتحسب لك فترات الفراغ والاستراحة بين المحاضرات خلال يومك الدراسي.
            </p>
          </article>
          <article>
            <h3>4. تصدير التقويم (ICS)</h3>
            <p className="muted">
              يمكنك تصدير جدولك بالكامل أو مادة بعينها بصيغة تقويم قياسية واستيرادها مباشرة في تقويم هاتفك (Google Calendar أو Apple Calendar).
            </p>
          </article>
          <article>
            <h3>5. أمان وحفظ البيانات (Local-first)</h3>
            <p className="muted">
              بياناتك تبقى على جهازك دائمًا. استخدم خاصية «النسخة الاحتياطية» في الإعدادات لحفظ ملف جدولك أو نقله لجهاز آخر بأمان.
            </p>
          </article>
        </div>
        <div className="actions" style={{ marginTop: 24 }}>
          <button className="button" onClick={close}>
            فهمت ذلك
          </button>
        </div>
      </div>
    </div>
  );
}

