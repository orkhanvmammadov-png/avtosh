"use client";

import { useRef } from "react";
import type React from "react";

const TAP_SLOP_PX = 10;
const SYNTH_CLICK_WINDOW_MS = 400;

/**
 * Tap activation for listbox option rows that must coexist with
 * native touch scrolling — without relying on synthesized clicks.
 *
 * Why not onClick: iOS Safari withholds the first tap's click when
 * the hover phase mutates content (tap-as-hover heuristic — our
 * rows highlight on pointerenter), which made Brand selection need
 * a second tap on a physical iPhone. Why not onPointerDown: it
 * fires the instant a finger lands, so a swipe starting on a row
 * would select instead of scroll.
 *
 * Contract: activation happens on pointerup of the SAME pointer
 * within a small slop of where it went down. A gesture the browser
 * turns into a scroll emits pointercancel (never pointerup), so
 * scrolling can never activate. Mouse presses activate on release,
 * matching native click semantics; keyboard activation is separate
 * and untouched. After a touch activation the one click the browser
 * synthesizes afterwards is swallowed (capture, once, short-lived),
 * so it cannot "click through" onto whatever moves under the finger
 * when the list closes.
 */
export function useTapActivation(): {
  onRowPointerDown: (e: React.PointerEvent) => void;
  onRowPointerCancel: () => void;
  onRowPointerUp: (e: React.PointerEvent, action: () => void) => void;
} {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);
  return {
    onRowPointerDown: (e) => {
      start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    onRowPointerCancel: () => {
      start.current = null;
    },
    onRowPointerUp: (e, action) => {
      const s = start.current;
      start.current = null;
      if (s === null || s.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP_PX) return;
      if (e.pointerType !== "mouse") {
        const swallow = (ce: MouseEvent) => {
          ce.preventDefault();
          ce.stopPropagation();
        };
        document.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(
          () => document.removeEventListener("click", swallow, { capture: true }),
          SYNTH_CLICK_WINDOW_MS,
        );
      }
      action();
    },
  };
}
