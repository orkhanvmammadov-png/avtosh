"use client";

import { useRef } from "react";
import type React from "react";

const TAP_SLOP_PX = 10;
const SYNTH_CLICK_WINDOW_MS = 400;
const SUPPRESS_RADIUS_PX = 24;

/**
 * Click-through suppression correlated to the activating touch. A
 * browser-synthesized post-tap click belongs to the SAME gesture, so
 * it arrives with NO new pointerdown in between; any new pointerdown
 * (the user's next tap or mouse press, anywhere) disarms the
 * suppression first. A click is swallowed only when it is still
 * armed, inside the time window, and lands within a small radius of
 * the activation point — an unrelated intentional tap can therefore
 * never be consumed, even at the same spot, because its own
 * pointerdown disarms before its click.
 */
let pendingSuppression: { x: number; y: number; until: number } | null = null;
let suppressionInstalled = false;

function armClickSuppression(x: number, y: number): void {
  if (!suppressionInstalled) {
    suppressionInstalled = true;
    document.addEventListener(
      "pointerdown",
      () => {
        pendingSuppression = null;
      },
      true,
    );
    document.addEventListener(
      "click",
      (ce) => {
        if (pendingSuppression === null) return;
        const p = pendingSuppression;
        pendingSuppression = null;
        if (performance.now() > p.until) return;
        if (Math.hypot(ce.clientX - p.x, ce.clientY - p.y) > SUPPRESS_RADIUS_PX) return;
        ce.preventDefault();
        ce.stopPropagation();
      },
      true,
    );
  }
  pendingSuppression = { x, y, until: performance.now() + SYNTH_CLICK_WINDOW_MS };
}

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
 * and untouched. After a touch activation, the one click the browser
 * synthesizes for that SAME gesture is swallowed (see
 * armClickSuppression — disarmed by any new pointerdown), so it
 * cannot "click through" onto whatever moves under the finger when
 * the list closes, while an unrelated next tap is never consumed.
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
        armClickSuppression(e.clientX, e.clientY);
      }
      action();
    },
  };
}
