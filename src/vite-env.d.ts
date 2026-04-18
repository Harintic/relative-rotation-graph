/// <reference types="vite/client" />

interface Window {
  __TAURI__?: {
    dialog?: {
      open: (options: unknown) => Promise<string | string[] | null>;
    };
  };
}
