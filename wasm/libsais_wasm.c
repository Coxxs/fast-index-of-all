#include <stdlib.h>
#include <string.h>
#include <emscripten.h>
#include "libsais.h"

// Index structure that holds the original data and suffix array
typedef struct {
    uint8_t* data;      // Original buffer data
    int32_t* sa;        // Suffix array
    int32_t  length;    // Length of the buffer
} SaisIndex;

// Create an index (suffix array) from the input buffer
EMSCRIPTEN_KEEPALIVE
SaisIndex* create_index(const uint8_t* buffer, int32_t length) {
    if (length <= 0) return NULL;
    
    SaisIndex* index = (SaisIndex*)malloc(sizeof(SaisIndex));
    if (!index) return NULL;
    
    // Allocate and copy the data
    index->data = (uint8_t*)malloc(length);
    if (!index->data) {
        free(index);
        return NULL;
    }
    memcpy(index->data, buffer, length);
    index->length = length;
    
    // Allocate suffix array
    index->sa = (int32_t*)malloc(length * sizeof(int32_t));
    if (!index->sa) {
        free(index->data);
        free(index);
        return NULL;
    }
    
    // Build suffix array using libsais (single-threaded)
    int32_t result = libsais(index->data, index->sa, length, 0, NULL);
    if (result != 0) {
        free(index->sa);
        free(index->data);
        free(index);
        return NULL;
    }
    
    return index;
}

// Free the index
EMSCRIPTEN_KEEPALIVE
void free_index(SaisIndex* index) {
    if (index) {
        if (index->data) free(index->data);
        if (index->sa) free(index->sa);
        free(index);
    }
}

// Get the length of the indexed data
EMSCRIPTEN_KEEPALIVE
int32_t get_index_length(const SaisIndex* index) {
    return index ? index->length : 0;
}

// Compare needle with suffix at position pos
static int compare_suffix(const SaisIndex* index, int32_t pos, 
                          const uint8_t* needle, int32_t needle_len) {
    int32_t remaining = index->length - pos;
    int32_t compare_len = needle_len < remaining ? needle_len : remaining;
    
    int cmp = memcmp(index->data + pos, needle, compare_len);
    if (cmp != 0) return cmp;
    
    // If prefix matches but suffix is shorter, suffix is "less than"
    if (remaining < needle_len) return -1;
    return 0;
}

// Find lower bound (first suffix >= needle)
static int32_t lower_bound(const SaisIndex* index, 
                           const uint8_t* needle, int32_t needle_len) {
    int32_t lo = 0, hi = index->length;
    
    while (lo < hi) {
        int32_t mid = lo + (hi - lo) / 2;
        int32_t suffix_pos = index->sa[mid];
        
        if (compare_suffix(index, suffix_pos, needle, needle_len) < 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

// Find upper bound (first suffix > needle)
static int32_t upper_bound(const SaisIndex* index, 
                           const uint8_t* needle, int32_t needle_len) {
    int32_t lo = 0, hi = index->length;
    
    while (lo < hi) {
        int32_t mid = lo + (hi - lo) / 2;
        int32_t suffix_pos = index->sa[mid];
        
        if (compare_suffix(index, suffix_pos, needle, needle_len) <= 0) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

// Count occurrences of needle in the indexed data
EMSCRIPTEN_KEEPALIVE
int32_t count_matches(const SaisIndex* index, 
                      const uint8_t* needle, int32_t needle_len) {
    if (!index || !needle || needle_len <= 0) return 0;
    
    int32_t lo = lower_bound(index, needle, needle_len);
    int32_t hi = upper_bound(index, needle, needle_len);
    
    return hi - lo;
}

// Allocate result buffer for find_all
EMSCRIPTEN_KEEPALIVE
int32_t* alloc_result_buffer(int32_t count) {
    if (count <= 0) return NULL;
    return (int32_t*)malloc(count * sizeof(int32_t));
}

// Free result buffer
EMSCRIPTEN_KEEPALIVE
void free_result_buffer(int32_t* buffer) {
    if (buffer) free(buffer);
}

// Find all occurrences of needle in the indexed data
// Returns the number of results written to result_buffer
// Filters by [start, end) range and respects maxCount
EMSCRIPTEN_KEEPALIVE
int32_t find_all(const SaisIndex* index, 
                 const uint8_t* needle, int32_t needle_len,
                 int32_t start, int32_t end,
                 int32_t max_count,
                 int32_t* result_buffer, int32_t buffer_capacity) {
    if (!index || !needle || needle_len <= 0 || !result_buffer || buffer_capacity <= 0) {
        return 0;
    }
    
    // Validate range
    if (end < 0 || end > index->length) end = index->length;
    if (start < 0) start = 0;
    if (start >= end) return 0;
    
    // Find the range of matching suffixes
    int32_t lo = lower_bound(index, needle, needle_len);
    int32_t hi = upper_bound(index, needle, needle_len);
    
    int32_t count = 0;
    int32_t limit = (max_count > 0 && max_count < buffer_capacity) ? max_count : buffer_capacity;
    
    // Collect positions where the entire needle fits within [start, end) range
    // This matches the behavior of: buffer.subarray(start, end).indexOf(needle)
    for (int32_t i = lo; i < hi && count < limit; i++) {
        int32_t pos = index->sa[i];
        if (pos >= start && pos + needle_len <= end) {
            result_buffer[count++] = pos;
        }
    }
    
    return count;
}
