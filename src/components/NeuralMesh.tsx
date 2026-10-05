"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

// Subtle animated "neural mesh" background for the chat window: faint indigo
// nodes drifting very slowly, joined by thin lines when they're close. A
// message being sent/received sends a soft ring of light rippling outward
// from that side of the screen (see `pulse()` on the handle).
//
// Built to cost almost nothing on a phone, since the app is used all day as
// an installed PWA:
//   - drawing stops entirely while the page is hidden (other app in front,
//     screen off) — see the visibilitychange listener;
//   - drawing also freezes after IDLE_MS without any touch/scroll/key/message,
//     leaving the last frame on screen, and wakes on the next interaction;
//   - frames are capped at ~30fps (the drift is slow enough that 60 looks
//     identical);
//   - few nodes (scaled to the area, small on phones);
//   - prefers-reduced-motion: one static frame, no drift, no pulses.

export type NeuralMeshHandle = {
  /** Ripple a pulse in from the left (received) or right (sent) edge. */
  pulse: (side: "left" | "right") => void;
};

type Node = { x: number; y: number; vx: number; vy: number; phase: number; glow: number };
type Pulse = { x: number; y: number; t0: number };

const FRAME_MS = 1000 / 30;
const IDLE_MS = 25_000;
const PULSE_LIFE_MS = 1900;
const PULSE_SPEED = 520; // px per second the ring expands
const PULSE_BAND = 80; // px thickness of the ring that lights nodes

export default function NeuralMesh({
  ref,
  className = "",
}: {
  ref?: Ref<NeuralMeshHandle>;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef<((side: "left" | "right") => void) | null>(null);

  useImperativeHandle(ref, () => ({
    pulse: (side) => pulseRef.current?.(side),
  }));

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !parent || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    const nodes: Node[] = [];
    const pulses: Pulse[] = [];
    let raf = 0;
    let running = false;
    let lastFrame = 0;
    let lastActivity = performance.now();

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    function targetCount() {
      return Math.round(Math.min(70, Math.max(22, (width * height) / 15000)));
    }

    function makeNode(): Node {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(3, 9); // px per second — barely perceptible
      return {
        x: rand(0, width),
        y: rand(0, height),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        phase: rand(0, Math.PI * 2),
        glow: 0,
      };
    }

    function resize() {
      const rect = parent!.getBoundingClientRect();
      const prevW = width;
      const prevH = height;
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (prevW > 0 && prevH > 0) {
        for (const n of nodes) {
          n.x = (n.x / prevW) * width;
          n.y = (n.y / prevH) * height;
        }
      }
      const want = targetCount();
      while (nodes.length < want) nodes.push(makeNode());
      if (nodes.length > want) nodes.length = want;
      draw(performance.now());
    }

    function step(dt: number) {
      for (const n of nodes) {
        n.x += n.vx * dt;
        n.y += n.vy * dt;
        if (n.x < 0 || n.x > width) {
          n.vx *= -1;
          n.x = Math.min(width, Math.max(0, n.x));
        }
        if (n.y < 0 || n.y > height) {
          n.vy *= -1;
          n.y = Math.min(height, Math.max(0, n.y));
        }
      }
    }

    function draw(now: number) {
      ctx!.clearRect(0, 0, width, height);

      // Drop finished pulses, then work out how lit each node is.
      for (let i = pulses.length - 1; i >= 0; i--) {
        if (now - pulses[i].t0 > PULSE_LIFE_MS) pulses.splice(i, 1);
      }
      for (const n of nodes) {
        let glow = 0;
        for (const p of pulses) {
          const age = now - p.t0;
          const radius = (age / 1000) * PULSE_SPEED;
          const dist = Math.hypot(n.x - p.x, n.y - p.y);
          const near = 1 - Math.abs(dist - radius) / PULSE_BAND;
          if (near > 0) glow = Math.max(glow, near * (1 - age / PULSE_LIFE_MS));
        }
        n.glow = glow;
      }

      const linkDist = width < 640 ? 130 : 170;

      ctx!.lineWidth = 1;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d > linkDist) continue;
          const closeness = 1 - d / linkDist;
          const alpha = closeness * 0.14 + ((a.glow + b.glow) / 2) * 0.45 * closeness;
          ctx!.strokeStyle = `rgba(99, 102, 241, ${alpha.toFixed(3)})`;
          ctx!.beginPath();
          ctx!.moveTo(a.x, a.y);
          ctx!.lineTo(b.x, b.y);
          ctx!.stroke();
        }
      }

      const t = now / 1000;
      for (const n of nodes) {
        const twinkle = 0.5 + 0.5 * Math.sin(t * 0.6 + n.phase);
        const alpha = 0.24 + twinkle * 0.14 + n.glow * 0.6;
        if (n.glow > 0.05) {
          ctx!.fillStyle = `rgba(129, 140, 248, ${(n.glow * 0.18).toFixed(3)})`;
          ctx!.beginPath();
          ctx!.arc(n.x, n.y, 9 + n.glow * 6, 0, Math.PI * 2);
          ctx!.fill();
        }
        ctx!.fillStyle = `rgba(129, 140, 248, ${alpha.toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(n.x, n.y, 1.8 + n.glow * 1.2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      // Idle with nothing animating: leave the last frame on screen and stop.
      if (now - lastActivity > IDLE_MS && pulses.length === 0) {
        stop();
        return;
      }
      step(dt);
      draw(now);
    }

    function start() {
      if (running || reduceMotion || document.visibilityState === "hidden") return;
      running = true;
      lastFrame = performance.now();
      raf = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
    }

    function wake() {
      lastActivity = performance.now();
      start();
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") stop();
      else wake();
    }

    pulseRef.current = (side) => {
      if (reduceMotion) return;
      pulses.push({
        x: side === "left" ? width * 0.1 : width * 0.9,
        y: height * 0.85,
        t0: performance.now(),
      });
      wake();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    const activityEvents = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
    for (const e of activityEvents) window.addEventListener(e, wake, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    start();

    return () => {
      stop();
      pulseRef.current = null;
      observer.disconnect();
      for (const e of activityEvents) window.removeEventListener(e, wake, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
    />
  );
}
