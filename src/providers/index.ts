import type { SearchProvider } from '../core/types.js';
import { serperProvider } from './serper.js';
import { exaProvider } from './exa.js';

export const PROVIDERS: SearchProvider[] = [serperProvider, exaProvider];

export function findProvider(id: string): SearchProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
