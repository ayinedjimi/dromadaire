//go:build windows || darwin

package store

import (
	"math"
	"math/rand"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// ========== Helpers ==========

// randomEmbedding creates a random float32 vector of given dimension.
func randomEmbedding(dim int) []float32 {
	v := make([]float32, dim)
	for i := range v {
		v[i] = rand.Float32()*2 - 1
	}
	return v
}

// setupRAGTestStore creates a temporary Store with initialized DB for RAG unit tests.
func setupRAGTestStore(t *testing.T) *Store {
	t.Helper()
	tmpDir := t.TempDir()
	st := &Store{DBPath: filepath.Join(tmpDir, "test_rag.sqlite")}
	if _, err := st.Settings(); err != nil {
		t.Fatal("init store:", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// saveAndRestoreVectorCache saves global vector cache state before a test and restores it after.
func saveAndRestoreVectorCache(t *testing.T) {
	t.Helper()
	globalVectorCache.mu.Lock()
	oldEntries := globalVectorCache.entries
	oldFlat := globalVectorCache.flatEmbeddings
	oldDim := globalVectorCache.embeddingDim
	oldValid := globalVectorCache.valid
	oldLastErr := globalVectorCache.lastLoadError
	globalVectorCache.mu.Unlock()

	t.Cleanup(func() {
		globalVectorCache.mu.Lock()
		globalVectorCache.entries = oldEntries
		globalVectorCache.flatEmbeddings = oldFlat
		globalVectorCache.embeddingDim = oldDim
		globalVectorCache.valid = oldValid
		globalVectorCache.lastLoadError = oldLastErr
		globalVectorCache.mu.Unlock()
	})
}

// ========== 1. Serialization: round-trip 384-dim ==========

func TestSerializeDeserialize_RoundTrip384(t *testing.T) {
	original := randomEmbedding(384)

	bytes := serializeEmbedding(original)
	if bytes == nil {
		t.Fatal("serializeEmbedding returned nil for non-empty vector")
	}
	if len(bytes) != 384*4 {
		t.Fatalf("expected %d bytes, got %d", 384*4, len(bytes))
	}

	restored := deserializeEmbedding(bytes)
	if restored == nil {
		t.Fatal("deserializeEmbedding returned nil")
	}
	if len(restored) != 384 {
		t.Fatalf("expected 384 dims, got %d", len(restored))
	}

	for i := range original {
		if original[i] != restored[i] {
			t.Errorf("mismatch at index %d: original=%v restored=%v", i, original[i], restored[i])
		}
	}
}

// ========== 2. Serialization: nil input ==========

func TestSerializeEmbedding_Nil(t *testing.T) {
	result := serializeEmbedding(nil)
	if result != nil {
		t.Errorf("expected nil for nil input, got %d bytes", len(result))
	}

	// Also test empty slice
	result2 := serializeEmbedding([]float32{})
	if result2 != nil {
		t.Errorf("expected nil for empty slice, got %d bytes", len(result2))
	}
}

// ========== 3. Deserialization: wrong byte count ==========

func TestDeserializeEmbedding_WrongByteCount(t *testing.T) {
	// 5 bytes is not divisible by 4
	result := deserializeEmbedding([]byte{1, 2, 3, 4, 5})
	if result != nil {
		t.Errorf("expected nil for 5 bytes (not divisible by 4), got %d floats", len(result))
	}

	// Also test other non-divisible-by-4 counts
	for _, n := range []int{1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15} {
		b := make([]byte, n)
		r := deserializeEmbedding(b)
		if r != nil {
			t.Errorf("expected nil for %d bytes, got %d floats", n, len(r))
		}
	}

	// Empty and nil
	if r := deserializeEmbedding(nil); r != nil {
		t.Error("expected nil for nil input")
	}
	if r := deserializeEmbedding([]byte{}); r != nil {
		t.Error("expected nil for empty input")
	}
}

// ========== 4. Round-trip with special float values ==========

func TestSerializeDeserialize_SpecialFloats(t *testing.T) {
	special := []float32{
		float32(math.Inf(1)),    // +Inf
		float32(math.Inf(-1)),   // -Inf
		0.0,                     // zero
		math.SmallestNonzeroFloat32, // very small positive
		-math.SmallestNonzeroFloat32,
		math.MaxFloat32,
		-math.MaxFloat32,
		float32(math.NaN()), // NaN
	}

	bytes := serializeEmbedding(special)
	if bytes == nil {
		t.Fatal("serializeEmbedding returned nil for special values")
	}

	restored := deserializeEmbedding(bytes)
	if restored == nil {
		t.Fatal("deserializeEmbedding returned nil")
	}
	if len(restored) != len(special) {
		t.Fatalf("expected %d dims, got %d", len(special), len(restored))
	}

	for i := range special {
		// NaN != NaN, so check specially
		if math.IsNaN(float64(special[i])) {
			if !math.IsNaN(float64(restored[i])) {
				t.Errorf("index %d: expected NaN, got %v", i, restored[i])
			}
			continue
		}
		if special[i] != restored[i] {
			t.Errorf("index %d: expected %v, got %v", i, special[i], restored[i])
		}
	}
}

// ========== 5. dotProduct identical unit vectors ==========

func TestDotProduct_IdenticalUnitVectors(t *testing.T) {
	v := randomEmbedding(384)
	normalizeVector(v)

	result := dotProduct(v, v)
	if math.Abs(float64(result)-1.0) > 1e-5 {
		t.Errorf("dot product of identical unit vector with itself should be ~1.0, got %f", result)
	}
}

// ========== 6. dotProduct orthogonal ==========

func TestDotProduct_Orthogonal(t *testing.T) {
	// Standard basis vectors are orthogonal
	a := make([]float32, 100)
	b := make([]float32, 100)
	a[0] = 1.0 // e1
	b[1] = 1.0 // e2

	result := dotProduct(a, b)
	if result != 0 {
		t.Errorf("dot product of orthogonal vectors should be 0, got %f", result)
	}
}

// ========== 7. dotProduct mismatched lengths ==========

func TestDotProduct_MismatchedLengths(t *testing.T) {
	a := []float32{1, 2, 3}
	b := []float32{1, 2}

	result := dotProduct(a, b)
	if result != 0 {
		t.Errorf("expected 0 for mismatched lengths, got %f", result)
	}
}

// ========== 8. dotProduct empty ==========

func TestDotProduct_Empty(t *testing.T) {
	result := dotProduct([]float32{}, []float32{})
	if result != 0 {
		t.Errorf("expected 0 for empty vectors, got %f", result)
	}

	result2 := dotProduct(nil, nil)
	if result2 != 0 {
		t.Errorf("expected 0 for nil vectors, got %f", result2)
	}
}

// ========== 9. dotProduct loop unrolling edge cases ==========

func TestDotProduct_LoopUnrollingEdgeCases(t *testing.T) {
	// Test lengths that exercise all branches of the 8x unrolled loop:
	// len=1  → 0 full iterations, 1 remainder
	// len=7  → 0 full iterations, 7 remainder
	// len=8  → 1 full iteration,  0 remainder
	// len=9  → 1 full iteration,  1 remainder
	// len=16 → 2 full iterations, 0 remainder
	// len=17 → 2 full iterations, 1 remainder
	for _, n := range []int{1, 7, 8, 9, 16, 17} {
		t.Run(
			func() string {
				return "len=" + string(rune('0'+n/10)) + string(rune('0'+n%10))
			}(),
			func(t *testing.T) {
				a := make([]float32, n)
				b := make([]float32, n)
				// Fill with known values: a[i]=1, b[i]=1 → dot = n
				for i := range a {
					a[i] = 1.0
					b[i] = 1.0
				}
				result := dotProduct(a, b)
				expected := float32(n)
				if math.Abs(float64(result-expected)) > 1e-5 {
					t.Errorf("len=%d: expected %f, got %f", n, expected, result)
				}
			},
		)
	}

	// Also verify correctness with non-trivial values
	for _, n := range []int{1, 7, 8, 9, 16, 17} {
		a := make([]float32, n)
		b := make([]float32, n)
		var expected float64
		for i := range a {
			a[i] = float32(i + 1)
			b[i] = float32(i + 1)
			expected += float64(i+1) * float64(i+1)
		}
		result := dotProduct(a, b)
		if math.Abs(float64(result)-expected) > float64(expected)*1e-5 {
			t.Errorf("len=%d: expected %f, got %f", n, expected, result)
		}
	}
}

// ========== 10. cosineSimilarity zero vector ==========

func TestCosineSimilarity_ZeroVector(t *testing.T) {
	zero := make([]float32, 100)
	nonZero := randomEmbedding(100)

	// Zero vector with non-zero vector
	result := cosineSimilarity(zero, nonZero)
	if result != 0 {
		t.Errorf("cosine similarity with zero vector should be 0, got %f", result)
	}

	// Both zero vectors
	result2 := cosineSimilarity(zero, zero)
	if result2 != 0 {
		t.Errorf("cosine similarity of two zero vectors should be 0, got %f", result2)
	}

	// No panic should occur — this test passes if it doesn't panic
}

// ========== 11. cosineSimilarity anti-parallel ==========

func TestCosineSimilarity_AntiParallel(t *testing.T) {
	a := []float32{1, 2, 3, 4, 5}
	b := make([]float32, len(a))
	for i := range a {
		b[i] = -a[i]
	}

	result := cosineSimilarity(a, b)
	if math.Abs(float64(result)-(-1.0)) > 1e-5 {
		t.Errorf("cosine similarity of anti-parallel vectors should be ~-1.0, got %f", result)
	}
}

// ========== 12. searchWithEntries topK > len(entries) ==========

func TestSearchWithEntries_TopKGreaterThanEntries(t *testing.T) {
	dim := 8
	entries := make([]vectorEntry, 3)
	flat := make([]float32, 0, 3*dim)

	for i := range entries {
		emb := make([]float32, dim)
		for j := range emb {
			emb[j] = rand.Float32()
		}
		normalizeVector(emb)
		entries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "chunk content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   10,
		}
		flat = append(flat, emb...)
	}

	query := make([]float32, dim)
	for j := range query {
		query[j] = rand.Float32()
	}
	normalizeVector(query)

	// Use a database instance to call searchWithEntries (it's a method on *database)
	st := setupRAGTestStore(t)
	results, err := st.db.searchWithEntries(entries, flat, dim, query, 10) // topK=10 > 3 entries
	if err != nil {
		t.Fatal(err)
	}

	if len(results) != 3 {
		t.Errorf("expected 3 results (all entries), got %d", len(results))
	}
}

// ========== 13. searchWithEntries topK=0 ==========

func TestSearchWithEntries_TopKZero(t *testing.T) {
	// topK=0 with empty entries returns nil (early return path)
	st := setupRAGTestStore(t)
	results, err := st.db.searchWithEntries(nil, nil, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	if results != nil {
		t.Errorf("expected nil results for empty entries + topK=0, got %d", len(results))
	}

	// topK=0 with non-empty entries: previously panicked because the min-heap
	// loop accessed (*h)[0] on an empty heap. Fixed by adding topK <= 0 guard
	// in the early return at the top of searchWithEntries.
	dim := 8
	entries := make([]vectorEntry, 3)
	flat := make([]float32, 0, 3*dim)
	for i := range entries {
		emb := make([]float32, dim)
		for j := range emb {
			emb[j] = rand.Float32()
		}
		normalizeVector(emb)
		entries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "chunk content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   10,
		}
		flat = append(flat, emb...)
	}

	query := make([]float32, dim)
	for j := range query {
		query[j] = rand.Float32()
	}

	// After fix: topK=0 returns nil gracefully (no panic)
	results2, err2 := st.db.searchWithEntries(entries, flat, dim, query, 0)
	if err2 != nil {
		t.Fatal(err2)
	}
	if results2 != nil {
		t.Errorf("expected nil results for topK=0, got %d", len(results2))
	}
}

// ========== 14. searchWithEntries results sorted descending by score ==========

func TestSearchWithEntries_SortedDescending(t *testing.T) {
	dim := 8

	// Create entries with embeddings pointing in known directions
	// so we can predict score ordering
	nEntries := 20
	entries := make([]vectorEntry, nEntries)
	flat := make([]float32, 0, nEntries*dim)

	for i := range entries {
		emb := randomEmbedding(dim)
		normalizeVector(emb)
		entries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   10,
		}
		flat = append(flat, emb...)
	}

	query := randomEmbedding(dim)
	// Note: searchWithEntries normalizes the query internally via simdNormalize

	st := setupRAGTestStore(t)
	results, err := st.db.searchWithEntries(entries, flat, dim, query, 5)
	if err != nil {
		t.Fatal(err)
	}

	if len(results) == 0 {
		t.Fatal("expected results, got none")
	}

	// Verify descending order
	for i := 1; i < len(results); i++ {
		if results[i].Score > results[i-1].Score {
			t.Errorf("results not sorted descending: results[%d].Score=%f > results[%d].Score=%f",
				i, results[i].Score, i-1, results[i-1].Score)
		}
	}
}

// ========== 15. searchWithEntries handles negative scores ==========

func TestSearchWithEntries_NegativeScores(t *testing.T) {
	dim := 8

	// Create entries that are anti-parallel to the query to get negative scores
	query := make([]float32, dim)
	for j := range query {
		query[j] = 1.0 // all positive direction
	}

	nEntries := 5
	entries := make([]vectorEntry, nEntries)
	flat := make([]float32, 0, nEntries*dim)

	for i := range entries {
		emb := make([]float32, dim)
		for j := range emb {
			emb[j] = -1.0 // all negative (anti-parallel)
		}
		normalizeVector(emb)
		entries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   10,
		}
		flat = append(flat, emb...)
	}

	st := setupRAGTestStore(t)
	results, err := st.db.searchWithEntries(entries, flat, dim, query, 3)
	if err != nil {
		t.Fatal(err)
	}

	// All results should have negative scores (anti-parallel to query)
	for i, r := range results {
		if r.Score > 0 {
			t.Errorf("result[%d]: expected negative score for anti-parallel vectors, got %f", i, r.Score)
		}
	}
}

// ========== 16. VectorCache concurrent readers + invalidators ==========

func TestVectorCache_ConcurrentReadersAndInvalidators(t *testing.T) {
	saveAndRestoreVectorCache(t)

	dim := 8
	nEntries := 50

	// Build test entries
	testEntries := make([]vectorEntry, nEntries)
	testFlat := make([]float32, 0, nEntries*dim)
	for i := range testEntries {
		emb := make([]float32, dim)
		for j := range emb {
			emb[j] = rand.Float32()*2 - 1
		}
		normalizeVector(emb)
		testEntries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "test content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   5,
		}
		testFlat = append(testFlat, emb...)
	}

	// Populate cache
	globalVectorCache.mu.Lock()
	globalVectorCache.entries = testEntries
	globalVectorCache.flatEmbeddings = testFlat
	globalVectorCache.embeddingDim = dim
	globalVectorCache.valid = true
	globalVectorCache.lastLoadError = time.Time{}
	globalVectorCache.mu.Unlock()

	var wg sync.WaitGroup
	done := make(chan struct{})

	// 50 reader goroutines
	for r := 0; r < 50; r++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
					globalVectorCache.mu.RLock()
					entries := globalVectorCache.entries
					valid := globalVectorCache.valid
					flat := globalVectorCache.flatEmbeddings
					cacheDim := globalVectorCache.embeddingDim
					globalVectorCache.mu.RUnlock()

					_ = valid
					_ = cacheDim

					// Read entries if populated
					if entries != nil {
						for _, e := range entries {
							if e.embedding != nil {
								for _, v := range e.embedding {
									if math.IsNaN(float64(v)) {
										t.Errorf("corrupted: NaN in embedding")
										return
									}
								}
							}
						}
					}

					// Read flat embeddings
					if flat != nil {
						for _, v := range flat {
							if math.IsNaN(float64(v)) {
								t.Errorf("corrupted: NaN in flat embedding")
								return
							}
						}
					}
				}
			}
		}()
	}

	// 10 invalidator goroutines
	for w := 0; w < 10; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-done:
					return
				default:
					InvalidateVectorCache()

					// Re-populate
					globalVectorCache.mu.Lock()
					globalVectorCache.entries = testEntries
					globalVectorCache.flatEmbeddings = testFlat
					globalVectorCache.embeddingDim = dim
					globalVectorCache.valid = true
					globalVectorCache.mu.Unlock()
				}
			}
		}()
	}

	// Let it run for 200ms
	time.Sleep(200 * time.Millisecond)
	close(done)
	wg.Wait()

	// If we get here without panic or race detector complaints, the test passes
}

