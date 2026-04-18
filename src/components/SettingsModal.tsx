import React, { useState } from 'react';
import { api } from '../lib/api';
import type { AppSettings } from '../lib/types';

type Props = {
  value: AppSettings;
  onClose: () => void;
  onSave: (value: AppSettings) => void;
};

export function SettingsModal({ value, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(value);

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Settings</h2>
        <label>
          Theme
          <select value={draft.theme} onChange={(e) => setDraft({ ...draft, theme: e.target.value as AppSettings['theme'] })}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        <label>
          Output mode
          <select value={draft.outputMode} onChange={(e) => setDraft({ ...draft, outputMode: e.target.value as AppSettings['outputMode'] })}>
            <option value="browser">Browser download only</option>
            <option value="folder">Save to folder only</option>
            <option value="both">Both</option>
          </select>
        </label>
        {draft.outputMode !== 'browser' ? (
          <label>
            Save folder
            <div className="folder-row">
              <input value={draft.saveFolder} onChange={(e) => setDraft({ ...draft, saveFolder: e.target.value })} placeholder="/home/user/Downloads" />
              <button
                onClick={async () => {
                  const path = await api.pickFolder();
                  if (path) setDraft({ ...draft, saveFolder: path });
                }}
              >
                Browse
              </button>
            </div>
          </label>
        ) : null}
        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={() => onSave(draft)}>Save</button>
        </div>
      </div>
    </div>
  );
}
