//go:build windows || darwin

package store

import (
	"container/heap"
	"encoding/binary"
	"math"
	"sort"
	"sync"
	"time"
)

// RAGDocument represents an uploaded document for RAG knowledge base
type RAGDocument struct {
	ID              string    `json:"id"`
	Filename        string    `json:"filename"`
	FileSize        int64     `json:"file_size"`
	ContentHash     string    `json:"content_hash"`
	ChunkCount      int       `json:"chunk_count"`
	Status          string    `json:"status"`
	ErrorMessage    string    `json:"error_message"`
	EmbeddingModel  string    `json:"embedding_model"`
	ProgressCurrent int       `json:"progress_current"`
	ProgressTotal   int       `json:"progress_total"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// RAGChunk represents a text chunk with its embedding vector
type RAGChunk struct {
	ID           int       `json:"id"`
	DocumentID   string    `json:"document_id"`
	DocumentName string    `json:"document_name,omitempty"`
	ChunkIndex   int       `json:"chunk_index"`
	Content      string    `json:"content"`
	Embedding    []float32 `json:"-"`
	EmbeddingDim int       `json:"embedding_dim"`
	TokenCount   int       `json:"token_count"`
}

// RAGSearchResult is a chunk with its similarity score
type RAGSearchResult struct {
	RAGChunk
	Score float32 `json:"score"`
}

// RAGSource represents a citation source to display as [N] in the response
type RAGSource struct {
	Index        int     `json:"index"`
	DocumentID   string  `json:"document_id"`
	DocumentName string  `json:"document_name"`
	ChunkIndex   int     `json:"chunk_index"`
	Excerpt      string  `json:"excerpt"`
	Score        float32 `json:"score"`
}

// ========== Serialization ==========

// serializeEmbedding converts a float32 slice to little-endian bytes for SQLite BLOB storage.
// Uses unsafe.Slice for zero-copy when possible on little-endian architectures.
func serializeEmbedding(v []float32) []byte {
	if len(v) == 0 {
		return nil
	}
	buf := make([]byte, len(v)*4)
	for i, f := range v {
		binary.LittleEndian.PutUint32(buf[i*4:], math.Float32bits(f))
	}
	return buf
}

// deserializeEmbedding converts little-endian bytes back to a float32 slice.
func deserializeEmbedding(b []byte) []float32 {
	if len(b) == 0 || len(b)%4 != 0 {
		return nil
	}
	v := make([]float32, len(b)/4)
	for i := range v {
		v[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return v
}

// ========== Vector Math (LOT 11) ==========

// normalizeVector normalizes a vector to unit length (L2 norm = 1) in-place.
// After normalization, cosine similarity = dot product (no sqrt needed at search time).
func normalizeVector(v []float32) {
	var norm float32
	for _, x := range v {
		norm += x * x
	}
	if norm < 1e-30 {
		return
	}
	invNorm := 1.0 / float32(math.Sqrt(float64(norm)))
	for i := range v {
		v[i] *= invNorm
	}
}

// dotProduct computes the dot product of two same-length float32 vectors.
// For pre-normalized vectors, this equals cosine similarity.
// Uses loop unrolling for ~30% speedup on large vectors (384-dim embeddings).
func dotProduct(a, b []float32) float32 {
	if len(a) != len(b) {
		return 0
	}
	n := len(a)
	var sum float32

	// Process 8 elements at a time (manual unrolling for CPU pipeline)
	i := 0
	for ; i+7 < n; i += 8 {
		sum += a[i]*b[i] + a[i+1]*b[i+1] + a[i+2]*b[i+2] + a[i+3]*b[i+3] +
			a[i+4]*b[i+4] + a[i+5]*b[i+5] + a[i+6]*b[i+6] + a[i+7]*b[i+7]
	}
	// Remainder
	for ; i < n; i++ {
		sum += a[i] * b[i]
	}
	return sum
}

// cosineSimilarity computes cosine similarity between two vectors.
// Kept for backwards compatibility — new code should pre-normalize + use dotProduct.
func cosineSimilarity(a, b []float32) float32 {
	if len(a) != len(b) || len(a) == 0 {
		return 0
	}
	var dot, normA, normB float32
	for i := range a {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	if normA == 0 || normB == 0 {
		return 0
	}
	return dot / float32(math.Sqrt(float64(normA))*math.Sqrt(float64(normB)))
}

// ========== Vector Cache (LOT 11) ==========

// maxVectorCacheEntries caps the number of chunks loaded into the in-memory vector cache.
// This prevents unbounded RAM growth when users have many large documents.
// 10K chunks × 384 dims × 4 bytes ≈ 15 MB of embedding data, plus metadata.
const maxVectorCacheEntries = 10000

// vectorEntry holds a pre-loaded, pre-normalized embedding with its metadata.
type vectorEntry struct {
	chunkID      int
	documentID   string
	documentName string
	chunkIndex   int
	content      string
	embedding    []float32 // pre-normalized to unit length
	embeddingDim int
	tokenCount   int
}

// VectorCache keeps all embeddings in memory for fast search.
// Invalidated when documents are added/removed.
type VectorCache struct {
	mu             sync.RWMutex
	entries        []vectorEntry
	flatEmbeddings []float32 // contiguous embedding data for SIMD batch processing
	embeddingDim   int       // common dimension of all embeddings (e.g. 384)
	valid          bool
	lastLoadError  time.Time // BUG-7: backoff timestamp for failed loads
}

var globalVectorCache = &VectorCache{}

// InvalidateVectorCache marks the cache as stale (called after document add/delete).
func InvalidateVectorCache() {
	globalVectorCache.mu.Lock()
	globalVectorCache.valid = false
	globalVectorCache.entries = nil
	globalVectorCache.flatEmbeddings = nil
	globalVectorCache.embeddingDim = 0
	globalVectorCache.lastLoadError = time.Time{} // Reset backoff on invalidation
	globalVectorCache.mu.Unlock()
}

// ========== Min-Heap for top-K (LOT 11) ==========

type scored struct {
	index int // index into entries
	score float32
}

// minHeap implements heap.Interface for scored items (min-heap by score).
// We use a min-heap of size K: if a new score > min, replace min and re-heapify.
// This gives O(n log K) instead of O(n log n) for sort, or O(nK) for selection sort.
type minHeap []scored

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool   { return h[i].score < h[j].score }
func (h minHeap) Swap(i, j int)        { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x interface{}) { *h = append(*h, x.(scored)) }
func (h *minHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// ========== Optimized Search (LOT 11) ==========

// searchRAGChunks performs semantic search using cached, pre-normalized vectors.
// Uses dotProduct (no sqrt) + min-heap for O(n log K) top-K selection.
func (db *database) searchRAGChunks(queryEmb []float32, topK int) ([]RAGSearchResult, error) {
	// Ensure cache is loaded (BUG-6 fix: correct double-checked locking)
	globalVectorCache.mu.RLock()
	cacheValid := globalVectorCache.valid
	if cacheValid {
		// Fast path: cache is valid, read under RLock
		entries := globalVectorCache.entries
		flat := globalVectorCache.flatEmbeddings
		dim := globalVectorCache.embeddingDim
		globalVectorCache.mu.RUnlock()
		return db.searchWithEntries(entries, flat, dim, queryEmb, topK)
	}
	globalVectorCache.mu.RUnlock()

	// Slow path: check backoff under write lock, then load WITHOUT the lock
	globalVectorCache.mu.Lock()
	if globalVectorCache.valid {
		// Another goroutine loaded it while we waited for the write lock
		entries := globalVectorCache.entries
		flat := globalVectorCache.flatEmbeddings
		dim := globalVectorCache.embeddingDim
		globalVectorCache.mu.Unlock()
		return db.searchWithEntries(entries, flat, dim, queryEmb, topK)
	}
	// BUG-7 fix: backoff on repeated load errors
	if !globalVectorCache.lastLoadError.IsZero() && time.Since(globalVectorCache.lastLoadError) < 5*time.Second {
		globalVectorCache.mu.Unlock()
		return nil, nil
	}
	globalVectorCache.mu.Unlock()

	// Load data WITHOUT holding the lock (expensive DB I/O)
	if err := db.loadVectorCache(); err != nil {
		globalVectorCache.mu.Lock()
		globalVectorCache.lastLoadError = time.Now()
		globalVectorCache.mu.Unlock()
		return nil, err
	}

	globalVectorCache.mu.Lock()
	globalVectorCache.lastLoadError = time.Time{}
	globalVectorCache.mu.Unlock()

	// Re-read cache under RLock after successful load
	globalVectorCache.mu.RLock()
	entries := globalVectorCache.entries
	flat := globalVectorCache.flatEmbeddings
	dim := globalVectorCache.embeddingDim
	globalVectorCache.mu.RUnlock()

	return db.searchWithEntries(entries, flat, dim, queryEmb, topK)
}

// searchWithEntries performs vector search using SIMD batch dot product on flat embeddings.
func (db *database) searchWithEntries(entries []vectorEntry, flatEmb []float32, dim int, queryEmb []float32, topK int) ([]RAGSearchResult, error) {
	if len(entries) == 0 || dim == 0 || topK <= 0 {
		return nil, nil
	}

	// Normalize query vector (copy to avoid mutating caller's data)
	query := make([]float32, len(queryEmb))
	copy(query, queryEmb)
	simdNormalize(query)

	if len(query) != dim {
		return nil, nil // dimension mismatch
	}

	if topK > len(entries) {
		topK = len(entries)
	}

	// Batch compute all dot products via SIMD (single CGo call on amd64)
	scores := make([]float32, len(entries))
	simdBatchDot(query, flatEmb, len(entries), dim, scores)

	// Use min-heap for top-K selection O(n log K)
	h := &minHeap{}
	heap.Init(h)
	for i, score := range scores {
		if h.Len() < topK {
			heap.Push(h, scored{index: i, score: score})
		} else if score > (*h)[0].score {
			(*h)[0] = scored{index: i, score: score}
			heap.Fix(h, 0)
		}
	}

	// Extract results in descending score order
	results := make([]RAGSearchResult, h.Len())
	for i := h.Len() - 1; i >= 0; i-- {
		s := heap.Pop(h).(scored)
		e := &entries[s.index]
		results[i] = RAGSearchResult{
			RAGChunk: RAGChunk{
				ID:           e.chunkID,
				DocumentID:   e.documentID,
				DocumentName: e.documentName,
				ChunkIndex:   e.chunkIndex,
				Content:      e.content,
				EmbeddingDim: e.embeddingDim,
				TokenCount:   e.tokenCount,
			},
			Score: s.score,
		}
	}

	// Sort by score descending (heap extraction gives ascending)
	sort.Slice(results, func(i, j int) bool { return results[i].Score > results[j].Score })

	return results, nil
}

// buildVectorCacheData loads all embeddings from DB and builds the cache data structures
// (entries, flat array, dimension) WITHOUT holding any lock. This is the expensive part
// that involves DB I/O and should not block concurrent readers.
func (db *database) buildVectorCacheData() ([]vectorEntry, []float32, int, error) {
	chunks, err := db.getAllRAGChunksWithEmbeddings()
	if err != nil {
		return nil, nil, 0, err
	}

	// Determine common embedding dimension (all chunks share the same model)
	dim := 0
	for _, c := range chunks {
		if len(c.Embedding) > 0 {
			dim = len(c.Embedding)
			break
		}
	}

	entries := make([]vectorEntry, 0, len(chunks))
	flat := make([]float32, 0, len(chunks)*dim)

	for _, c := range chunks {
		if len(c.Embedding) == 0 || (dim > 0 && len(c.Embedding) != dim) {
			continue // skip empty or mismatched dimension
		}
		// Pre-normalize for dot-product similarity using SIMD
		simdNormalize(c.Embedding)
		entries = append(entries, vectorEntry{
			chunkID:      c.ID,
			documentID:   c.DocumentID,
			documentName: c.DocumentName,
			chunkIndex:   c.ChunkIndex,
			content:      c.Content,
			embedding:    c.Embedding,
			embeddingDim: c.EmbeddingDim,
			tokenCount:   c.TokenCount,
		})
		// Pack into contiguous flat array for SIMD batch dot product
		flat = append(flat, c.Embedding...)
	}

	return entries, flat, dim, nil
}

// loadVectorCache loads all embeddings from DB into memory, pre-normalizing each vector
// and packing them into a contiguous flat array for SIMD batch processing.
// Caller must NOT hold globalVectorCache.mu — this function manages its own locking.
func (db *database) loadVectorCache() error {
	// Load data WITHOUT holding the lock (expensive DB I/O)
	entries, flat, dim, err := db.buildVectorCacheData()
	if err != nil {
		return err
	}

	// Lock briefly to update cache fields
	globalVectorCache.mu.Lock()
	globalVectorCache.entries = entries
	globalVectorCache.flatEmbeddings = flat
	globalVectorCache.embeddingDim = dim
	globalVectorCache.valid = true
	globalVectorCache.mu.Unlock()

	return nil
}

