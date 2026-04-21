import React from 'react';

type Props = {
  lookbackDays: string;
  missingMode: 'skip' | 'ffill';
  formula: 'Default' | 'Jdk';
  fixedGraph: boolean;
  latestPointSize: string;
  otherPointSize: string;
  onLookbackDaysChange: (value: string) => void;
  onMissingModeChange: (value: 'skip' | 'ffill') => void;
  onFormulaChange: (value: 'Default' | 'Jdk') => void;
  onFixedGraphChange: (value: boolean) => void;
  onLatestPointSizeChange: (value: string) => void;
  onOtherPointSizeChange: (value: string) => void;
};

const formulaHelp = {
  Default: 'RS = price_asset / price_benchmark\nRS_ratio = 100 * (RS / rolling_mean(RS, 10))\nRS_momentum = 100 * (RS_ratio / rolling_mean(RS_ratio, 10))',
  Jdk: 'RS = price_asset / price_benchmark\nRS_smooth = EMA(RS, 10)\nRS_ratio = 100 * (RS_smooth / EMA(RS_smooth, 10))\nRS_momentum = 100 * EMA(RS_ratio / RS_ratio.shift(5), 10)',
} as const;

export function RrSidePanel({
  lookbackDays,
  missingMode,
  formula,
  fixedGraph,
  latestPointSize,
  otherPointSize,
  onLookbackDaysChange,
  onMissingModeChange,
  onFormulaChange,
  onFixedGraphChange,
  onLatestPointSizeChange,
  onOtherPointSizeChange,
}: Props) {
  return (
    <div className="rr-side-panel-inner">
      <div className="panel-title">RRG Controls</div>

      <section className="rr-section">
        <div className="rr-section-title">Data</div>
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
        </div>
        <div className="set-editor-actions rr-quick-actions">
          {[10, 20, 30].map((days) => (
            <button key={days} className="secondary-button" onClick={() => onLookbackDaysChange(String(days))}>
              {days} days
            </button>
          ))}
        </div>
      </section>

      <section className="rr-section">
        <div className="rr-section-title">Display</div>
        <div className="set-form-grid rr-mini-grid">
          <label>
            Formula
            <select title={formulaHelp[formula]} value={formula} onChange={(e) => onFormulaChange(e.target.value as 'Default' | 'Jdk')}>
              {(['Default', 'Jdk'] as const).map((item) => (
                <option key={item} value={item} title={formulaHelp[item]}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="rr-toggle-row">
            <span>Fixed graph</span>
            <input type="checkbox" checked={fixedGraph} onChange={(e) => onFixedGraphChange(e.target.checked)} />
          </label>
        </div>
      </section>

      <section className="rr-section">
        <div className="rr-section-title">Point size</div>
        <div className="set-form-grid rr-mini-grid rr-slider-grid">
          <label>
            Latest point size
            <input type="range" min="1" max="10" step="1" value={latestPointSize} onChange={(e) => onLatestPointSizeChange(e.target.value)} />
          </label>
          <label>
            Other point size
            <input type="range" min="1" max="10" step="1" value={otherPointSize} onChange={(e) => onOtherPointSizeChange(e.target.value)} />
          </label>
        </div>
      </section>
    </div>
  );
}
