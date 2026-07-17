//go:build windows || darwin

package store

import (
	"fmt"
	"math"
	"math/rand"
	"path/filepath"
	"testing"
	"time"
)

// ========== LOT 11: Vector Math Benchmarks ==========

// randomVector generates a random float32 vector of given dimension.
func randomVector(dim int) []float32 {
	v := make([]float32, dim)
	for i := range v {
		v[i] = rand.Float32()*2 - 1
	}
	return v
}

// BenchmarkCosineSimilarity benchmarks the OLD approach: full cosine similarity
// with sqrt for each comparison (used before LOT 11).
func BenchmarkCosineSimilarity(b *testing.B) {
	a := randomVector(384)
	q := randomVector(384)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		cosineSimilarity(a, q)
	}
}

// BenchmarkDotProduct benchmarks the NEW approach: dot product on pre-normalized
// vectors with 8x loop unrolling (LOT 11).
func BenchmarkDotProduct(b *testing.B) {
	a := randomVector(384)
	q := randomVector(384)
	normalizeVector(a)
	normalizeVector(q)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		dotProduct(a, q)
	}
}

// BenchmarkNormalizeVector benchmarks the one-time cost of L2 normalization.
func BenchmarkNormalizeVector(b *testing.B) {
	vectors := make([][]float32, b.N)
	for i := range vectors {
		vectors[i] = randomVector(384)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		normalizeVector(vectors[i])
	}
}

// BenchmarkTopK_Sort benchmarks the OLD approach: compute all scores + sort.
func BenchmarkTopK_Sort(b *testing.B) {
	for _, n := range []int{100, 500, 1000, 5000} {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			entries := make([][]float32, n)
			for i := range entries {
				entries[i] = randomVector(384)
				normalizeVector(entries[i])
			}
			query := randomVector(384)
			normalizeVector(query)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// OLD approach: compute all scores, sort, take top 5
				type result struct {
					idx   int
					score float32
				}
				results := make([]result, len(entries))
				for j := range entries {
					results[j] = result{idx: j, score: cosineSimilarity(query, entries[j])}
				}
				// Sort by score descending
				for j := 0; j < len(results)-1; j++ {
					for k := j + 1; k < len(results); k++ {
						if results[k].score > results[j].score {
							results[j], results[k] = results[k], results[j]
						}
					}
				}
				_ = results[:5]
			}
		})
	}
}

// BenchmarkTopK_Heap benchmarks the NEW approach: dotProduct + min-heap top-K (LOT 11).
func BenchmarkTopK_Heap(b *testing.B) {
	for _, n := range []int{100, 500, 1000, 5000} {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			entries := make([]vectorEntry, n)
			for i := range entries {
				emb := randomVector(384)
				normalizeVector(emb)
				entries[i] = vectorEntry{
					chunkID:   i,
					embedding: emb,
				}
			}
			query := randomVector(384)
			normalizeVector(query)

			// Simulate the global cache
			globalVectorCache.mu.Lock()
			globalVectorCache.entries = entries
			globalVectorCache.valid = true
			globalVectorCache.mu.Unlock()

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// NEW approach: cached vectors + dotProduct + min-heap
				h := &minHeap{}
				topK := 5
				for j := range entries {
					score := dotProduct(query, entries[j].embedding)
					if h.Len() < topK {
						*h = append(*h, scored{index: j, score: score})
					} else if score > (*h)[0].score {
						(*h)[0] = scored{index: j, score: score}
						// Simplified: skip heap.Fix for benchmark purity
					}
				}
			}

			// Cleanup
			globalVectorCache.mu.Lock()
			globalVectorCache.entries = nil
			globalVectorCache.valid = false
			globalVectorCache.mu.Unlock()
		})
	}
}

// ========== LOT 10: SQLite Write Benchmarks ==========

