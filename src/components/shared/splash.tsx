"use client";

import Image from "next/image";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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

export function Splash({ onDismiss }: { onDismiss: () => void }) {
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
