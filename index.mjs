/**
 * libsais-wasm - Suffix array based fast substring search
 * 
 * Usage:
 *   import { createIndex, indexOfAll, freeIndex } from './index.mjs';
 *   
 *   const handle = await createIndex(buffer);
 *   const positions = indexOfAll(handle, needle);
 *   freeIndex(handle); // When done
 */

import createLibsaisModule from './build/libsais.mjs';

let Module = null;
let initPromise = null;

// Wrapped C functions
let _create_index = null;
let _free_index = null;
let _get_index_length = null;
let _count_matches = null;
let _find_all = null;
let _alloc_result_buffer = null;
let _free_result_buffer = null;

/**
 * Initialize the WASM module (called automatically on first use)
 */
async function init() {
    if (Module) return Module;
    if (initPromise) return initPromise;

    initPromise = createLibsaisModule().then(mod => {
        Module = mod;

        // Wrap C functions
        _create_index = Module.cwrap('create_index', 'number', ['number', 'number']);
        _free_index = Module.cwrap('free_index', null, ['number']);
        _get_index_length = Module.cwrap('get_index_length', 'number', ['number']);
        _count_matches = Module.cwrap('count_matches', 'number', ['number', 'number', 'number']);
        _find_all = Module.cwrap('find_all', 'number',
            ['number', 'number', 'number', 'number', 'number', 'number', 'number', 'number']);
        _alloc_result_buffer = Module.cwrap('alloc_result_buffer', 'number', ['number']);
        _free_result_buffer = Module.cwrap('free_result_buffer', null, ['number']);

        return Module;
    });

    return initPromise;
}

/**
 * Copy a Uint8Array to WASM memory at the given pointer
 */
function copyToWasm(ptr, data) {
    Module.HEAPU8.set(data, ptr);
}

/**
 * @typedef {number} IndexHandle
 */

// Track active index handles for cleanup
const activeHandles = new Map();

/**
 * Creates a suffix array index from the given buffer.
 * The index can be used for fast repeated searches.
 * 
 * @param {Uint8Array} buffer The buffer to index
 * @returns {Promise<IndexHandle>} A handle to the created index
 */
export async function createIndex(buffer) {
    await init();

    if (!(buffer instanceof Uint8Array)) {
        throw new TypeError('buffer must be a Uint8Array');
    }

    if (buffer.length === 0) {
        throw new Error('buffer cannot be empty');
    }

    // Allocate WASM memory and copy buffer
    const bufferPtr = Module._malloc(buffer.length);
    copyToWasm(bufferPtr, buffer);

    // Create the index
    const indexPtr = _create_index(bufferPtr, buffer.length);

    // Free the temporary buffer copy
    Module._free(bufferPtr);

    if (indexPtr === 0) {
        throw new Error('Failed to create index');
    }

    // Track the handle
    activeHandles.set(indexPtr, {
        length: buffer.length,
        createdAt: Date.now()
    });

    return indexPtr;
}

/**
 * Frees an index and its associated memory.
 * 
 * @param {IndexHandle} indexHandle The handle returned by createIndex
 */
export function freeIndex(indexHandle) {
    if (!Module) return;

    if (activeHandles.has(indexHandle)) {
        _free_index(indexHandle);
        activeHandles.delete(indexHandle);
    }
}

/**
 * Gets the length of the indexed buffer.
 * 
 * @param {IndexHandle} indexHandle The handle returned by createIndex
 * @returns {number} The length of the indexed buffer
 */
export function getIndexLength(indexHandle) {
    if (!Module) {
        throw new Error('Module not initialized. Call createIndex first.');
    }
    return _get_index_length(indexHandle);
}

/**
 * Counts occurrences of the search buffer in the indexed data.
 * 
 * @param {IndexHandle} indexHandle The handle returned by createIndex
 * @param {Uint8Array} search The subbuffer to find
 * @returns {number} The count of occurrences
 */
export function countMatches(indexHandle, search) {
    if (!Module) {
        throw new Error('Module not initialized. Call createIndex first.');
    }

    if (!(search instanceof Uint8Array) || search.length === 0) {
        return 0;
    }

    // Copy search buffer to WASM memory
    const searchPtr = Module._malloc(search.length);
    copyToWasm(searchPtr, search);

    const count = _count_matches(indexHandle, searchPtr, search.length);

    Module._free(searchPtr);

    return count;
}

/**
 * Finds all locations of the search buffer (needle) in the indexed buffer.
 * 
 * **Note:** Results are returned in suffix array (lexicographical) order,
 * NOT sorted by position. Use `.sort((a, b) => a - b)` if position order is needed.
 * 
 * @param {IndexHandle} indexHandle The handle returned by createIndex
 * @param {Uint8Array} search The subbuffer to find
 * @param {number} start Start offset in the original buffer (inclusive)
 * @param {number} end End offset in the original buffer (exclusive), needle must fit entirely within range
 * @param {number|null} maxCount Maximum number of results to return (arbitrary subset, not first N by position)
 * @returns {number[]} Array of starting offsets for the needle (unsorted)
 */
export function indexOfAll(indexHandle, search, start = 0, end = null, maxCount = null) {
    if (!Module) {
        throw new Error('Module not initialized. Call createIndex first.');
    }

    if (!(search instanceof Uint8Array) || search.length === 0) {
        return [];
    }

    const indexLength = _get_index_length(indexHandle);

    // Handle default end value
    if (end === null) {
        end = indexLength;
    }

    // Handle default maxCount
    if (maxCount === null) {
        maxCount = indexLength; // Effectively unlimited
    }

    // First, count matches to allocate result buffer
    // Copy search buffer to WASM memory
    const searchPtr = Module._malloc(search.length);
    copyToWasm(searchPtr, search);

    // Count total matches (ignoring range for buffer sizing)
    const totalCount = _count_matches(indexHandle, searchPtr, search.length);

    if (totalCount === 0) {
        Module._free(searchPtr);
        return [];
    }

    // Allocate result buffer (use min of totalCount and maxCount)
    const bufferSize = Math.min(totalCount, maxCount);
    const resultPtr = _alloc_result_buffer(bufferSize);

    if (resultPtr === 0) {
        Module._free(searchPtr);
        throw new Error('Failed to allocate result buffer');
    }

    // Find all matches
    const resultCount = _find_all(
        indexHandle,
        searchPtr, search.length,
        start, end,
        maxCount,
        resultPtr, bufferSize
    );

    // Copy results to JavaScript array using HEAP32
    const results = [];
    const startIdx = resultPtr >> 2; // Divide by 4 to get int32 index
    for (let i = 0; i < resultCount; i++) {
        results.push(Module.HEAP32[startIdx + i]);
    }

    // Cleanup
    _free_result_buffer(resultPtr);
    Module._free(searchPtr);

    return results;
}

export default {
    createIndex,
    freeIndex,
    getIndexLength,
    countMatches,
    indexOfAll
};
