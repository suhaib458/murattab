"use client";

/**
 * Phase 3.5C — Tour state store.
 *
 * Ephemeral state (active flag + current step) lives in this module-level
 * store so that it survives route changes across Next.js App Router pages.
 *
 * Store contract for useSyncExternalStore:
 *  - getSnapshot() returns a referentially stable object while state is unchanged.
 *  - getServerTourSnapshot() returns a frozen constant.
 *  - subscribeTour() notifies listeners ONLY when state actually changes.
 */

export const TOUR_TOTAL = 6;

export type TourSnapshot = {
  readonly active: boolean;
  readonly step: number;
};

export const SERVER_TOUR_SNAPSHOT: TourSnapshot = Object.freeze({
  active: false,
  step: 0
});

let snapshot: TourSnapshot = SERVER_TOUR_SNAPSHOT;
let hasAutoTriggered = false;
let originRoute: string | null = null;
const listeners = new Set<() => void>();

function isSame(a: TourSnapshot, b: TourSnapshot): boolean {
  return a.active === b.active && a.step === b.step;
}

function commit(next: TourSnapshot): void {
  if (isSame(snapshot, next)) return;
  snapshot = Object.freeze(next);
  for (const listener of listeners) {
    listener();
  }
}

export function getTourSnapshot(): TourSnapshot {
  return snapshot;
}

export function getServerTourSnapshot(): TourSnapshot {
  return SERVER_TOUR_SNAPSHOT;
}

export function subscribeTour(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keep export alias subscribe for backward compatibility
export const subscribe = subscribeTour;

export function autoTriggerTour(): boolean {
  if (hasAutoTriggered || snapshot.active) {
    return false;
  }
  hasAutoTriggered = true;
  originRoute = "/";
  if (typeof window !== "undefined") {
    sessionStorage.setItem("murattab-tour-origin", "/");
  }
  commit({ active: true, step: 0 });
  return true;
}

export function startTour(origin?: string): void {
  originRoute = typeof origin === "string" ? origin : null;
  if (typeof window !== "undefined") {
    if (originRoute) {
      sessionStorage.setItem("murattab-tour-origin", originRoute);
    } else {
      sessionStorage.removeItem("murattab-tour-origin");
    }
  }
  commit({ active: true, step: 0 });
}

export function endTour(): void {
  if (typeof window !== "undefined") {
    sessionStorage.removeItem("murattab-tour-origin");
  }
  originRoute = null;
  commit({ active: false, step: 0 });
}

export function getOriginRoute(): string | null {
  if (typeof window !== "undefined") {
    return sessionStorage.getItem("murattab-tour-origin") ?? originRoute;
  }
  return originRoute;
}

export function nextStep(): void {
  if (!snapshot.active) return;
  if (snapshot.step < TOUR_TOTAL - 1) {
    commit({ active: true, step: snapshot.step + 1 });
  } else {
    commit({ active: false, step: 0 });
  }
}

export function previousStep(): void {
  if (!snapshot.active) return;
  if (snapshot.step > 0) {
    commit({ active: true, step: snapshot.step - 1 });
  }
}
