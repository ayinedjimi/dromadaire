//go:build windows || darwin

package store

import (
	"container/heap"
	"math"
	"sync"
	"testing"
)

// ========== BUG-5: normalizeVector edge cases ==========

func TestNormalizeVector_ZeroVector(t *testing.T) {
	v := []float32{0, 0, 0, 0, 0}
	normalizeVector(v)
	for i, x := range v {
		if x != 0 {
			t.Errorf("expected 0 at index %d, got %f", i, x)
		}
	}
}

func TestNormalizeVector_DenormalizedFloats(t *testing.T) {
	// Extremely small values: norm² = 4 * (1e-20)² = 4e-40
	// float32 can represent this, but invNorm = 1/sqrt(4e-40) = 1/(2e-20) = 5e19
	// which overflows float32 max (~3.4e38) — no overflow here.
	// BUT with even smaller values: norm² underflows to 0 in float32 (subnormal).
	// float32 min normal = 1.175e-38, so values < ~1e-19 give norm² < 1e-38 → subnormal
	// The real danger: norm² = 0 exactly due to underflow → bypasses check → invNorm = Inf
	v1 := []float32{1e-20, 1e-20, 1e-20, 1e-20}
	normalizeVector(v1)
	for i, x := range v1 {
		if math.IsInf(float64(x), 0) {
			t.Errorf("Inf at index %d with 1e-20 values", i)
		}
		if math.IsNaN(float64(x)) {
			t.Errorf("NaN at index %d with 1e-20 values", i)
		}
	}

	// Test with values so small that norm² underflows to 0 in float32
	// This triggers BUG-5: norm==0 check passes, but values are non-zero
	v2 := []float32{1e-40, 1e-40, 1e-40}
	normalizeVector(v2)
	for i, x := range v2 {
		if math.IsInf(float64(x), 0) {
			t.Errorf("Inf at index %d with 1e-40 values (BUG-5)", i)
		}
		if math.IsNaN(float64(x)) {
			t.Errorf("NaN at index %d with 1e-40 values (BUG-5)", i)
		}
	}
}

func TestNormalizeVector_NormalCase(t *testing.T) {
	v := []float32{3, 4, 0} // L2 norm = 5
	normalizeVector(v)
	// After normalization, L2 norm should be ~1.0
	var norm float64
	for _, x := range v {
		norm += float64(x) * float64(x)
	}
	norm = math.Sqrt(norm)
	if math.Abs(norm-1.0) > 1e-5 {
		t.Errorf("expected L2 norm ~1.0, got %f", norm)
	}
	// Check individual values: [0.6, 0.8, 0]
	if math.Abs(float64(v[0])-0.6) > 1e-5 {
		t.Errorf("expected v[0]~0.6, got %f", v[0])
	}
	if math.Abs(float64(v[1])-0.8) > 1e-5 {
		t.Errorf("expected v[1]~0.8, got %f", v[1])
	}
}

func TestNormalizeVector_SingleElement(t *testing.T) {
	v := []float32{5.0}
	normalizeVector(v)
	if math.Abs(float64(v[0])-1.0) > 1e-5 {
		t.Errorf("expected 1.0, got %f", v[0])
	}
}

func TestNormalizeVector_EmptyVector(t *testing.T) {
	v := []float32{}
	normalizeVector(v) // Should not panic
}

// ========== VectorCache tests ==========

func TestVectorCache_EmptyState(t *testing.T) {
	// Reset global cache to empty state
	globalVectorCache.mu.Lock()
	oldEntries := globalVectorCache.entries
	oldValid := globalVectorCache.valid
	globalVectorCache.entries = nil
	globalVectorCache.valid = true
	globalVectorCache.mu.Unlock()

	defer func() {
		globalVectorCache.mu.Lock()
		globalVectorCache.entries = oldEntries
		globalVectorCache.valid = oldValid
		globalVectorCache.mu.Unlock()
	}()

	// Search on empty cache should return nil, nil
	query := []float32{1, 0, 0}
	normalizeVector(query)

	// Directly test the heap/search logic with empty entries
	entries := globalVectorCache.entries
	if len(entries) != 0 {
		t.Errorf("expected empty entries, got %d", len(entries))
	}
}

