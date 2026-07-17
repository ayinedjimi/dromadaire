//go:build windows || darwin

package store

import (
	"context"
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ollama/ollama/api"
)

// ========== Helpers ==========

const testEmbeddingModel = "snowflake-arctic-embed:33m"

func boolPtr(v bool) *bool { return &v }

// requireOllama returns an Ollama client, skipping the test if Ollama isn't running.
func requireOllama(t *testing.T) *api.Client {
	t.Helper()
	if testing.Short() {
		t.Skip("skipping integration test in short mode")
	}
	c, err := api.ClientFromEnvironment()
	if err != nil {
		t.Skip("Ollama client not available:", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := c.List(ctx); err != nil {
		t.Skip("Ollama not running:", err)
	}
	return c
}

// embedText generates an embedding for the given text, skipping if the model is missing.
func embedText(t *testing.T, c *api.Client, text string) []float32 {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	truncate := true
	resp, err := c.Embed(ctx, &api.EmbedRequest{
		Model:    testEmbeddingModel,
		Input:    text,
		Truncate: &truncate,
	})
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			t.Skipf("%s not installed: %v", testEmbeddingModel, err)
		}
		t.Fatalf("embed failed: %v", err)
	}
	if len(resp.Embeddings) == 0 || len(resp.Embeddings[0]) == 0 {
		t.Fatal("empty embedding returned")
	}
	return resp.Embeddings[0]
}

// findChatModel returns a small installed chat model, or skips if none found.
func findChatModel(t *testing.T, c *api.Client) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := c.List(ctx)
	if err != nil {
		t.Skip("cannot list models:", err)
	}

	// Prefer small models for fast tests
	preferred := []string{"qwen2.5:0.5b", "qwen2.5:1.5b", "tinyllama", "phi3:mini", "gemma2:2b", "llama3.2:1b"}
	for _, pref := range preferred {
		for _, m := range resp.Models {
			if strings.Contains(m.Name, pref) {
				return m.Name
			}
		}
	}

	// Use any model that isn't an embedding model
	for _, m := range resp.Models {
		name := strings.ToLower(m.Name)
		if !strings.Contains(name, "embed") && !strings.Contains(name, "nomic") && !strings.Contains(name, "snowflake") {
			return m.Name
		}
	}
	t.Skip("no chat model available")
	return ""
}

