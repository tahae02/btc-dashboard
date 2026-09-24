// Loaded via `node --import` so the resolver hook is active before any
// application module is imported. See ts-resolve.mjs.
import { register } from 'node:module';
register('./ts-resolve.mjs', import.meta.url);
