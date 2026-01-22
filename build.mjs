#!/usr/bin/env node
/**
 * Requires: emcc in PATH (run `emsdk_env` first or add to shell profile)
 */
import { execSync } from 'child_process';
import { mkdirSync, existsSync } from 'fs';

const OUT_DIR = 'build';

// Ensure output directory exists
if (!existsSync(OUT_DIR)) {
    mkdirSync(OUT_DIR, { recursive: true });
}

const emccFlags = [
    // Source files
    'libsais/src/libsais.c',
    'wasm/libsais_wasm.c',

    // Include path
    '-I libsais/include',

    // Optimization
    '-O3',
    '-flto',

    // WASM settings
    '-s WASM=1',
    '-s ALLOW_MEMORY_GROWTH=1',
    '-s MODULARIZE=1',
    '-s EXPORT_ES6=1',
    '-s EXPORT_NAME="createLibsaisModule"',
    '-s ENVIRONMENT=web,node',

    // Exported functions
    `-s EXPORTED_RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','HEAPU8','HEAP32']"`,
    `-s EXPORTED_FUNCTIONS="['_malloc','_free','_create_index','_free_index','_get_index_length','_count_matches','_find_all','_alloc_result_buffer','_free_result_buffer']"`,

    // Output
    `-o ${OUT_DIR}/libsais.mjs`,
];

const command = `emcc ${emccFlags.join(' ')}`;

console.log('Building WASM module...\n');

try {
    execSync(command, { stdio: 'inherit' });
    console.log('\n✓ Build complete!');
    console.log(`  - ${OUT_DIR}/libsais.mjs`);
    console.log(`  - ${OUT_DIR}/libsais.wasm`);
} catch (error) {
    console.error('\n✗ Build failed');
    process.exit(1);
}
