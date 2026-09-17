"use client";

/**
 * Phase 3.5C — Interactive first-run guided tour overlay.
 *
 * Architecture:
 * - Single source of truth: `tour-store.ts` module-level external store.
 * - Adheres strictly to the `useSyncExternalStore` contract with referentially
 *   stable snapshots and a frozen server snapshot.
 * - Target resolution is route-aware with bounded retries (~3s max).
 * - Tooltip layout is purely derived during render (zero setState layout loops).
 * - Supports forward and backward navigation across routes.
 * - Clean SVG spotlight cutout with fallback dimmed overlay.
 * - Complete keyboard accessibility (Focus Trap, Escape, RTL).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import styles from "../tour.module.css";
import {
  endTour as endTourStore,
  getServerTourSnapshot,
  getTourSnapshot,
  nextStep as nextStepStore,
  previousStep as previousStepStore,
  subscribeTour,
  TOUR_TOTAL
} from "../store/tour-store";

export const CURRENT_GUIDE_VERSION = 1;

export type TourStep = {
  id: string;
  /** [data-tour="<key>"] selector. */
  target: string;
  /** Route to navigate to before measuring the target. */
  route: string;
  title: string;
  body: string;
  /** Extra padding around the spotlight rect. */
  pad?: number;
  /** When true, render the centered final card instead of a coach card. */
  final?: boolean;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "home",
    target: "next-class",
    route: "/",
    title: "محاضرتك القادمة",
    body: "من هون بتشوف أقرب محاضرة إلك، وقتها ومكانها ونوعها بسرعة."
  },
  {
    id: "schedule",
    target: "schedule-nav",
    route: "/schedule",
    title: "جدولك الأسبوعي",
    body: "تنقّل بين أيام الأسبوع وشوف محاضراتك ومختبراتك وأوقاتها."
  },
  {
    id: "schedule-actions",
    target: "schedule-actions",
    route: "/schedule",
    title: "أضف جدولك بطريقتك",
    body: "بتقدر تضيف المواد يدويًا أو تستورد صورة جدولك ليتم تحليلها ومراجعتها قبل الحفظ.",
    pad: 8
  },
  {
    id: "calendar",
    target: "calendar-nav",
    route: "/calendar",
    title: "التقويم الأكاديمي",
    body: "تابع مواعيد الجامعة المهمة، الامتحانات والعطل والأحداث الأكاديمية."
  },
  {
    id: "settings",
    target: "settings-nav",
    route: "/settings",
    title: "تحكم بتطبيقك",
    body: "من الإعدادات بتقدر تغيّر المظهر، تدير موادك، النسخ الاحتياطي وتراجع بياناتك الجامعية."
  },
  {
    id: "finish",
    target: "tour-finish",
    route: "/settings",
    title: "كل شيء جاهز",
    body: "مرتب صار جاهز يساعدك تخلي جدولك الجامعي أوضح وأسهل.",
    final: true
  }
];

type Rect = { x: number; y: number; w: number; h: number };

const SAFE_TOP_FALLBACK = 0;
const SAFE_BOTTOM_FALLBACK = 0;
const TOUR_BREAKPOINT = 700;

