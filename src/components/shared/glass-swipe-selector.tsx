"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode
} from "react";

type GlassSwipeOption<T extends string> = {
  value: T;
  label: string;
  accessibleLabel?: string;
  icon: ReactNode;
};

type Thumb = {
  left: number;
  width: number;
};

const DRAG_THRESHOLD = 8;

/**
 * A normal button group with a glass thumb that can also be moved with one
 * finger. Tapping and keyboard activation remain first-class controls.
 */
export function GlassSwipeSelector<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className
}: {
  value: T;
  options: GlassSwipeOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const controlRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<{ id: number; startX: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const [dragging, setDragging] = useState(false);

  const getOptions = useCallback(() => {
    return Array.from(controlRef.current?.querySelectorAll<HTMLButtonElement>("[data-glass-swipe-option]") ?? []);
  }, []);

  const setThumbForOption = useCallback((option: HTMLButtonElement | null) => {
    const control = controlRef.current;
    if (!control || !option) return;

    const controlRect = control.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    setThumb({
      left: optionRect.left - controlRect.left,
      width: optionRect.width
    });
  }, []);

  const nearestOption = useCallback((clientX: number) => {
    const buttons = getOptions();
    return buttons.reduce<HTMLButtonElement | null>((nearest, button) => {
      if (!nearest) return button;
      const distance = Math.abs(button.getBoundingClientRect().left + button.getBoundingClientRect().width / 2 - clientX);
      const nearestDistance = Math.abs(nearest.getBoundingClientRect().left + nearest.getBoundingClientRect().width / 2 - clientX);
      return distance < nearestDistance ? button : nearest;
    }, null);
  }, [getOptions]);

  const moveThumbWithPointer = useCallback((clientX: number) => {
    const control = controlRef.current;
    const option = nearestOption(clientX);
    if (!control || !option) return null;

    const controlRect = control.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    const width = optionRect.width;
    const left = Math.min(
      Math.max(clientX - controlRect.left - width / 2, 0),
      Math.max(controlRect.width - width, 0)
    );
    setThumb({ left, width });
    return option;
  }, [nearestOption]);

  useEffect(() => {
    const control = controlRef.current;
    if (!control) return;

    const updateThumb = () => {
      const selected = control.querySelector<HTMLButtonElement>(`[data-glass-swipe-option="${value}"]`);
      setThumbForOption(selected);
    };
    const frame = window.requestAnimationFrame(updateThumb);
    const observer = new ResizeObserver(updateThumb);
    observer.observe(control);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [setThumbForOption, value]);

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== event.pointerId) return;

    pointerRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const option = nearestOption(event.clientX);
    if (!option) return;
    if (!cancelled && pointer.moved) {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      onChange(option.dataset.glassSwipeOption as T);
    } else {
      setThumbForOption(option);
    }
  };

  const thumbStyle = thumb
    ? ({
        "--glass-swipe-thumb-left": `${thumb.left}px`,
        "--glass-swipe-thumb-width": `${thumb.width}px`
      } as CSSProperties)
    : undefined;

  return (
    <div
      ref={controlRef}
      className={`glass-swipe-selector${dragging ? " is-dragging" : ""}${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={ariaLabel}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        pointerRef.current = { id: event.pointerId, startX: event.clientX, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
        moveThumbWithPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        const pointer = pointerRef.current;
        if (!pointer || pointer.id !== event.pointerId) return;
        if (Math.abs(event.clientX - pointer.startX) >= DRAG_THRESHOLD) pointer.moved = true;
        moveThumbWithPointer(event.clientX);
      }}
      onPointerUp={(event) => endDrag(event)}
      onPointerCancel={(event) => endDrag(event, true)}
    >
      <span className="glass-swipe-thumb" style={thumbStyle} aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          data-glass-swipe-option={option.value}
          aria-pressed={value === option.value}
          aria-label={option.accessibleLabel}
          title={option.accessibleLabel}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onChange(option.value);
          }}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
