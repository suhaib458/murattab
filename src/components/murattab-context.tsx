"use client";

import { createContext, useContext } from "react";
import type { AppSnapshot } from "@/repositories/schedule-repository";
import type { Course } from "@/domain/models";

export interface MurattabContextValue {
  data: AppSnapshot;
  refresh: () => Promise<void>;
  openCourse: (course?: Course | null) => void;
  openRestore: () => void;
  openImport: () => void;
  openManage: () => void;
  startTour: () => void;
  notify: (value: string) => void;
}

const MurattabContext = createContext<MurattabContextValue | null>(null);

export function useMurattab(): MurattabContextValue {
  const ctx = useContext(MurattabContext);
  if (!ctx) {
    throw new Error("useMurattab must be used within a MurattabApp shell");
  }
  return ctx;
}

export const MurattabProvider = MurattabContext.Provider;