// setupBenchStore creates a test store with a chat and messages for benchmarking.
func setupBenchStore(b *testing.B) (*Store, string, func()) {
	b.Helper()
	tmpDir := b.TempDir()
	oldLegacy := legacyConfigPath
	legacyConfigPath = filepath.Join(tmpDir, "config.json")

	s := &Store{DBPath: filepath.Join(tmpDir, "db.sqlite")}

	// Initialize (opens DB, runs migrations)
	if _, err := s.Settings(); err != nil {
		b.Fatal("init store:", err)
	}

	// Create a chat with 5 user+assistant message pairs
	chat := NewChat("bench-chat-001")
	chatID := chat.ID
	if err := s.SetChat(*chat); err != nil {
		b.Fatal("create chat:", err)
	}
	for i := 0; i < 5; i++ {
		if err := s.AppendMessage(chatID, Message{
			Role:    "user",
			Content: fmt.Sprintf("Question %d about testing performance", i),
		}); err != nil {
			b.Fatal("append user msg:", err)
		}
		if err := s.AppendMessage(chatID, Message{
			Role:    "assistant",
			Content: "Initial assistant response for benchmarking purposes.",
			Model:   "test-model",
		}); err != nil {
			b.Fatal("append assistant msg:", err)
		}
	}

	cleanup := func() {
		s.Close()
		legacyConfigPath = oldLegacy
	}
	return s, chatID, cleanup
}

// BenchmarkUpdateLastMessage_Old benchmarks the ORIGINAL updateLastMessage:
// BEGIN → SELECT MAX(id) → UPDATE 7 cols → DELETE attachments → DELETE tool_calls → COMMIT
func BenchmarkUpdateLastMessage_Old(b *testing.B) {
	s, chatID, cleanup := setupBenchStore(b)
	defer cleanup()

	msg := Message{
		Content:   "Updated streaming content with some tokens appended over time for realistic bench",
		Thinking:  "Let me think about this carefully...",
		Model:     "test-model",
		UpdatedAt: time.Now(),
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		msg.Content = fmt.Sprintf("Streaming token %d appended to existing content for bench", i)
		if err := s.UpdateLastMessage(chatID, msg); err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkUpdateLastMessageContentByID_New benchmarks the NEW optimized path (LOT 10):
// Single UPDATE by cached ID, no transaction, no attachment/tool_call handling.
func BenchmarkUpdateLastMessageContentByID_New(b *testing.B) {
	s, chatID, cleanup := setupBenchStore(b)
	defer cleanup()

	// Get the last message ID (simulates the one-time cache lookup)
	lastID, err := s.GetLastMessageID(chatID)
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		content := fmt.Sprintf("Streaming token %d appended to existing content for bench", i)
		thinking := "Let me think about this carefully..."
		if err := s.UpdateLastMessageContentByID(lastID, content, thinking, nil, nil); err != nil {
			b.Fatal(err)
		}
	}
}

// ========== LOT 11: Full Search Pipeline Benchmark ==========

// BenchmarkSearchPipeline_Old simulates the old search: load from DB + cosine similarity + sort.
func BenchmarkSearchPipeline_Old(b *testing.B) {
	for _, n := range []int{100, 500, 1000} {
		b.Run(fmt.Sprintf("chunks=%d", n), func(b *testing.B) {
			entries := make([][]float32, n)
			for i := range entries {
				entries[i] = randomVector(384)
			}
			query := randomVector(384)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// OLD: cosine similarity (includes sqrt) for each pair
				type res struct {
					idx   int
					score float32
				}
				scores := make([]res, n)
				for j := 0; j < n; j++ {
					scores[j] = res{idx: j, score: cosineSimilarity(query, entries[j])}
				}
				// Sort top 5
				topK := 5
				if topK > n {
					topK = n
				}
				// Partial selection sort for top K
				for j := 0; j < topK; j++ {
					maxIdx := j
					for k := j + 1; k < n; k++ {
						if scores[k].score > scores[maxIdx].score {
							maxIdx = k
						}
					}
					scores[j], scores[maxIdx] = scores[maxIdx], scores[j]
				}
				_ = scores[:topK]
			}
		})
	}
}