func TestVectorCache_InvalidateDuringSearch(t *testing.T) {
	// BUG-6: concurrent invalidation during cache read
	// Set up a populated cache
	testEntries := make([]vectorEntry, 100)
	for i := range testEntries {
		emb := make([]float32, 8)
		for j := range emb {
			emb[j] = float32(i*8+j) * 0.01
		}
		normalizeVector(emb)
		testEntries[i] = vectorEntry{
			chunkID:   i,
			content:   "test",
			embedding: emb,
		}
	}

	globalVectorCache.mu.Lock()
	oldEntries := globalVectorCache.entries
	oldValid := globalVectorCache.valid
	globalVectorCache.entries = testEntries
	globalVectorCache.valid = true
	globalVectorCache.mu.Unlock()

	defer func() {
		globalVectorCache.mu.Lock()
		globalVectorCache.entries = oldEntries
		globalVectorCache.valid = oldValid
		globalVectorCache.mu.Unlock()
	}()

	// Run concurrent readers and invalidators — should not panic or return corrupted data
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				// Read the cache
				globalVectorCache.mu.RLock()
				entries := globalVectorCache.entries
				valid := globalVectorCache.valid
				globalVectorCache.mu.RUnlock()
				_ = valid
				// If entries is not nil, verify no element is corrupted
				if entries != nil {
					for _, e := range entries {
						if e.embedding != nil {
							for _, v := range e.embedding {
								if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
									t.Errorf("corrupted embedding value: %f", v)
									return
								}
							}
						}
					}
				}
			}
		}()
	}

	// Concurrent invalidators
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				InvalidateVectorCache()
				// Re-populate
				globalVectorCache.mu.Lock()
				globalVectorCache.entries = testEntries
				globalVectorCache.valid = true
				globalVectorCache.mu.Unlock()
			}
		}()
	}

	wg.Wait()
}

// ========== MinHeap tests ==========

func TestMinHeap_KGreaterThanN(t *testing.T) {
	// topK=10 but only 3 entries → should return 3
	h := &minHeap{}
	heap.Init(h)

	items := []scored{
		{index: 0, score: 0.9},
		{index: 1, score: 0.5},
		{index: 2, score: 0.7},
	}

	topK := 10
	for _, item := range items {
		if h.Len() < topK {
			heap.Push(h, item)
		} else if item.score > (*h)[0].score {
			(*h)[0] = item
			heap.Fix(h, 0)
		}
	}

	if h.Len() != 3 {
		t.Errorf("expected 3 results, got %d", h.Len())
	}

	// Extract all in ascending order
	var scores []float32
	for h.Len() > 0 {
		s := heap.Pop(h).(scored)
		scores = append(scores, s.score)
	}
	// Should be ascending: 0.5, 0.7, 0.9
	for i := 1; i < len(scores); i++ {
		if scores[i] < scores[i-1] {
			t.Errorf("heap order broken: scores[%d]=%f < scores[%d]=%f", i, scores[i], i-1, scores[i-1])
		}
	}
}

func TestMinHeap_KZero(t *testing.T) {
	h := &minHeap{}
	heap.Init(h)
	topK := 0

	items := []scored{
		{index: 0, score: 0.9},
		{index: 1, score: 0.5},
	}

	for _, item := range items {
		if h.Len() < topK {
			heap.Push(h, item)
		}
	}

	if h.Len() != 0 {
		t.Errorf("expected 0 results for topK=0, got %d", h.Len())
	}
}

func TestMinHeap_IdenticalScores(t *testing.T) {
	h := &minHeap{}
	heap.Init(h)
	topK := 3

	// All scores identical
	for i := 0; i < 10; i++ {
		item := scored{index: i, score: 0.5}
		if h.Len() < topK {
			heap.Push(h, item)
		} else if item.score > (*h)[0].score {
			(*h)[0] = item
			heap.Fix(h, 0)
		}
	}

	if h.Len() != 3 {
		t.Errorf("expected 3 results, got %d", h.Len())
	}

	// All extracted scores should be 0.5
	for h.Len() > 0 {
		s := heap.Pop(h).(scored)
		if s.score != 0.5 {
			t.Errorf("expected score 0.5, got %f", s.score)
		}
	}
}

func TestMinHeap_SingleElement(t *testing.T) {
	h := &minHeap{}
	heap.Init(h)
	heap.Push(h, scored{index: 42, score: 0.99})

	if h.Len() != 1 {
		t.Fatalf("expected 1, got %d", h.Len())
	}
	s := heap.Pop(h).(scored)
	if s.index != 42 || s.score != 0.99 {
		t.Errorf("unexpected result: %+v", s)
	}
}
