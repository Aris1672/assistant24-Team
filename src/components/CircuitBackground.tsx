"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

// Animated "AI chip" circuit-board background for the chat window: a glowing
// chip with thin circuit traces fanning out from it, each ending in a dot.
// Light pulses run along the traces at random — travelling out, reaching the
// end dot, and often turning round to come back ("forth and back"). Sending
// or receiving a message fires a burst of pulses (see `pulse()` on the handle).
//
// The artwork is drawn from code (not an image) so every trace is its own
// path a pulse can follow, and so it stays sharp at any screen size. The
// layout is generated from a fixed random seed, so it looks identical on every
// device and every reload; it is rebuilt when the container is resized.
//
// Built to cost almost nothing on a phone, since the app is used all day as
// an installed PWA:
//   - the static artwork (chip + traces) is drawn once into an offscreen
//     canvas; each frame only blits it and draws the few moving pulses;
//   - drawing stops entirely while the page is hidden (other app in front,
//     screen off) — see the visibilitychange listener;
//   - after IDLE_MS without any touch/scroll/key/message no new pulses are
//     spawned; once the last one finishes, drawing stops and the final frame
//     stays on screen. The next interaction wakes it;
//   - frames are capped at ~30fps;
//   - prefers-reduced-motion: the static artwork only, no pulses.

export type CircuitBackgroundHandle = {
  /** Fire a burst of pulses: "right" = sent (out from the chip), "left" = received (in to the chip). */
  pulse: (side: "left" | "right") => void;
};

type Trace = {
  pts: { x: number; y: number }[];
  cum: number[]; // cumulative length at each point; cum[last] = total length
  len: number;
  flash: number; // 0..1 glow of the end dot, decays
};

type Pulse = {
  trace: number;
  s: number; // distance along the trace from the chip end
  dir: 1 | -1;
  speed: number; // px per second
  bounces: number; // direction changes so far
  wait: number; // seconds before it starts moving (burst stagger)
};