// BenchmarkSearchPipeline_New simulates the new search: pre-normalized + dotProduct + min-heap.
func BenchmarkSearchPipeline_New(b *testing.B) {
	for _, n := range []int{100, 500, 1000} {
		b.Run(fmt.Sprintf("chunks=%d", n), func(b *testing.B) {
			entries := make([][]float32, n)
			for i := range entries {
				entries[i] = randomVector(384)
				normalizeVector(entries[i])
			}
			query := randomVector(384)
			normalizeVector(query)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// NEW: dotProduct + min-heap for top 5
				topK := 5
				if topK > n {
					topK = n
				}
				h := make(minHeap, 0, topK)
				for j := 0; j < n; j++ {
					score := dotProduct(query, entries[j])
					if len(h) < topK {
						h = append(h, scored{index: j, score: score})
						// Maintain heap property
						for k := len(h) - 1; k > 0; k-- {
							parent := (k - 1) / 2
							if h[k].score < h[parent].score {
								h[k], h[parent] = h[parent], h[k]
							}
						}
					} else if score > h[0].score {
						h[0] = scored{index: j, score: score}
						// Sift down
						siftDown(&h, 0)
					}
				}
			}
		})
	}
}

// siftDown restores heap property from index i downward.
func siftDown(h *minHeap, i int) {
	n := len(*h)
	for {
		left := 2*i + 1
		right := 2*i + 2
		smallest := i
		if left < n && (*h)[left].score < (*h)[smallest].score {
			smallest = left
		}
		if right < n && (*h)[right].score < (*h)[smallest].score {
			smallest = right
		}
		if smallest == i {
			break
		}
		(*h)[i], (*h)[smallest] = (*h)[smallest], (*h)[i]
		i = smallest
	}
}

// ========== LOT 15: SIMD AVX2 Benchmarks ==========

// BenchmarkDotProduct_SIMD benchmarks AVX2 FMA dot product via CGo.
func BenchmarkDotProduct_SIMD(b *testing.B) {
	a := randomVector(384)
	q := randomVector(384)
	simdNormalize(a)
	simdNormalize(q)
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		simdDotProduct(a, q)
	}
}

// BenchmarkNormalize_SIMD benchmarks AVX2 L2 normalization via CGo.
func BenchmarkNormalize_SIMD(b *testing.B) {
	vectors := make([][]float32, b.N)
	for i := range vectors {
		vectors[i] = randomVector(384)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		simdNormalize(vectors[i])
	}
}

// BenchmarkBatchSearch_Go benchmarks the Go-only search pipeline (dotProduct per entry).
func BenchmarkBatchSearch_Go(b *testing.B) {
	for _, n := range []int{100, 500, 1000, 5000} {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			entries := make([][]float32, n)
			for i := range entries {
				entries[i] = randomVector(384)
				normalizeVector(entries[i])
			}
			query := randomVector(384)
			normalizeVector(query)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				for j := 0; j < n; j++ {
					dotProduct(query, entries[j])
				}
			}
		})
	}
}

// BenchmarkBatchSearch_SIMD benchmarks the SIMD batch pipeline (single CGo call).
func BenchmarkBatchSearch_SIMD(b *testing.B) {
	for _, n := range []int{100, 500, 1000, 5000} {
		b.Run(fmt.Sprintf("n=%d", n), func(b *testing.B) {
			// Build flat array like VectorCache does
			dim := 384
			flat := make([]float32, n*dim)
			for i := 0; i < n; i++ {
				v := randomVector(dim)
				simdNormalize(v)
				copy(flat[i*dim:], v)
			}
			query := randomVector(dim)
			simdNormalize(query)
			scores := make([]float32, n)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				simdBatchDot(query, flat, n, dim, scores)
			}
		})
	}
}