function readSafe(name: "top" | "bottom"): number {
  if (typeof window === "undefined") return 0;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--safe-${name}`).trim();
  if (!v) return name === "top" ? SAFE_TOP_FALLBACK : SAFE_BOTTOM_FALLBACK;
  return parseFloat(v) || 0;
}

function isSameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}

export function TourOverlay({
  onComplete
}: {
  onComplete: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Single source of truth via external store
  const tourState = useSyncExternalStore(
    subscribeTour,
    getTourSnapshot,
    getServerTourSnapshot
  );
  const { active, step: stepIndex } = tourState;

  const step = TOUR_STEPS[stepIndex] ?? TOUR_STEPS[0];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_TOTAL - 1;

  // Track initial focus element on activation to restore on close
  useEffect(() => {
    if (active) {
      previousFocus.current = (document.activeElement as HTMLElement) ?? null;
    }
  }, [active]);

  // Detect user preference for reduced motion
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Effective target rect: during route transition or for final step, spotlight cutout is inactive
  const effectiveTargetRect = step.final || step.route !== pathname ? null : targetRect;

  // Route synchronization: navigate when step.route differs from current pathname
  useEffect(() => {
    if (!active) return;
    if (step.route !== pathname) {
      router.push(step.route);
    }
  }, [active, step.route, pathname, router]);

  // Target resolution and measurement with bounded retry
  useEffect(() => {
    if (!active || step.final || step.route !== pathname) {
      return;
    }

    let cancelled = false;
    const pad = step.pad ?? 8;
    const startTime = Date.now();
    const TIMEOUT_MS = 3000;

    const findVisibleTarget = (): { el: HTMLElement; rect: DOMRect } | null => {
      if (step.target === "tour-finish") return null;
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)
      );
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const comp = window.getComputedStyle(el);
          if (comp.display !== "none" && comp.visibility !== "hidden") {
            return { el, rect: r };
          }
        }
      }
      return null;
    };

    const attemptMeasure = () => {
      if (cancelled) return;

      const found = findVisibleTarget();
      if (found) {
        const { el, rect: r } = found;
        const next: Rect = {
          x: Math.round(r.x - pad),
          y: Math.round(r.y - pad),
          w: Math.round(r.width + pad * 2),
          h: Math.round(r.height + pad * 2)
        };

        setTargetRect((prev) => (isSameRect(prev, next) ? prev : next));

        // Smooth scroll into view if target is off-screen
        if (r.top < 60 || r.bottom > window.innerHeight - 60) {
          try {
            el.scrollIntoView({
              behavior: reducedMotion ? "auto" : "smooth",
              block: "center"
            });
          } catch {
            // Ignore scroll errors in older test environments
          }
        }
        return;
      }

      if (Date.now() - startTime > TIMEOUT_MS) {
        // Budget exhausted: gracefully fallback to centered card without spotlight hole
        setTargetRect(null);
        return;
      }

      window.requestAnimationFrame(attemptMeasure);
    };

    // Trigger measurement after paint
    const timer = window.setTimeout(attemptMeasure, reducedMotion ? 0 : 40);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, step, pathname, reducedMotion]);

  // Keep target rect updated on window resize or scroll without redundant renders
  useEffect(() => {
    if (!active || step.final || step.route !== pathname) return;

    const onReposition = () => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`)
      );
      for (const el of candidates) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const comp = window.getComputedStyle(el);
          if (comp.display !== "none" && comp.visibility !== "hidden") {
            const pad = step.pad ?? 8;
            const next: Rect = {
              x: Math.round(r.x - pad),
              y: Math.round(r.y - pad),
              w: Math.round(r.width + pad * 2),
              h: Math.round(r.height + pad * 2)
            };
            setTargetRect((prev) => (isSameRect(prev, next) ? prev : next));
            return;
          }
        }
      }
    };

    window.addEventListener("resize", onReposition, { passive: true });
    window.addEventListener("scroll", onReposition, { passive: true, capture: true });
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [active, step, pathname]);

  // Focus coach card on step transition
  useEffect(() => {
    if (!active) return;
    const id = window.setTimeout(() => {
      cardRef.current?.focus();
    }, 60);
    return () => window.clearTimeout(id);
  }, [active, stepIndex]);

  // Keyboard accessibility: Escape dismisses/skips the tour
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onComplete();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onComplete]);

  // Keyboard accessibility: Focus trap
  useEffect(() => {
    if (!active) return;
    const onTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = cardRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        "button, [href], [tabindex]:not([tabindex='-1'])"
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onTab);
    return () => window.removeEventListener("keydown", onTab);
  }, [active]);

  // Restore focus to previously active element upon tour close
  useEffect(() => {
    return () => {
      const prev = previousFocus.current;
      if (prev && typeof prev.focus === "function") {
        try {
          prev.focus();
        } catch {
          // ignore
        }
      }
    };
  }, []);

  const next = useCallback(() => {
    if (isLast) {
      onComplete();
      return;
    }
    nextStepStore();
  }, [isLast, onComplete]);

  const prev = useCallback(() => {
    if (isFirst) return;
    previousStepStore();
  }, [isFirst]);

  const skip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Pure derived layout calculations during render (Zero setState loops)
  const derivedLayout = useMemo(() => {
    if (step.final || !effectiveTargetRect) {
      return { isCentered: true, placement: "center" as const, style: {} };
    }
    if (typeof window === "undefined") {
      return { isCentered: true, placement: "center" as const, style: {} };
    }

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Mobile layout (< 700px) is automatically docked above the floating bottom-nav via CSS
    if (viewportW <= TOUR_BREAKPOINT) {
      return { isCentered: false, placement: "above" as const, style: {} };
    }

    // Desktop placement
    const cardW = 360;
    const cardH = 200;
    const margin = 16;
    const safeTop = readSafe("top") + 12;
    const safeBottom = readSafe("bottom");
    const bottomNav = 64;
    const usableBottom = viewportH - safeBottom - bottomNav - 12;
    const usableTop = safeTop;

    const spaceAbove = effectiveTargetRect.y - usableTop;
    const spaceBelow = usableBottom - (effectiveTargetRect.y + effectiveTargetRect.h);

    const placement =
      spaceBelow < cardH + margin && spaceAbove > spaceBelow
        ? ("above" as const)
        : ("below" as const);

    const cx = effectiveTargetRect.x + effectiveTargetRect.w / 2;
    const left = Math.max(margin, Math.min(cx - cardW / 2, viewportW - cardW - margin));
    const top =
      placement === "above"
        ? Math.max(usableTop, effectiveTargetRect.y - cardH - margin)
        : Math.min(usableBottom - cardH, effectiveTargetRect.y + effectiveTargetRect.h + margin);

    return {
      isCentered: false,
      placement,
      style: {
        left: `${left}px`,
        top: `${top}px`,
        opacity: 1
      }
    };
  }, [effectiveTargetRect, step.final]);

  if (!active) return null;

  const renderSpotlight = () => {
    if (step.final || !effectiveTargetRect) {
      return <div className={styles.fullBackdrop} aria-hidden="true" />;
    }
    const pad = 8;
    const vw = typeof window !== "undefined" ? window.innerWidth : 0;
    const vh = typeof window !== "undefined" ? window.innerHeight : 0;
    const path = [
      `M0 0 H${vw} V${vh} H0 Z`,
      `M${effectiveTargetRect.x - pad} ${effectiveTargetRect.y - pad}`,
      `a${pad} ${pad} 0 0 1 ${pad} -${pad}`,
      `H${effectiveTargetRect.x + effectiveTargetRect.w + pad}`,
      `a${pad} ${pad} 0 0 1 ${pad} ${pad}`,
      `V${effectiveTargetRect.y + effectiveTargetRect.h + pad}`,
      `a${pad} ${pad} 0 0 1 -${pad} ${pad}`,
      `H${effectiveTargetRect.x - pad}`,
      `a${pad} ${pad} 0 0 1 -${pad} -${pad}`,
      "Z"
    ].join(" ");
    return (
      <svg
        className={styles.spotlight}
        viewBox={`0 0 ${vw} ${vh}`}
        width={vw}
        height={vh}
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{
          transition: reducedMotion ? "none" : "all 200ms var(--motion-ease, ease-out)"
        }}
      >
        <path d={path} fillRule="evenodd" />
      </svg>
    );
  };

  const labelId = `tour-step-title-${step.id}`;
  const descId = `tour-step-body-${step.id}`;
  const stepNumber = stepIndex + 1;
  const total = TOUR_TOTAL;

  // During cross-route transition, keep stable dimmed overlay and delay dialog presentation
  // until pathname matches targetRoute
  if (step.route !== pathname) {
    return (
      <div className={styles.root} aria-hidden="true">
        <div className={styles.fullBackdrop} aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className={styles.root}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
      aria-describedby={descId}
    >
      {renderSpotlight()}

      {step.final ? (
        <div
          ref={cardRef}
          tabIndex={-1}
          className={styles.finalCard}
        >
          <p className={styles.eyebrow}>
            الخطوة {stepNumber} من {total}
          </p>
          <h2 id={labelId} className={styles.title}>
            {step.title}
          </h2>
          <p id={descId} className={styles.body}>
            {step.body}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              onClick={skip}
              data-tour-target="skip"
            >
              تخطي الدليل
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={next}
              data-tour-target="primary"
              autoFocus
            >
              ابدأ استخدام مرتب
            </button>
          </div>
        </div>
      ) : derivedLayout.isCentered ? (
        <div
          ref={cardRef}
          tabIndex={-1}
          className={styles.centeredCard}
        >
          <p className={styles.eyebrow}>
            الخطوة {stepNumber} من {total}
          </p>
          <h2 id={labelId} className={styles.title}>
            {step.title}
          </h2>
          <p id={descId} className={styles.body}>
            {step.body}
          </p>
          <div className={styles.actions}>
            {!isFirst ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={prev}
                data-tour-target="prev"
              >
                السابق
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondary}
                onClick={skip}
                data-tour-target="skip"
              >
                تخطي الدليل
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={next}
              data-tour-target="primary"
            >
              {isLast ? "إنهاء" : "التالي"}
            </button>
          </div>
        </div>
      ) : (
        <div
          ref={cardRef}
          tabIndex={-1}
          className={`${styles.card} ${derivedLayout.placement === "above" ? styles.above : styles.below}`}
          style={derivedLayout.style}
        >
          <p className={styles.eyebrow}>
            الخطوة {stepNumber} من {total}
          </p>
          <h2 id={labelId} className={styles.title}>
            {step.title}
          </h2>
          <p id={descId} className={styles.body}>
            {step.body}
          </p>
          <div className={styles.actions}>
            {!isFirst ? (
              <button
                type="button"
                className={styles.secondary}
                onClick={prev}
                data-tour-target="prev"
              >
                السابق
              </button>
            ) : (
              <button
                type="button"
                className={styles.secondary}
                onClick={skip}
                data-tour-target="skip"
              >
                تخطي الدليل
              </button>
            )}
            <button
              type="button"
              className={styles.primary}
              onClick={next}
              data-tour-target="primary"
            >
              {isLast ? "إنهاء" : "التالي"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
