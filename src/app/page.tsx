"use client";

import { useMurattab } from "@/components/murattab-context";
import { HomeView } from "@/features/home/components/home-view";

export default function Home() {
  const { data } = useMurattab();
  return <HomeView data={data} />;
}