// BenchmarkSearchPipeline_SIMD simulates the full new SIMD pipeline: batch dot + min-heap top-K.
func BenchmarkSearchPipeline_SIMD(b *testing.B) {
	for _, n := range []int{100, 500, 1000} {
		b.Run(fmt.Sprintf("chunks=%d", n), func(b *testing.B) {
			dim := 384
			flat := make([]float32, n*dim)
			for i := 0; i < n; i++ {
				v := randomVector(dim)
				simdNormalize(v)
				copy(flat[i*dim:], v)
			}
			query := randomVector(dim)
			simdNormalize(query)
			scores := make([]float32, n)

			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				// SIMD batch dot (single CGo call)
				simdBatchDot(query, flat, n, dim, scores)

				// Min-heap top-5
				topK := 5
				if topK > n {
					topK = n
				}
				h := make(minHeap, 0, topK)
				for j := 0; j < n; j++ {
					if len(h) < topK {
						h = append(h, scored{index: j, score: scores[j]})
						for k := len(h) - 1; k > 0; k-- {
							parent := (k - 1) / 2
							if h[k].score < h[parent].score {
								h[k], h[parent] = h[parent], h[k]
							}
						}
					} else if scores[j] > h[0].score {
						h[0] = scored{index: j, score: scores[j]}
						siftDown(&h, 0)
					}
				}
			}
		})
	}
}

// ========== Utility: verify correctness ==========

func TestDotProductEquivalence(t *testing.T) {
	// Verify that dotProduct on normalized vectors ≈ cosineSimilarity
	a := randomVector(384)
	b := randomVector(384)

	cosine := cosineSimilarity(a, b)

	aN := make([]float32, len(a))
	bN := make([]float32, len(b))
	copy(aN, a)
	copy(bN, b)
	normalizeVector(aN)
	normalizeVector(bN)
	dot := dotProduct(aN, bN)

	diff := float64(cosine - dot)
	if math.Abs(diff) > 1e-5 {
		t.Errorf("cosine(%.6f) != dot(%.6f), diff=%.8f", cosine, dot, diff)
	}
}

// TestSIMDDotProductEquivalence verifies SIMD produces same results as pure Go.
func TestSIMDDotProductEquivalence(t *testing.T) {
	for trial := 0; trial < 100; trial++ {
		a := randomVector(384)
		b := randomVector(384)

		goResult := dotProduct(a, b)
		simdResult := simdDotProduct(a, b)

		diff := math.Abs(float64(goResult - simdResult))
		if diff > 1e-4 {
			t.Errorf("trial %d: Go=%.8f SIMD=%.8f diff=%.8f", trial, goResult, simdResult, diff)
		}
	}
}

// TestSIMDNormalizeEquivalence verifies SIMD normalize matches Go normalize.
func TestSIMDNormalizeEquivalence(t *testing.T) {
	for trial := 0; trial < 100; trial++ {
		v1 := randomVector(384)
		v2 := make([]float32, len(v1))
		copy(v2, v1)

		normalizeVector(v1)
		simdNormalize(v2)

		for i := range v1 {
			diff := math.Abs(float64(v1[i] - v2[i]))
			if diff > 1e-5 {
				t.Errorf("trial %d idx %d: Go=%.8f SIMD=%.8f diff=%.8f", trial, i, v1[i], v2[i], diff)
				break
			}
		}
	}
}

// TestSIMDBatchDotEquivalence verifies batch SIMD produces same results as per-entry Go dot.
func TestSIMDBatchDotEquivalence(t *testing.T) {
	n := 200
	dim := 384
	flat := make([]float32, n*dim)
	for i := 0; i < n; i++ {
		v := randomVector(dim)
		normalizeVector(v)
		copy(flat[i*dim:], v)
	}
	query := randomVector(dim)
	normalizeVector(query)

	// SIMD batch
	simdScores := make([]float32, n)
	simdBatchDot(query, flat, n, dim, simdScores)

	// Go per-entry
	for i := 0; i < n; i++ {
		goScore := dotProduct(query, flat[i*dim:(i+1)*dim])
		diff := math.Abs(float64(goScore - simdScores[i]))
		if diff > 1e-4 {
			t.Errorf("entry %d: Go=%.8f SIMD=%.8f diff=%.8f", i, goScore, simdScores[i], diff)
		}
	}
}
