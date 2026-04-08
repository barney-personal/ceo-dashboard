"use client";

import { useRef, useEffect, useCallback } from "react";

interface Curve {
  color: string;
  amplitude: number;
  frequency: number;
  speed: number;
  yOffset: number;
  opacity: number;
  lineWidth: number;
}

const CURVES: Curve[] = [
  { color: "#3b3bba", amplitude: 40, frequency: 0.003, speed: 0.0008, yOffset: 0.35, opacity: 0.08, lineWidth: 2 },
  { color: "#2d8a6e", amplitude: 55, frequency: 0.0025, speed: 0.0006, yOffset: 0.45, opacity: 0.06, lineWidth: 1.5 },
  { color: "#3b3bba", amplitude: 30, frequency: 0.004, speed: 0.001, yOffset: 0.55, opacity: 0.05, lineWidth: 1.5 },
  { color: "#c44", amplitude: 45, frequency: 0.002, speed: 0.0007, yOffset: 0.65, opacity: 0.04, lineWidth: 1 },
  { color: "#3b3bba", amplitude: 25, frequency: 0.0035, speed: 0.0012, yOffset: 0.5, opacity: 0.03, lineWidth: 1 },
  { color: "#2d8a6e", amplitude: 60, frequency: 0.0015, speed: 0.0005, yOffset: 0.4, opacity: 0.04, lineWidth: 2 },
];

export function PulseCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const visibleRef = useRef(true);

  const draw = useCallback((timestamp: number) => {
    if (!visibleRef.current) {
      frameRef.current = requestAnimationFrame(draw);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    ctx.clearRect(0, 0, w, h);

    for (const curve of CURVES) {
      ctx.beginPath();
      ctx.strokeStyle = curve.color;
      ctx.lineWidth = curve.lineWidth;
      ctx.globalAlpha = curve.opacity;

      const baseY = h * curve.yOffset;
      const timeShift = elapsed * curve.speed;

      for (let x = -20; x <= w + 20; x += 2) {
        const y =
          baseY +
          Math.sin(x * curve.frequency + timeShift) * curve.amplitude +
          Math.sin(x * curve.frequency * 2.3 + timeShift * 1.4) * (curve.amplitude * 0.3) +
          Math.sin(x * curve.frequency * 0.7 + timeShift * 0.6) * (curve.amplitude * 0.5);

        if (x === -20) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
    }

    // Floating data dots
    ctx.globalAlpha = 1;
    const dotCount = 12;
    for (let i = 0; i < dotCount; i++) {
      const phase = (elapsed * 0.0003 + i * 1.7) % (Math.PI * 2);
      const x = (Math.sin(phase * 0.7 + i * 2.1) * 0.5 + 0.5) * w;
      const baseYDot = (Math.cos(phase * 0.5 + i * 1.3) * 0.5 + 0.5) * h;
      const drift = Math.sin(elapsed * 0.001 + i) * 20;

      const dotOpacity = (Math.sin(phase) * 0.5 + 0.5) * 0.12;
      const radius = 1.5 + Math.sin(phase + i) * 0.8;

      ctx.beginPath();
      ctx.arc(x, baseYDot + drift, radius, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? "#3b3bba" : i % 3 === 1 ? "#2d8a6e" : "#888";
      ctx.globalAlpha = dotOpacity;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    frameRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    frameRef.current = requestAnimationFrame(draw);

    // Pause when scrolled out of view
    const el = containerRef.current;
    if (!el) return () => cancelAnimationFrame(frameRef.current);

    const observer = new IntersectionObserver(
      ([entry]) => { visibleRef.current = entry.isIntersecting; },
      { threshold: 0 }
    );
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frameRef.current);
      observer.disconnect();
    };
  }, [draw]);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        style={{ pointerEvents: "none" }}
      />
    </div>
  );
}
