"use client";

import { useMurattab } from "@/components/murattab-context";
import { SettingsView } from "@/features/settings/components/settings-view";

export default function Settings() {
  const {
    data,
    openRestore,
    openImport,
    openManage,
    openCourse,
    startTour,
    refresh,
    notify
  } = useMurattab();

  return (
    <SettingsView
      data={data}
      openRestore={openRestore}
      openImport={openImport}
      openManage={openManage}
      openCourse={() => openCourse()}
      startTour={startTour}
      refresh={refresh}
      notify={notify}
    />
  );
}
