import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RrResponse } from '../lib/types';

type Props = {
  value: RrResponse | null;
  allSeriesIds?: string[];
  legendAssets?: Array<{
    id: string;
    label: string;
    visible: boolean;
    latest: { date: string; x: number; y: number } | null;
  }>;
  activeAssetId?: string;
  highlightedAssetId?: string;
  onAssetHover?: (assetId: string) => void;
  onAssetHoverEnd?: () => void;
  onAssetToggle?: (assetId: string) => void;
  onAssetClick?: (assetId: string) => void;
  onSelectAll?: () => void;
  onHideAll?: () => void;
  fixedGraph?: boolean;
  fixedBounds?: { minX: number; maxX: number; minY: number; maxY: number } | null;
  onViewBoundsChange?: (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => void;
  latestPointSize?: number;
  otherPointSize?: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function colorFromIndex(index: number) {
  const hue = (index * 137.508) % 360;
  const saturation = 68 + ((index * 17) % 12);
  const lightness = 44 + ((index * 29) % 14);
  return `hsl(${hue.toFixed(1)} ${saturation}% ${lightness}%)`;
}

function buildColorMap(ids: string[]) {
  const sorted = [...new Set(ids)].sort((left, right) => left.localeCompare(right));
  const map = new Map<string, string>();
  const used = new Set<string>();

  sorted.forEach((assetId, index) => {
    let attempt = 0;
    let color = '';
    do {
      color = colorFromIndex(index + attempt * sorted.length);
      attempt += 1;
    } while (used.has(color) && attempt < 128);
    used.add(color);
    map.set(assetId, color);
  });

  return map;
}

function fallbackColor(assetId: string) {
  let hash = 0;
  for (let index = 0; index < assetId.length; index += 1) {
    hash = (hash * 33 + assetId.charCodeAt(index)) >>> 0;
  }
  return colorFromIndex(hash % 512);
}

export function RrgChart({
  value,
  allSeriesIds = [],
  legendAssets = [],
  activeAssetId = '',
  highlightedAssetId = '',
  onAssetHover,
  onAssetHoverEnd,
  onAssetToggle,
  onAssetClick,
  onSelectAll,
  onHideAll,
  fixedGraph = false,
  fixedBounds = null,
  onViewBoundsChange,
  latestPointSize = 6,
  otherPointSize = 3,
}: Props) {
  const points = value?.series ?? [];
  const [zoom, setZoom] = useState(1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [pointTooltip, setPointTooltip] = useState<{
    x: number;
    y: number;
    name: string;
    date: string;
    time: string;
    xValue: string;
    yValue: string;
  } | null>(null);
  const [hoveredPointId, setHoveredPointId] = useState('');
  const activeLegendAsset = legendAssets.find((asset) => asset.id === activeAssetId) ?? null;
  const activeSeries = points.find((series) => series.asset_id === activeAssetId) ?? null;
  const isHighlighted = Boolean(highlightedAssetId && activeAssetId === highlightedAssetId);
  const colorMap = useMemo(() => {
    const map = buildColorMap(allSeriesIds.length ? allSeriesIds : points.map((series) => series.asset_id));
    points.forEach((series) => {
      if (!map.has(series.asset_id)) {
        map.set(series.asset_id, fallbackColor(series.asset_id));
      }
    });
    return map;
  }, [allSeriesIds, points]);

  const dataBounds = useMemo(() => {
    const allPoints = points.flatMap((series) => series.tail);
    const xs = allPoints.map((point) => point.x);
    const ys = allPoints.map((point) => point.y);
    const minX = Math.min(100, ...(xs.length ? xs : [95])) - 5;
    const maxX = Math.max(100, ...(xs.length ? xs : [105])) + 5;
    const minY = Math.min(100, ...(ys.length ? ys : [95])) - 5;
    const maxY = Math.max(100, ...(ys.length ? ys : [105])) + 5;
    return { minX, maxX, minY, maxY };
  }, [points]);

  const bounds = fixedGraph && fixedBounds ? fixedBounds : dataBounds;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const spanX = Math.max((bounds.maxX - bounds.minX) / zoom, 1);
  const spanY = Math.max((bounds.maxY - bounds.minY) / zoom, 1);
  const viewBounds = {
    minX: centerX - spanX / 2,
    maxX: centerX + spanX / 2,
    minY: centerY - spanY / 2,
    maxY: centerY + spanY / 2,
  };

  useEffect(() => {
    onViewBoundsChange?.(viewBounds);
  }, [onViewBoundsChange, viewBounds.minX, viewBounds.maxX, viewBounds.minY, viewBounds.maxY]);

  useEffect(() => {
    setZoom(1);
  }, [value?.benchmark_asset_id, value?.lookback_days, value?.missing_mode]);

  function mapX(x: number) {
    const width = 1000;
    const padding = 70;
    const plotWidth = width - padding * 2;
    return padding + ((x - viewBounds.minX) / Math.max(viewBounds.maxX - viewBounds.minX, 1)) * plotWidth;
  }

  function mapY(y: number) {
    const height = 700;
    const padding = 70;
    const plotHeight = height - padding * 2;
    return height - padding - ((y - viewBounds.minY) / Math.max(viewBounds.maxY - viewBounds.minY, 1)) * plotHeight;
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setZoom((current) => clamp(current + direction * 0.2, 1, 8));
  }

  function showTooltip(
    event: React.MouseEvent<SVGCircleElement>,
    series: { asset_id: string; symbol: string },
    point: { date: string; x: number; y: number },
  ) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = event.clientX - rect.left;
    const top = event.clientY - rect.top;
    const [date, time = ''] = point.date.includes('T') ? point.date.split('T') : [point.date, ''];
    setPointTooltip({
      x: left,
      y: top,
      name: series.symbol || '-',
      date: date.slice(0, 10),
      time: time.replace('Z', '').slice(0, 8),
      xValue: point.x.toFixed(2),
      yValue: point.y.toFixed(2),
    });
  }

  function weekdayLabel(date: string) {
    const normalized = date.includes('T') ? date : `${date}T00:00:00`;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('en-US', { weekday: 'long' });
  }

  if (!value) {
    return <div className="empty-state">Create a chart to see the RRG plot.</div>;
  }

  return (
    <div className="rrg-chart-wrap" ref={wrapRef}>
      <svg viewBox="0 0 1000 700" className="rrg-chart" role="img" aria-label="Relative rotation graph" onWheel={handleWheel}>
        <rect x="0" y="0" width="1000" height="700" rx="16" className="rrg-bg" />
        <defs>
          <clipPath id={clipId}>
            <rect x="70" y="70" width="860" height="560" rx="10" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <line x1={mapX(100)} y1={70} x2={mapX(100)} y2={630} className="rrg-axis" />
          <line x1={70} y1={mapY(100)} x2={930} y2={mapY(100)} className="rrg-axis" />

          {[0, 25, 50, 75, 100].map((tick) => (
            <React.Fragment key={tick}>
              <line x1={70} y1={mapY(viewBounds.minY + ((viewBounds.maxY - viewBounds.minY) * tick) / 100)} x2={930} y2={mapY(viewBounds.minY + ((viewBounds.maxY - viewBounds.minY) * tick) / 100)} className="rrg-grid" />
            </React.Fragment>
          ))}

          {points.length ? (
            points.map((series) => {
              const color = colorMap.get(series.asset_id) || fallbackColor(series.asset_id);
              const tailPath = series.tail.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(' ');
              const active = activeAssetId === series.asset_id;
              return (
                <g
                  key={series.asset_id}
                  className={active ? 'rrg-series active' : 'rrg-series'}
                  onMouseEnter={() => onAssetHover?.(series.asset_id)}
                  onMouseLeave={() => onAssetHoverEnd?.()}
                  onClick={() => onAssetClick?.(series.asset_id)}
                >
                  {tailPath && active ? <polyline points={tailPath} className="rrg-tail-outline" stroke={color} /> : null}
                  {tailPath ? <polyline points={tailPath} className="rrg-tail" stroke={color} /> : null}
                  {series.tail.map((point, index) => {
                    const pointId = `${series.asset_id}-${index}`;
                    const isHoveredPoint = hoveredPointId === pointId;
                    const isLatest = index === series.tail.length - 1;
                    const radius = isHoveredPoint || isLatest ? latestPointSize : otherPointSize;
                    return (
                      <circle
                        key={pointId}
                        cx={mapX(point.x)}
                        cy={mapY(point.y)}
                        r={radius}
                        fill={color}
                        opacity={isLatest ? 1 : 0.45}
                        onMouseEnter={(event) => {
                          setHoveredPointId(pointId);
                          showTooltip(event, series, point);
                        }}
                        onMouseMove={(event) => {
                          setHoveredPointId(pointId);
                          showTooltip(event, series, point);
                        }}
                        onMouseLeave={() => {
                          setHoveredPointId('');
                          setPointTooltip(null);
                        }}
                      >
                      </circle>
                    );
                  })}
                </g>
              );
            })
          ) : (
            <text x={500} y={350} textAnchor="middle" className="rrg-caption">
              No plotted assets selected
            </text>
          )}
        </g>

        <text x={72} y={62} className="rrg-caption">Weakening</text>
        <text x={846} y={62} className="rrg-caption">Leading</text>
        <text x={72} y={662} className="rrg-caption">Lagging</text>
        <text x={840} y={662} className="rrg-caption">Improving</text>
      </svg>
      {pointTooltip ? (
        <div
          className="rrg-point-tooltip"
          style={{
            left: Math.min(pointTooltip.x + 12, 920),
            top: Math.min(pointTooltip.y + 18, 620),
          }}
        >
          <div>{pointTooltip.name}</div>
          <div>Date: {pointTooltip.date || '-'}</div>
          <div>Time: {pointTooltip.time || '-'}</div>
          <div>X: {pointTooltip.xValue}</div>
          <div>Y: {pointTooltip.yValue}</div>
        </div>
      ) : null}
      <div className="rrg-legend">
        <div className="rrg-legend-meta">
          <span>Benchmark: {value.benchmark_label}</span>
          <span>Zoom: {zoom.toFixed(1)}x</span>
        </div>
        <div className="rrg-legend-list">
          {legendAssets.map((asset) => {
            const color = colorMap.get(asset.id) || fallbackColor(asset.id);
            const swatch = asset.visible ? color : `color-mix(in srgb, ${color} 22%, white)`;
            const active = activeAssetId === asset.id;
            return (
              <button
                key={asset.id}
                type="button"
                className={`rrg-legend-item ${asset.visible ? 'visible' : 'hidden'} ${active ? 'active' : ''}`}
                onClick={() => onAssetToggle?.(asset.id)}
                onMouseEnter={() => onAssetHover?.(asset.id)}
                onMouseLeave={() => onAssetHoverEnd?.()}
              >
                <span className="rrg-legend-swatch" style={{ backgroundColor: swatch }} />
                <span className="rrg-legend-name">{asset.label}</span>
              </button>
            );
          })}
        </div>
        <div className="rrg-legend-actions">
          <button type="button" className="secondary-button rr-legend-action" onClick={() => onSelectAll?.()}>
            Select all
          </button>
          <button type="button" className="secondary-button rr-legend-action" onClick={() => onHideAll?.()}>
            Hide all
          </button>
        </div>
        <div className="rrg-legend-card">
          <div className="rrg-legend-card-title">
            {activeLegendAsset?.label || 'Hover an asset'}
            {isHighlighted ? ' - Highlighted' : ''}
          </div>
          <div className="rrg-point-strip">
            {activeSeries?.tail.length ? (
              activeSeries.tail.map((point) => {
                const [date, time = ''] = point.date.includes('T') ? point.date.split('T') : [point.date, ''];
                return (
                  <div key={`${activeSeries.asset_id}-${point.date}-${point.x}-${point.y}`} className="rrg-point-card">
                    <div>Date: {date.slice(0, 10)}</div>
                    <div>Weekday: {weekdayLabel(point.date)}</div>
                    <div>Time: {time.replace('Z', '').slice(0, 8) || '-'}</div>
                    <div>X: {point.x.toFixed(2)}</div>
                    <div>Y: {point.y.toFixed(2)}</div>
                  </div>
                );
              })
            ) : (
              <div className="rrg-point-card rrg-point-card-empty">
                <div>Date: -</div>
                <div>Weekday: -</div>
                <div>Time: -</div>
                <div>X: -</div>
                <div>Y: -</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
