/// <reference types="vite/client" />

declare module '*.css';

interface ImportMetaEnv {
  /**
   * When 'true', the frontend uses the local mock data source
   * (src/data/mock-data.ts) instead of calling the real backend API.
   */
  readonly VITE_USE_MOCK: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