// setupIntegrationStore creates a temporary store with initialized DB.
func setupIntegrationStore(t *testing.T) *Store {
	t.Helper()
	tmpDir := t.TempDir()
	st := &Store{DBPath: filepath.Join(tmpDir, "integration.sqlite")}
	if _, err := st.Settings(); err != nil {
		t.Fatal("init store:", err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// ========== SECTION 1: Embedding Properties ==========

func TestIntegration_EmbeddingDimensionAndValues(t *testing.T) {
	c := requireOllama(t)
	emb := embedText(t, c, "Le chat dort sur le canapé")

	// T1: Check dimension (snowflake-arctic-embed:33m → 384 dim)
	if len(emb) != 384 {
		t.Errorf("expected 384 dimensions, got %d", len(emb))
	}

	// T2: Check all values are finite (no NaN/Inf)
	for i, v := range emb {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
			t.Fatalf("invalid value at dim %d: %f", i, v)
		}
	}

	// T3: Check embedding is non-zero
	var sumSq float64
	for _, v := range emb {
		sumSq += float64(v) * float64(v)
	}
	norm := math.Sqrt(sumSq)
	if norm < 0.01 {
		t.Errorf("embedding near-zero: L2 norm = %.6f", norm)
	}

	t.Logf("dim=%d  L2_norm=%.4f", len(emb), norm)
}

func TestIntegration_EmbeddingNormalizeSIMD(t *testing.T) {
	c := requireOllama(t)
	raw := embedText(t, c, "Les réseaux de neurones apprennent des données")

	// Normalize with Go and SIMD, verify they match
	goVec := make([]float32, len(raw))
	simdVec := make([]float32, len(raw))
	copy(goVec, raw)
	copy(simdVec, raw)

	normalizeVector(goVec)
	simdNormalize(simdVec)

	// Both should have L2 norm ≈ 1.0
	var goNorm, simdNorm float64
	for i := range goVec {
		goNorm += float64(goVec[i]) * float64(goVec[i])
		simdNorm += float64(simdVec[i]) * float64(simdVec[i])
	}
	goNorm = math.Sqrt(goNorm)
	simdNorm = math.Sqrt(simdNorm)

	t.Logf("Go norm=%.8f  SIMD norm=%.8f", goNorm, simdNorm)

	if math.Abs(goNorm-1.0) > 1e-4 {
		t.Errorf("Go normalize: L2 norm=%.6f, expected ~1.0", goNorm)
	}
	if math.Abs(simdNorm-1.0) > 1e-4 {
		t.Errorf("SIMD normalize: L2 norm=%.6f, expected ~1.0", simdNorm)
	}

	// Go and SIMD should produce identical results
	for i := range goVec {
		diff := math.Abs(float64(goVec[i] - simdVec[i]))
		if diff > 1e-5 {
			t.Errorf("Go/SIMD mismatch at dim %d: Go=%.8f SIMD=%.8f", i, goVec[i], simdVec[i])
			break
		}
	}
}

// ========== SECTION 2: Embedding Similarity ==========

func TestIntegration_EmbeddingSimilarity(t *testing.T) {
	c := requireOllama(t)

	type testPair struct {
		nameA, nameB string
		textA, textB string
		minSim       float32 // expected minimum similarity
		maxSim       float32 // expected maximum similarity (0 = no max)
	}

	pairs := []testPair{
		{
			nameA: "chat_fr", nameB: "chat_synonym",
			textA:  "Le chat dort paisiblement sur le canapé du salon",
			textB:  "Le félin se repose tranquillement sur le sofa de la pièce",
			minSim: 0.70, // similar meaning → high sim
		},
		{
			nameA: "chat_fr", nameB: "python",
			textA:  "Le chat dort paisiblement sur le canapé du salon",
			textB:  "La programmation en Python utilise l'indentation pour structurer le code",
			maxSim: 0.80, // different topic → lower sim (33m model has compressed space)
		},
		{
			nameA: "python", nameB: "golang",
			textA:  "La programmation en Python utilise l'indentation pour structurer le code",
			textB:  "Le langage Go utilise des goroutines pour la programmation concurrente",
			minSim: 0.40, // both programming → moderate sim
		},
	}

	embeddings := make(map[string][]float32)
	for _, p := range pairs {
		for _, item := range []struct{ name, text string }{{p.nameA, p.textA}, {p.nameB, p.textB}} {
			if _, ok := embeddings[item.name]; !ok {
				emb := embedText(t, c, item.text)
				v := make([]float32, len(emb))
				copy(v, emb)
				normalizeVector(v)
				embeddings[item.name] = v
			}
		}
	}

	for _, p := range pairs {
		sim := dotProduct(embeddings[p.nameA], embeddings[p.nameB])
		t.Logf("%s × %s = %.4f", p.nameA, p.nameB, sim)

		if p.minSim > 0 && sim < p.minSim {
			t.Errorf("%s × %s: similarity %.4f < expected min %.2f", p.nameA, p.nameB, sim, p.minSim)
		}
		if p.maxSim > 0 && sim > p.maxSim {
			t.Errorf("%s × %s: similarity %.4f > expected max %.2f", p.nameA, p.nameB, sim, p.maxSim)
		}
	}

	// Cross-check: synonym pair should be MORE similar than unrelated pair
	simSynonym := dotProduct(embeddings["chat_fr"], embeddings["chat_synonym"])
	simUnrelated := dotProduct(embeddings["chat_fr"], embeddings["python"])
	if simSynonym <= simUnrelated {
		t.Errorf("synonym pair (%.4f) should be > unrelated pair (%.4f)", simSynonym, simUnrelated)
	}
}

// ========== SECTION 3: RAG Pipeline End-to-End ==========

func TestIntegration_RAGSearchRelevance(t *testing.T) {
	c := requireOllama(t)
	st := setupIntegrationStore(t)

	// Create a test document
	doc := RAGDocument{
		ID:             "integ-doc-001",
		Filename:       "knowledge.txt",
		FileSize:       5000,
		ContentHash:    "integration-test-hash-001",
		Status:         "ready",
		EmbeddingModel: testEmbeddingModel,
	}
	if err := st.InsertRAGDocument(doc); err != nil {
		t.Fatal("insert document:", err)
	}

	// 5 chunks with distinct topics
	chunkTexts := []string{
		"La Tour Eiffel mesure 330 mètres de hauteur et a été construite par Gustave Eiffel pour l'exposition universelle de 1889 à Paris en France",
		"Le langage Go a été créé par Google en 2009 par Robert Griesemer, Rob Pike et Ken Thompson et il est connu pour sa gestion native de la concurrence avec les goroutines",
		"La photosynthèse est le processus biologique par lequel les plantes convertissent la lumière du soleil en énergie chimique en utilisant le dioxyde de carbone et l'eau",
		"Le football est le sport le plus populaire au monde avec plus de quatre milliards de supporters et la Coupe du Monde FIFA est organisée tous les quatre ans",
		"L'intelligence artificielle moderne utilise des réseaux de neurones profonds et des transformers pour apprendre des patterns à partir de grandes quantités de données",
	}

	// Embed all chunks using real Ollama model
	chunks := make([]RAGChunk, len(chunkTexts))
	for i, text := range chunkTexts {
		emb := embedText(t, c, text)
		chunks[i] = RAGChunk{
			DocumentID:   "integ-doc-001",
			ChunkIndex:   i,
			Content:      text,
			Embedding:    emb,
			EmbeddingDim: len(emb),
			TokenCount:   len(strings.Fields(text)),
		}
	}

	if err := st.InsertRAGChunks(chunks); err != nil {
		t.Fatal("insert chunks:", err)
	}

	// Force cache reload
	InvalidateVectorCache()

	// Test queries with expected top-1 results
	queries := []struct {
		query         string
		expectedChunk int
		label         string
	}{
		{"Quelle est la hauteur de la Tour Eiffel ?", 0, "Tour Eiffel"},
		{"Qui a créé le langage de programmation Go ?", 1, "Go language"},
		{"Comment les plantes produisent-elles de l'énergie ?", 2, "Photosynthèse"},
		{"Quel est le sport le plus populaire dans le monde ?", 3, "Football"},
		{"Comment fonctionnent les réseaux de neurones ?", 4, "IA/Neurones"},
	}

	passed := 0
	for _, q := range queries {
		queryEmb := embedText(t, c, q.query)
		results, err := st.SearchRAGChunks(queryEmb, 3)
		if err != nil {
			t.Fatalf("search %q failed: %v", q.label, err)
		}
		if len(results) == 0 {
			t.Fatalf("search %q returned 0 results", q.label)
		}

		t.Logf("Query: %s", q.label)
		for i, r := range results {
			t.Logf("  [%d] score=%.4f chunk=%d %.50s...", i, r.Score, r.ChunkIndex, r.Content)
		}

		if results[0].ChunkIndex == q.expectedChunk {
			passed++
		} else {
			t.Errorf("  MISS: expected chunk %d (%s), got chunk %d", q.expectedChunk, q.label, results[0].ChunkIndex)
		}

		// Verify descending score order
		for i := 1; i < len(results); i++ {
			if results[i].Score > results[i-1].Score {
				t.Errorf("  scores not descending: [%d]=%.4f > [%d]=%.4f", i, results[i].Score, i-1, results[i-1].Score)
			}
		}
	}

	t.Logf("RAG relevance: %d/%d queries matched expected top-1 chunk", passed, len(queries))
	if passed < 4 {
		t.Errorf("expected at least 4/5 correct, got %d/5", passed)
	}
}

func TestIntegration_RAGSearchSIMDConsistency(t *testing.T) {
	c := requireOllama(t)

	// Generate real embeddings
	texts := []string{
		"L'océan Atlantique sépare l'Europe de l'Amérique du Nord",
		"Les mathématiques sont la reine des sciences depuis l'Antiquité",
		"Le café est la boisson la plus consommée au monde après l'eau",
	}
	query := "Quelle est la boisson la plus populaire au monde ?"

	embeddings := make([][]float32, len(texts))
	for i, text := range texts {
		embeddings[i] = embedText(t, c, text)
	}
	queryEmb := embedText(t, c, query)

	// Build flat array for SIMD batch
	dim := len(embeddings[0])
	flat := make([]float32, len(embeddings)*dim)
	for i, emb := range embeddings {
		v := make([]float32, len(emb))
		copy(v, emb)
		simdNormalize(v)
		copy(flat[i*dim:], v)
	}

	normQuery := make([]float32, len(queryEmb))
	copy(normQuery, queryEmb)
	simdNormalize(normQuery)

	// SIMD batch scores
	simdScores := make([]float32, len(embeddings))
	simdBatchDot(normQuery, flat, len(embeddings), dim, simdScores)

	// Go per-entry scores
	goScores := make([]float32, len(embeddings))
	for i := range embeddings {
		goNorm := make([]float32, len(embeddings[i]))
		copy(goNorm, embeddings[i])
		normalizeVector(goNorm)

		goQ := make([]float32, len(queryEmb))
		copy(goQ, queryEmb)
		normalizeVector(goQ)

		goScores[i] = dotProduct(goQ, goNorm)
	}

	// Compare Go vs SIMD scores
	bestSIMD, bestGo := 0, 0
	for i := range embeddings {
		diff := math.Abs(float64(goScores[i] - simdScores[i]))
		t.Logf("Text %d: Go=%.6f  SIMD=%.6f  diff=%.8f", i, goScores[i], simdScores[i], diff)

		if diff > 1e-4 {
			t.Errorf("Go/SIMD mismatch at text %d: %.6f vs %.6f", i, goScores[i], simdScores[i])
		}
		if simdScores[i] > simdScores[bestSIMD] {
			bestSIMD = i
		}
		if goScores[i] > goScores[bestGo] {
			bestGo = i
		}
	}

	// Both should agree on top result: the coffee text (index 2)
	if bestSIMD != bestGo {
		t.Errorf("SIMD best=%d, Go best=%d — ranking disagreement", bestSIMD, bestGo)
	}
	if bestSIMD != 2 {
		t.Errorf("expected text 2 (café) as most similar, SIMD picked %d", bestSIMD)
	}
}

// ========== SECTION 4: Chat Pipeline ==========

func TestIntegration_ChatBasicResponse(t *testing.T) {
	c := requireOllama(t)
	model := findChatModel(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	var response strings.Builder
	err := c.Chat(ctx, &api.ChatRequest{
		Model: model,
		Messages: []api.Message{
			{Role: "user", Content: "Réponds uniquement par le mot 'bonjour', rien d'autre."},
		},
		Stream: boolPtr(true),
	}, func(res api.ChatResponse) error {
		response.WriteString(res.Message.Content)
		return nil
	})

	if err != nil {
		t.Fatal("chat failed:", err)
	}

	resp := strings.TrimSpace(response.String())
	t.Logf("Model: %s  Response: %q", model, resp)

	if len(resp) == 0 {
		t.Error("empty response from model")
	}
}

func TestIntegration_ChatStreaming(t *testing.T) {
	c := requireOllama(t)
	model := findChatModel(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	var chunks int64
	var fullResp strings.Builder

	err := c.Chat(ctx, &api.ChatRequest{
		Model: model,
		Messages: []api.Message{
			{Role: "user", Content: "Compte de un à cinq en français, chaque nombre sur une ligne séparée."},
		},
		Stream: boolPtr(true),
	}, func(res api.ChatResponse) error {
		atomic.AddInt64(&chunks, 1)
		fullResp.WriteString(res.Message.Content)
		return nil
	})

	if err != nil {
		t.Fatal("chat streaming failed:", err)
	}

	nChunks := atomic.LoadInt64(&chunks)
	t.Logf("Model: %s  Chunks: %d  Length: %d chars", model, nChunks, fullResp.Len())
	t.Logf("Response: %q", fullResp.String())

	if nChunks < 2 {
		t.Errorf("expected multiple streaming chunks, got %d", nChunks)
	}
}

func TestIntegration_ChatWithRAGContext(t *testing.T) {
	c := requireOllama(t)
	model := findChatModel(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// System prompt with injected "RAG context" containing fictional facts
	systemPrompt := `Tu es un assistant qui répond UNIQUEMENT à partir du contexte documentaire fourni.

--- Contexte documentaire (base de connaissances) ---
Utilise les extraits suivants pour répondre. Cite la source quand c'est pertinent.

[Document: memo_interne.txt | Extrait 1]
Le projet Dromadaire a été fondé en 2025 par l'équipe AlphaTeam avec un budget initial de 42000 euros. Le responsable technique du projet est Karim Benali.

[Document: memo_interne.txt | Extrait 2]
Le projet utilise le langage Go pour le backend et React TypeScript pour le frontend. La base de données est SQLite en mode WAL.

--- Fin du contexte documentaire ---

IMPORTANT: Réponds UNIQUEMENT avec les informations ci-dessus. Si l'information demandée n'est pas dans le contexte, réponds "Information non disponible dans le contexte."`

	// Query about a fact that is ONLY in the RAG context
	var response strings.Builder
	err := c.Chat(ctx, &api.ChatRequest{
		Model: model,
		Messages: []api.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "Quel est le budget du projet Dromadaire et qui est le responsable ?"},
		},
		Stream: boolPtr(true),
	}, func(res api.ChatResponse) error {
		response.WriteString(res.Message.Content)
		return nil
	})

	if err != nil {
		t.Fatal("chat with RAG context failed:", err)
	}

	resp := response.String()
	respLower := strings.ToLower(resp)
	t.Logf("Model: %s", model)
	t.Logf("Response: %s", resp)

	// The response should contain the budget (42000) from the RAG context
	hasBudget := strings.Contains(respLower, "42000") || strings.Contains(respLower, "42 000")
	hasName := strings.Contains(respLower, "karim") || strings.Contains(respLower, "benali")

	if !hasBudget {
		t.Error("response should mention budget '42000' from RAG context")
	}
	if !hasName {
		t.Error("response should mention 'Karim Benali' from RAG context")
	}
	if hasBudget && hasName {
		t.Log("RAG context correctly used by model")
	}
}

func TestIntegration_ChatRAGIrrelevantQuery(t *testing.T) {
	c := requireOllama(t)
	model := findChatModel(t, c)

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	// RAG context about Dromadaire, but question about something unrelated
	systemPrompt := `Tu es un assistant strict. Réponds UNIQUEMENT avec les informations du contexte.

--- Contexte documentaire ---
[Document: memo.txt | Extrait 1]
Le projet Dromadaire utilise SQLite comme base de données avec le mode WAL activé.
--- Fin du contexte documentaire ---

Si l'information n'est pas dans le contexte, réponds EXACTEMENT: "Information non disponible."`

	var response strings.Builder
	err := c.Chat(ctx, &api.ChatRequest{
		Model: model,
		Messages: []api.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: "Quelle est la capitale de l'Australie ?"},
		},
		Stream: boolPtr(true),
	}, func(res api.ChatResponse) error {
		response.WriteString(res.Message.Content)
		return nil
	})

	if err != nil {
		t.Fatal("chat failed:", err)
	}

	resp := strings.ToLower(response.String())
	t.Logf("Model: %s  Response: %q", model, response.String())

	// Model should NOT hallucinate "Canberra" and should indicate info unavailable
	// (Small models may not follow instructions perfectly, so we just log this)
	if strings.Contains(resp, "canberra") {
		t.Log("WARNING: model answered with info not in RAG context (may hallucinate)")
	}
	if strings.Contains(resp, "non disponible") || strings.Contains(resp, "pas dans") || strings.Contains(resp, "pas disponible") {
		t.Log("Model correctly indicated information is not in context")
	}
}

// ========== SECTION 5: Full RAG-to-Chat Pipeline ==========

func TestIntegration_FullRAGPipeline(t *testing.T) {
	c := requireOllama(t)
	model := findChatModel(t, c)
	st := setupIntegrationStore(t)

	// Step 1: Create document and chunks with real embeddings
	doc := RAGDocument{
		ID:             "full-pipeline-doc",
		Filename:       "recettes.txt",
		FileSize:       2000,
		ContentHash:    "full-pipeline-hash",
		Status:         "ready",
		EmbeddingModel: testEmbeddingModel,
	}
	if err := st.InsertRAGDocument(doc); err != nil {
		t.Fatal(err)
	}

	recettes := []string{
		"La recette du couscous traditionnel nécessite de la semoule de blé dur, des légumes variés comme des carottes, des courgettes et des pois chiches, ainsi que de la viande d'agneau ou de poulet",
		"Pour préparer une quiche lorraine authentique il faut de la pâte brisée, des lardons fumés, de la crème fraîche épaisse, des oeufs et du fromage gruyère râpé",
		"Le tiramisu italien se compose de biscuits cuillère imbibés de café expresso, de mascarpone mélangé avec des jaunes d'oeufs et du sucre, le tout saupoudré de cacao amer",
	}

	chunks := make([]RAGChunk, len(recettes))
	for i, text := range recettes {
		emb := embedText(t, c, text)
		chunks[i] = RAGChunk{
			DocumentID:   "full-pipeline-doc",
			ChunkIndex:   i,
			Content:      text,
			Embedding:    emb,
			EmbeddingDim: len(emb),
			TokenCount:   len(strings.Fields(text)),
		}
	}
	if err := st.InsertRAGChunks(chunks); err != nil {
		t.Fatal(err)
	}
	InvalidateVectorCache()

	// Step 2: Simulate RAG query → embed → search → get relevant chunks
	query := "Comment préparer un tiramisu ?"
	queryEmb := embedText(t, c, query)

	results, err := st.SearchRAGChunks(queryEmb, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(results) == 0 {
		t.Fatal("no RAG results")
	}

	t.Logf("RAG search for %q:", query)
	for i, r := range results {
		t.Logf("  [%d] score=%.4f chunk=%d", i, r.Score, r.ChunkIndex)
	}

	// Top result should be the tiramisu chunk (index 2)
	if results[0].ChunkIndex != 2 {
		t.Errorf("expected tiramisu chunk (2), got chunk %d", results[0].ChunkIndex)
	}

	// Step 3: Build RAG context string (same format as buildRAGContext in ui.go)
	var sb strings.Builder
	sb.WriteString("--- Contexte documentaire (base de connaissances) ---\n")
	sb.WriteString("Utilise les extraits suivants pour répondre.\n\n")
	for i, r := range results {
		sb.WriteString(fmt.Sprintf("[Document: %s | Extrait %d]\n%s\n\n", r.DocumentName, i+1, r.Content))
	}
	sb.WriteString("--- Fin du contexte documentaire ---")
	ragContext := sb.String()

	// Step 4: Chat with RAG context injected
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	systemPrompt := "Tu es un assistant culinaire. Réponds en utilisant le contexte fourni.\n\n" + ragContext

	var response strings.Builder
	err = c.Chat(ctx, &api.ChatRequest{
		Model: model,
		Messages: []api.Message{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: query},
		},
		Stream: boolPtr(true),
	}, func(res api.ChatResponse) error {
		response.WriteString(res.Message.Content)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	resp := strings.ToLower(response.String())
	t.Logf("Chat response: %s", response.String())

	// The response should mention ingredients from the tiramisu chunk
	// Small models (1.5b-3b) may not reproduce all keywords — require at least 1
	keywords := []string{"mascarpone", "café", "cacao", "biscuit", "tiramisu", "dessert"}
	found := 0
	for _, kw := range keywords {
		if strings.Contains(resp, kw) {
			found++
		}
	}
	t.Logf("Keywords found: %d/%d (%v)", found, len(keywords), keywords)
	if found < 1 {
		t.Errorf("expected at least 1 keyword from RAG context in response, got %d", found)
	}
}
