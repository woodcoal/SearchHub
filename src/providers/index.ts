import type { SearchProvider } from '../core/types.js';
import { serperProvider } from './serper.js';
import { exaProvider } from './exa.js';
import { tavilyProvider } from './tavily.js';
import { anysearchProvider } from './anysearch.js';

export const PROVIDERS: SearchProvider[] = [
  serperProvider,
  tavilyProvider,
  exaProvider,
  anysearchProvider,
];

export function findProvider(id: string): SearchProvider | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
