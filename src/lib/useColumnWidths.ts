import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalize(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  return values.map((value) => (value / total) * 100);
}

function readStored(key: string, fallback: number[]) {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== fallback.length) return fallback;
    const numbers = parsed.map((value) => Number(value));
    if (numbers.some((value) => !Number.isFinite(value) || value <= 0)) return fallback;
    return normalize(numbers);
  } catch {
    return fallback;
  }
}

export function useColumnWidths(storageKey: string, initialWidths: number[]) {
  const fallback = useMemo(() => normalize(initialWidths), [initialWidths]);
  const [widths, setWidths] = useState<number[]>(() => readStored(storageKey, fallback));
  const widthsRef = useRef(widths);

  useEffect(() => {
    widthsRef.current = widths;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // ignore storage failures
    }
  }, [storageKey, widths]);

  const startResize = (index: number) => (event: ReactMouseEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const table = event.currentTarget.closest('table') as HTMLTableElement | null;
    const tableWidth = table?.getBoundingClientRect().width || window.innerWidth;
    const startX = event.clientX;
    const startWidths = [...widthsRef.current];

    const onMove = (moveEvent: MouseEvent) => {
      const deltaPct = ((moveEvent.clientX - startX) / tableWidth) * 100;
      setWidths(() => {
        const next = [...startWidths];
        const min = 5;

        let left = next[index] + deltaPct;
        let right = next[index + 1] - deltaPct;

        if (left < min) {
          const diff = min - left;
          left = min;
          right -= diff;
        }
        if (right < min) {
          const diff = min - right;
          right = min;
          left -= diff;
        }

        next[index] = clamp(left, min, 95);
        next[index + 1] = clamp(right, min, 95);
        return normalize(next);
      });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return {
    widths,
    getWidthStyle: (index: number) => ({ width: `${widths[index]}%` }),
    startResize,
  };
}
