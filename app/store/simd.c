// simd.c — AVX2 SIMD operations for RAG vector search (Dromadaire v2)
//
// Uses __attribute__((target("avx2,fma"))) instead of compiler-wide -mavx2
// to comply with CGo's CFLAGS security restrictions.
//
// Dual accumulator FMA pipeline: 2 independent dependency chains
// keep the FMA unit fed on Skylake (i5-9500T: 1 FMA unit, 5-cycle latency).
//
// 384-dim embeddings: 24 iterations of 16 floats = exactly 384 (no remainder).

#include <immintrin.h>
#include <math.h>

// Dot product of two float32 vectors using AVX2 FMA.
// Uses dual accumulators (sum0/sum1) to hide FMA latency via ILP.
__attribute__((target("avx2,fma")))
float simd_dot_f32(const float* a, const float* b, int n) {
    __m256 sum0 = _mm256_setzero_ps();
    __m256 sum1 = _mm256_setzero_ps();
    int i = 0;

    // Process 16 floats per iteration (2x8 with dual accumulators)
    for (; i + 15 < n; i += 16) {
        sum0 = _mm256_fmadd_ps(_mm256_loadu_ps(a + i),     _mm256_loadu_ps(b + i),     sum0);
        sum1 = _mm256_fmadd_ps(_mm256_loadu_ps(a + i + 8), _mm256_loadu_ps(b + i + 8), sum1);
    }
    sum0 = _mm256_add_ps(sum0, sum1);

    // Remaining 8-element chunk (if n not multiple of 16)
    for (; i + 7 < n; i += 8) {
        sum0 = _mm256_fmadd_ps(_mm256_loadu_ps(a + i), _mm256_loadu_ps(b + i), sum0);
    }

    // Horizontal sum: 8 floats -> 1 float
    __m128 hi = _mm256_extractf128_ps(sum0, 1);
    __m128 lo = _mm256_castps256_ps128(sum0);
    __m128 s = _mm_add_ps(lo, hi);
    s = _mm_hadd_ps(s, s);
    s = _mm_hadd_ps(s, s);
    float result = _mm_cvtss_f32(s);

    // Scalar remainder (n not multiple of 8)
    for (; i < n; i++) {
        result += a[i] * b[i];
    }
    return result;
}

// Normalize vector to unit L2 length in-place using AVX2.
__attribute__((target("avx2,fma")))
void simd_normalize_f32(float* v, int n) {
    // Phase 1: compute squared L2 norm
    __m256 sum = _mm256_setzero_ps();
    int i = 0;
    for (; i + 7 < n; i += 8) {
        __m256 val = _mm256_loadu_ps(v + i);
        sum = _mm256_fmadd_ps(val, val, sum);
    }

    // Horizontal sum
    __m128 hi = _mm256_extractf128_ps(sum, 1);
    __m128 lo = _mm256_castps256_ps128(sum);
    __m128 s = _mm_add_ps(lo, hi);
    s = _mm_hadd_ps(s, s);
    s = _mm_hadd_ps(s, s);
    float norm = _mm_cvtss_f32(s);

    // Scalar remainder for norm
    for (; i < n; i++) {
        norm += v[i] * v[i];
    }

    // BUG-5 guard: avoid Inf from denormalized floats
    if (norm < 1e-30f) return;

    // Phase 2: multiply all elements by 1/sqrt(norm)
    float inv = 1.0f / sqrtf(norm);
    __m256 vinv = _mm256_set1_ps(inv);
    i = 0;
    for (; i + 7 < n; i += 8) {
        __m256 val = _mm256_loadu_ps(v + i);
        _mm256_storeu_ps(v + i, _mm256_mul_ps(val, vinv));
    }
    for (; i < n; i++) {
        v[i] *= inv;
    }
}

// Batch dot products: compute query . flat[i*dim .. (i+1)*dim-1] for each i.
// Single C call amortizes CGo overhead (~200ns) across all N entries.
__attribute__((target("avx2,fma")))
void simd_batch_dot_f32(const float* query, const float* flat, int n, int dim, float* scores) {
    for (int i = 0; i < n; i++) {
        scores[i] = simd_dot_f32(query, flat + i * dim, dim);
    }
}
