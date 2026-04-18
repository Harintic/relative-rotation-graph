import React from 'react';

type Props = {
  lookbackDays: string;
  missingMode: 'skip' | 'ffill';
  fixedGraph: boolean;
  latestPointSize: string;
  otherPointSize: string;
  onLookbackDaysChange: (value: string) => void;
  onMissingModeChange: (value: 'skip' | 'ffill') => void;
  onFixedGraphChange: (value: boolean) => void;
  onLatestPointSizeChange: (value: string) => void;
  onOtherPointSizeChange: (value: string) => void;
};

export function RrSidePanel({
  lookbackDays,
  missingMode,
  fixedGraph,
  latestPointSize,
  otherPointSize,
  onLookbackDaysChange,
  onMissingModeChange,
  onFixedGraphChange,
  onLatestPointSizeChange,
  onOtherPointSizeChange,
}: Props) {
  return (
    <div className="rr-side-panel-inner">
      <div className="panel-title">RRG Controls</div>

      <div className="set-form-grid rr-mini-grid">
        <label>
          Duration (trading days)
          <input type="number" min="1" step="1" value={lookbackDays} onChange={(e) => onLookbackDaysChange(e.target.value)} />
        </label>
        <label>
          Missing dates
          <select value={missingMode} onChange={(e) => onMissingModeChange(e.target.value as 'skip' | 'ffill')}>
            <option value="skip">Skip missing points</option>
            <option value="ffill">Forward-fill last value</option>
          </select>
        </label>
        <label className="rr-toggle-row">
          <span>Fixed graph</span>
          <input type="checkbox" checked={fixedGraph} onChange={(e) => onFixedGraphChange(e.target.checked)} />
        </label>
      </div>

      <div className="set-editor-actions">
        {[10, 20, 30].map((days) => (
          <button key={days} className="secondary-button" onClick={() => onLookbackDaysChange(String(days))}>
            {days} days
          </button>
        ))}
      </div>

      <div className="set-form-grid rr-mini-grid">
        <label>
          Latest point size
          <input type="range" min="1" max="10" step="1" value={latestPointSize} onChange={(e) => onLatestPointSizeChange(e.target.value)} />
        </label>
        <label>
          Other point size
          <input type="range" min="1" max="10" step="1" value={otherPointSize} onChange={(e) => onOtherPointSizeChange(e.target.value)} />
        </label>
      </div>
    </div>
  );
}
