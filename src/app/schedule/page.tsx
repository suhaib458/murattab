"use client";

import { useMurattab } from "@/components/murattab-context";
import { ScheduleView } from "@/features/schedule/components/schedule-view";

export default function Schedule() {
  const { data, openCourse, openImport } = useMurattab();
  return (
    <ScheduleView
      data={data}
      openCourse={() => openCourse()}
      openImport={openImport}
    />
  );
}