// ========== 17. VectorCache dimension mismatch ==========

func TestVectorCache_DimensionMismatch(t *testing.T) {
	dim := 384
	nEntries := 5

	entries := make([]vectorEntry, nEntries)
	flat := make([]float32, 0, nEntries*dim)

	for i := range entries {
		emb := randomEmbedding(dim)
		normalizeVector(emb)
		entries[i] = vectorEntry{
			chunkID:      i,
			documentID:   "doc1",
			documentName: "test.txt",
			chunkIndex:   i,
			content:      "content",
			embedding:    emb,
			embeddingDim: dim,
			tokenCount:   10,
		}
		flat = append(flat, emb...)
	}

	// Query with different dimension (256 instead of 384)
	query := randomEmbedding(256)

	st := setupRAGTestStore(t)
	results, err := st.db.searchWithEntries(entries, flat, dim, query, 3)
	if err != nil {
		t.Fatal("unexpected error for dimension mismatch:", err)
	}

	// searchWithEntries returns nil for dimension mismatch (query normalized copy != dim)
	if results != nil {
		t.Errorf("expected nil results for dimension mismatch (query=256, entries=384), got %d results", len(results))
	}
}

// ========== 18. Store integration: InsertRAGChunks + SearchRAGChunks ==========

func TestStoreIntegration_InsertAndSearchRAGChunks(t *testing.T) {
	saveAndRestoreVectorCache(t)

	st := setupRAGTestStore(t)
	now := time.Now()

	// First, insert a RAG document (chunks reference documents via foreign key)
	doc := RAGDocument{
		ID:             "test-doc-001",
		Filename:       "testfile.txt",
		FileSize:       1024,
		ContentHash:    "abc123",
		ChunkCount:     3,
		Status:         "ready",
		EmbeddingModel: "snowflake-arctic-embed:33m",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := st.InsertRAGDocument(doc); err != nil {
		t.Fatal("insert document:", err)
	}

	dim := 8

	// Create chunks with synthetic embeddings
	chunks := make([]RAGChunk, 3)
	for i := range chunks {
		emb := randomEmbedding(dim)
		chunks[i] = RAGChunk{
			DocumentID:   "test-doc-001",
			ChunkIndex:   i,
			Content:      "This is test chunk number " + string(rune('0'+i)),
			Embedding:    emb,
			EmbeddingDim: dim,
			TokenCount:   10,
		}
	}

	if err := st.InsertRAGChunks(chunks); err != nil {
		t.Fatal("insert chunks:", err)
	}

	// Search with a query embedding of the same dimension
	query := randomEmbedding(dim)
	results, err := st.SearchRAGChunks(query, 5)
	if err != nil {
		t.Fatal("search:", err)
	}

	if len(results) == 0 {
		t.Fatal("expected search results, got none")
	}

	if len(results) > 3 {
		t.Errorf("expected at most 3 results (inserted 3 chunks), got %d", len(results))
	}

	// Verify results have content and metadata
	for i, r := range results {
		if r.DocumentID != "test-doc-001" {
			t.Errorf("result[%d]: expected document_id 'test-doc-001', got '%s'", i, r.DocumentID)
		}
		if r.DocumentName != "testfile.txt" {
			t.Errorf("result[%d]: expected document_name 'testfile.txt', got '%s'", i, r.DocumentName)
		}
		if r.Content == "" {
			t.Errorf("result[%d]: empty content", i)
		}
		if r.EmbeddingDim != dim {
			t.Errorf("result[%d]: expected embedding_dim %d, got %d", i, dim, r.EmbeddingDim)
		}
	}
}

// ========== 19. InvalidateVectorCache then search reloads correctly ==========

func TestStoreIntegration_InvalidateThenSearch(t *testing.T) {
	saveAndRestoreVectorCache(t)

	st := setupRAGTestStore(t)
	now := time.Now()

	// Insert a document and chunks
	doc := RAGDocument{
		ID:             "test-doc-reload",
		Filename:       "reload.txt",
		FileSize:       512,
		ContentHash:    "reload-hash",
		ChunkCount:     2,
		Status:         "ready",
		EmbeddingModel: "snowflake-arctic-embed:33m",
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := st.InsertRAGDocument(doc); err != nil {
		t.Fatal("insert document:", err)
	}

	dim := 8
	chunks := make([]RAGChunk, 2)
	for i := range chunks {
		emb := randomEmbedding(dim)
		chunks[i] = RAGChunk{
			DocumentID:   "test-doc-reload",
			ChunkIndex:   i,
			Content:      "Reload test chunk",
			Embedding:    emb,
			EmbeddingDim: dim,
			TokenCount:   5,
		}
	}
	if err := st.InsertRAGChunks(chunks); err != nil {
		t.Fatal("insert chunks:", err)
	}

	// First search — populates cache
	query := randomEmbedding(dim)
	results1, err := st.SearchRAGChunks(query, 5)
	if err != nil {
		t.Fatal("first search:", err)
	}
	if len(results1) != 2 {
		t.Fatalf("expected 2 results from first search, got %d", len(results1))
	}

	// Invalidate the cache explicitly
	InvalidateVectorCache()

	// Verify cache is invalid
	globalVectorCache.mu.RLock()
	valid := globalVectorCache.valid
	globalVectorCache.mu.RUnlock()
	if valid {
		t.Error("cache should be invalid after InvalidateVectorCache()")
	}

	// Search again — should reload from DB
	results2, err := st.SearchRAGChunks(query, 5)
	if err != nil {
		t.Fatal("second search after invalidation:", err)
	}
	if len(results2) != 2 {
		t.Fatalf("expected 2 results from second search (reload), got %d", len(results2))
	}

	// Verify cache is valid again after reload
	globalVectorCache.mu.RLock()
	valid = globalVectorCache.valid
	globalVectorCache.mu.RUnlock()
	if !valid {
		t.Error("cache should be valid after search reloaded it")
	}
}

// ========== 20. normalizeVector produces unit vector ==========

func TestNormalizeVector_ProducesUnitVector(t *testing.T) {
	// Test with various dimensions and random values
	for _, dim := range []int{1, 3, 8, 16, 100, 384} {
		v := randomEmbedding(dim)

		normalizeVector(v)

		// Compute L2 norm
		var norm float64
		for _, x := range v {
			norm += float64(x) * float64(x)
		}
		norm = math.Sqrt(norm)

		if math.Abs(norm-1.0) > 1e-4 {
			t.Errorf("dim=%d: expected L2 norm ~1.0 after normalization, got %f", dim, norm)
		}
	}

	// Verify with a known vector: [3, 4] → norm=5 → [0.6, 0.8]
	v := []float32{3, 4}
	normalizeVector(v)
	var norm float64
	for _, x := range v {
		norm += float64(x) * float64(x)
	}
	norm = math.Sqrt(norm)
	if math.Abs(norm-1.0) > 1e-6 {
		t.Errorf("known vector [3,4]: expected norm ~1.0, got %f", norm)
	}
}
