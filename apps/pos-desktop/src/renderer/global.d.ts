import type { PosBridge } from '../shared/bridge';

declare global {
  interface Window { pos?: PosBridge }
  const __WEB_DEMO__: boolean;
}
export {};
