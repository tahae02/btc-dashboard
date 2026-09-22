/**
 * Resolver hook so the backtest can import the app's source directly.
 *
 * Node's ESM loader requires explicit file extensions, but the app's source
 * uses extensionless imports because that is what Metro and Jest expect.
 * Rather than rewrite every import in src/ (and risk the Expo build for the
 * sake of a dev script), this hook appends `.ts` / `/index.ts` when a relative
 * specifier has no extension. Only the backtest runs with it loaded.
 */
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
  const hasExtension = /\.[a-z0-9]+$/i.test(specifier);

  if (isRelative && !hasExtension && context.parentURL?.startsWith('file:')) {
    const base = resolvePath(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}/index.ts`, `${base}.tsx`]) {
      if (existsSync(candidate)) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
