// Builds the Electron main/preload bundles (esbuild) and the renderer (vite) into dist/.
import { build } from 'esbuild';
import { build as viteBuild } from 'vite';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist/main'), { recursive: true });

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: false, external: ['electron'], logLevel: 'info' };
await build({ ...common, entryPoints: [join(root, 'src/main/main.ts')], outfile: join(root, 'dist/main/main.cjs') });
await build({ ...common, entryPoints: [join(root, 'src/preload/preload.ts')], outfile: join(root, 'dist/preload/preload.cjs') });

// sql.js WebAssembly binary next to the main bundle
copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), join(root, 'dist/main/sql-wasm.wasm'));

await viteBuild({ configFile: join(root, 'vite.config.ts'), mode: 'production' });
console.log('build complete');
