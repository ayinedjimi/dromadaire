//go:build (windows || darwin) && amd64

package store

/*
#cgo CFLAGS: -O3
extern float simd_dot_f32(const float* a, const float* b, int n);
extern void  simd_normalize_f32(float* v, int n);
extern void  simd_batch_dot_f32(const float* query, const float* flat, int n, int dim, float* scores);
*/
import "C"
import "unsafe"

const hasSIMD = true

// simdDotProduct computes the dot product of two float32 vectors using AVX2 FMA.
func simdDotProduct(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	return float32(C.simd_dot_f32(
		(*C.float)(unsafe.Pointer(&a[0])),
		(*C.float)(unsafe.Pointer(&b[0])),
		C.int(len(a)),
	))
}

// simdNormalize normalizes a vector to unit L2 length using AVX2.
func simdNormalize(v []float32) {
	if len(v) == 0 {
		return
	}
	C.simd_normalize_f32(
		(*C.float)(unsafe.Pointer(&v[0])),
		C.int(len(v)),
	)
}

// simdBatchDot computes dot products of query against all entries in a flat array.
// Single CGo call amortizes the ~200ns per-call overhead across all N entries.
func simdBatchDot(query []float32, flat []float32, nEntries, dim int, scores []float32) {
	if nEntries == 0 || dim == 0 || len(scores) < nEntries {
		return
	}
	C.simd_batch_dot_f32(
		(*C.float)(unsafe.Pointer(&query[0])),
		(*C.float)(unsafe.Pointer(&flat[0])),
		C.int(nEntries),
		C.int(dim),
		(*C.float)(unsafe.Pointer(&scores[0])),
	)
}