const FRAME_MS = 1000 / 30;
const IDLE_MS = 25_000;
const MAX_BOUNCES = 2;
const TAIL_PX = 70;
const TAIL_STEPS = 9;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function CircuitBackground({
  ref,
  className = "",
}: {
  ref?: Ref<CircuitBackgroundHandle>;
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
    let dpr = 1;
    let chip = { x: 0, y: 0, size: 0 };
    let traces: Trace[] = [];
    const pulses: Pulse[] = [];
    let chipGlow = 0;
    let nextSpawn = 0; // seconds until the next ambient pulse
    const base = document.createElement("canvas"); // static artwork
    let raf = 0;
    let running = false;
    let lastFrame = 0;
    let lastActivity = performance.now();
    let boxless = false; // container currently has no size (display: none)

    // ---- layout ---------------------------------------------------------

    function buildTraces() {
      const rnd = mulberry32(20261005);
      const rand = (a: number, b: number) => a + rnd() * (b - a);
      const mobile = width < 640;
      const size = Math.max(56, Math.min(120, Math.min(width, height) * 0.2));
      chip = { x: width * (mobile ? 0.22 : 0.17), y: height * 0.5, size };
      const half = size / 2;
      const margin = 10;

      // How many traces leave each side of the chip.
      const sides: { n: number; heading: number }[] = mobile
        ? [
            { n: 5, heading: 0 },
            { n: 3, heading: -90 },
            { n: 3, heading: 90 },
            { n: 2, heading: 180 },
          ]
        : [
            { n: 10, heading: 0 },
            { n: 6, heading: -90 },
            { n: 6, heading: 90 },
            { n: 3, heading: 180 },
          ];

      const out: Trace[] = [];
      for (const side of sides) {
        for (let i = 0; i < side.n; i++) {
          // Evenly spread pins along the chip edge.
          const frac = (i + 1) / (side.n + 1);
          const off = (frac - 0.5) * size * 0.8;
          const rad = (side.heading * Math.PI) / 180;
          const dx = Math.cos(rad);
          const dy = Math.sin(rad);
          // Edge midpoint + offset along the edge (perpendicular to heading).
          let x = chip.x + dx * half - dy * off;
          let y = chip.y + dy * half + dx * off;

          let heading = side.heading;
          // Fan towards the right (or up/down for the few left-side traces).
          const pref = side.heading === 180 ? 180 + (rnd() < 0.5 ? -45 : 45) : [-45, 0, 45][Math.floor(rnd() * 3)];
          const pts = [{ x, y }];
          const segs = Math.floor(rand(mobile ? 3 : 4, mobile ? 6 : 9));
          for (let s = 0; s < segs; s++) {
            const segLen = mobile ? rand(30, 90) : rand(0.06, 0.16) * width;
            const r = (heading * Math.PI) / 180;
            const sx = Math.cos(r);
            const sy = Math.sin(r);
            // Longest run that still fits on screen.
            let tmax = segLen;
            if (sx > 0.01) tmax = Math.min(tmax, (width - margin - x) / sx);
            if (sx < -0.01) tmax = Math.min(tmax, (margin - x) / sx);
            if (sy > 0.01) tmax = Math.min(tmax, (height - margin - y) / sy);
            if (sy < -0.01) tmax = Math.min(tmax, (margin - y) / sy);
            if (tmax < 18) break;
            const run = Math.min(segLen, tmax);
            x += sx * run;
            y += sy * run;
            pts.push({ x, y });
            if (run < segLen) break; // hit the edge of the screen
            // Bend by 45°, mostly towards the preferred heading.
            let diff = ((pref - heading + 540) % 360) - 180;
            if (Math.abs(diff) > 1 && rnd() < 0.65) heading += Math.sign(diff) * 45;
            else if (rnd() < 0.6) heading += rnd() < 0.5 ? -45 : 45;
            heading = ((heading + 540) % 360) - 180;
            // Never double back on the chip.
            diff = ((side.heading - heading + 540) % 360) - 180;
            if (Math.abs(diff) > 90) heading = side.heading;
          }
          if (pts.length < 2) continue;
          const cum = [0];
          for (let k = 1; k < pts.length; k++) {
            cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
          }
          out.push({ pts, cum, len: cum[cum.length - 1], flash: 0 });
        }
      }
      traces = out;
    }

    function drawBase() {
      const b = base.getContext("2d");
      if (!b) return;
      base.width = Math.floor(width * dpr);
      base.height = Math.floor(height * dpr);
      b.setTransform(dpr, 0, 0, dpr, 0, 0);
      b.clearRect(0, 0, width, height);

      // Soft aura behind the chip.
      const aura = b.createRadialGradient(chip.x, chip.y, chip.size * 0.3, chip.x, chip.y, chip.size * 2.4);
      aura.addColorStop(0, "rgba(99, 102, 241, 0.22)");
      aura.addColorStop(1, "rgba(99, 102, 241, 0)");
      b.fillStyle = aura;
      b.fillRect(0, 0, width, height);

      // Traces.
      b.lineJoin = "round";
      b.lineCap = "round";
      b.lineWidth = 1.2;
      b.strokeStyle = "rgba(96, 130, 255, 0.28)";
      for (const t of traces) {
        b.beginPath();
        b.moveTo(t.pts[0].x, t.pts[0].y);
        for (let k = 1; k < t.pts.length; k++) b.lineTo(t.pts[k].x, t.pts[k].y);
        b.stroke();
      }
      // End dots.
      for (const t of traces) {
        const e = t.pts[t.pts.length - 1];
        b.fillStyle = "rgba(34, 211, 238, 0.12)";
        b.beginPath();
        b.arc(e.x, e.y, 6, 0, Math.PI * 2);
        b.fill();
        b.fillStyle = "rgba(125, 211, 252, 0.7)";
        b.beginPath();
        b.arc(e.x, e.y, 2.4, 0, Math.PI * 2);
        b.fill();
      }

      // Chip: pins, body, inner die, "AI".
      const { x, y, size } = chip;
      const h = size / 2;
      b.strokeStyle = "rgba(129, 140, 248, 0.55)";
      b.lineWidth = 1.5;
      const pinsPerSide = 6;
      for (let i = 0; i < pinsPerSide; i++) {
        const o = ((i + 0.5) / pinsPerSide - 0.5) * size * 0.8;
        b.beginPath();
        b.moveTo(x - h - 7, y + o);
        b.lineTo(x - h, y + o);
        b.moveTo(x + h, y + o);
        b.lineTo(x + h + 7, y + o);
        b.moveTo(x + o, y - h - 7);
        b.lineTo(x + o, y - h);
        b.moveTo(x + o, y + h);
        b.lineTo(x + o, y + h + 7);
        b.stroke();
      }
      const r = size * 0.14;
      b.beginPath();
      b.roundRect(x - h, y - h, size, size, r);
      b.fillStyle = "rgba(17, 19, 48, 0.92)";
      b.fill();
      b.strokeStyle = "rgba(129, 140, 248, 0.8)";
      b.lineWidth = 1.8;
      b.stroke();
      b.beginPath();
      b.roundRect(x - h * 0.66, y - h * 0.66, size * 0.66, size * 0.66, r * 0.6);
      b.strokeStyle = "rgba(167, 139, 250, 0.45)";
      b.lineWidth = 1;
      b.stroke();
      b.fillStyle = "rgba(196, 210, 255, 0.9)";
      b.font = `700 ${Math.round(size * 0.36)}px system-ui, sans-serif`;
      b.textAlign = "center";
      b.textBaseline = "middle";
      b.fillText("AI", x, y + size * 0.02);
    }

    function resize() {
      const rect = parent!.getBoundingClientRect();
      // Hidden by CSS (e.g. the conversation list while a chat is open on a
      // phone): draw nothing and burn nothing until it has a size again.
      if (rect.width < 2 || rect.height < 2) {
        boxless = true;
        stop();
        return;
      }
      const wasBoxless = boxless;
      boxless = false;
      width = Math.max(1, Math.floor(rect.width));
      height = Math.max(1, Math.floor(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      buildTraces();
      drawBase();
      pulses.length = 0; // trace indices changed
      draw();
      if (wasBoxless) wake();
    }

    // ---- geometry helpers ----------------------------------------------

    function pointAt(t: Trace, s: number) {
      const d = Math.max(0, Math.min(t.len, s));
      let k = 1;
      while (k < t.cum.length - 1 && t.cum[k] < d) k++;
      const seg = t.cum[k] - t.cum[k - 1] || 1;
      const f = (d - t.cum[k - 1]) / seg;
      return {
        x: t.pts[k - 1].x + (t.pts[k].x - t.pts[k - 1].x) * f,
        y: t.pts[k - 1].y + (t.pts[k].y - t.pts[k - 1].y) * f,
      };
    }

    // ---- simulation -----------------------------------------------------

    const rnd = Math.random;
    const maxPulses = () => (width < 640 ? 5 : 9);

    function spawnAmbient() {
      if (traces.length === 0 || pulses.length >= maxPulses()) return;
      const trace = Math.floor(rnd() * traces.length);
      const outward = rnd() < 0.5;
      pulses.push({
        trace,
        s: outward ? 0 : traces[trace].len,
        dir: outward ? 1 : -1,
        speed: 130 + rnd() * 140,
        bounces: 0,
        wait: 0,
      });
    }

    function step(dt: number, spawning: boolean) {
      chipGlow = Math.max(0, chipGlow - dt * 1.4);
      for (const t of traces) t.flash = Math.max(0, t.flash - dt * 1.6);

      if (spawning) {
        nextSpawn -= dt;
        if (nextSpawn <= 0) {
          spawnAmbient();
          nextSpawn = 0.3 + rnd() * 0.7;
        }
      }

      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        if (p.wait > 0) {
          p.wait -= dt;
          continue;
        }
        const t = traces[p.trace];
        p.s += p.dir * p.speed * dt;
        if (p.s >= t.len) {
          p.s = t.len;
          t.flash = 1;
          if (p.bounces < MAX_BOUNCES && rnd() < 0.6) {
            p.dir = -1;
            p.bounces++;
          } else pulses.splice(i, 1);
        } else if (p.s <= 0) {
          p.s = 0;
          chipGlow = Math.max(chipGlow, 0.7);
          if (p.bounces < MAX_BOUNCES && rnd() < 0.5) {
            p.dir = 1;
            p.bounces++;
          } else pulses.splice(i, 1);
        }
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      ctx!.drawImage(base, 0, 0, width, height);

      if (chipGlow > 0.02) {
        const g = ctx!.createRadialGradient(chip.x, chip.y, chip.size * 0.2, chip.x, chip.y, chip.size * 1.6);
        g.addColorStop(0, `rgba(139, 130, 255, ${(chipGlow * 0.5).toFixed(3)})`);
        g.addColorStop(1, "rgba(139, 130, 255, 0)");
        ctx!.fillStyle = g;
        ctx!.fillRect(chip.x - chip.size * 2, chip.y - chip.size * 2, chip.size * 4, chip.size * 4);
      }

      for (const t of traces) {
        if (t.flash < 0.03) continue;
        const e = t.pts[t.pts.length - 1];
        ctx!.fillStyle = `rgba(103, 232, 249, ${(t.flash * 0.35).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, 6 + t.flash * 9, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = `rgba(207, 250, 254, ${(0.5 + t.flash * 0.5).toFixed(3)})`;
        ctx!.beginPath();
        ctx!.arc(e.x, e.y, 2.4 + t.flash * 1.4, 0, Math.PI * 2);
        ctx!.fill();
      }

      ctx!.lineCap = "round";
      for (const p of pulses) {
        if (p.wait > 0) continue;
        const t = traces[p.trace];
        const stepPx = TAIL_PX / TAIL_STEPS;
        let prev = pointAt(t, p.s);
        for (let k = 1; k <= TAIL_STEPS; k++) {
          const cur = pointAt(t, p.s - p.dir * k * stepPx);
          const a = (1 - k / (TAIL_STEPS + 1)) * 0.85;
          ctx!.strokeStyle = `rgba(125, 211, 252, ${a.toFixed(3)})`;
          ctx!.lineWidth = 2.4 * (1 - k / (TAIL_STEPS * 1.6));
          ctx!.beginPath();
          ctx!.moveTo(prev.x, prev.y);
          ctx!.lineTo(cur.x, cur.y);
          ctx!.stroke();
          prev = cur;
        }
        const head = pointAt(t, p.s);
        ctx!.fillStyle = "rgba(56, 189, 248, 0.28)";
        ctx!.beginPath();
        ctx!.arc(head.x, head.y, 7, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = "rgba(240, 253, 255, 0.95)";
        ctx!.beginPath();
        ctx!.arc(head.x, head.y, 2.2, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function settled() {
      return pulses.length === 0 && chipGlow < 0.02 && traces.every((t) => t.flash < 0.03);
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      if (now - lastFrame < FRAME_MS) return;
      const dt = Math.min((now - lastFrame) / 1000, 0.1);
      lastFrame = now;

      const idle = now - lastActivity > IDLE_MS;
      step(dt, !idle);
      draw();
      // Idle and nothing left moving: leave the last frame and stop.
      if (idle && settled()) stop();
    }

    function start() {
      if (running || reduceMotion || boxless || document.visibilityState === "hidden") return;
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
      if (reduceMotion || traces.length === 0) return;
      const sent = side === "right";
      const count = width < 640 ? 3 : 5;
      const order = traces.map((_, i) => i).sort(() => rnd() - 0.5);
      for (let i = 0; i < Math.min(count, order.length); i++) {
        const trace = order[i];
        pulses.push({
          trace,
          s: sent ? 0 : traces[trace].len,
          dir: sent ? 1 : -1,
          speed: 300 + rnd() * 120,
          bounces: 1, // at most one turn-round for bursts
          wait: i * 0.09,
        });
      }
      chipGlow = sent ? 1 : chipGlow;
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
