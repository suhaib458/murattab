"use client";

import { useMurattab } from "@/components/murattab-context";
import { CalendarView } from "@/features/calendar/components/calendar-view";

export default function Calendar() {
  const { data } = useMurattab();
  return <CalendarView data={data} />;
}
