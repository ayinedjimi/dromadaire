//go:build (windows || darwin) && !amd64

package store

const hasSIMD = false

// simdDotProduct falls back to pure Go dotProduct on non-amd64 platforms.
func simdDotProduct(a, b []float32) float32 {
	return dotProduct(a, b)
}

// simdNormalize falls back to pure Go normalizeVector on non-amd64 platforms.
func simdNormalize(v []float32) {
	normalizeVector(v)
}

// simdBatchDot falls back to per-entry Go dotProduct on non-amd64 platforms.
func simdBatchDot(query []float32, flat []float32, nEntries, dim int, scores []float32) {
	for i := 0; i < nEntries; i++ {
		offset := i * dim
		if offset+dim <= len(flat) {
			scores[i] = dotProduct(query, flat[offset:offset+dim])
		}
	}
}
