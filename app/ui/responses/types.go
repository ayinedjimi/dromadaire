//go:build windows || darwin

package responses

import (
	"time"

	"github.com/ollama/ollama/app/store"
	"github.com/ollama/ollama/types/model"
)

type ChatInfo struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	UserExcerpt string    `json:"userExcerpt"`
	CreatedAt   time.Time `json:"createdAt" ts_type:"Date" ts_transform:"new Date(__VALUE__)"`
	UpdatedAt   time.Time `json:"updatedAt" ts_type:"Date" ts_transform:"new Date(__VALUE__)"`
	Pinned        bool      `json:"pinned"`
	Folder        string    `json:"folder"`
	MessageCount  int       `json:"messageCount"`
	TokenEstimate int       `json:"tokenEstimate"`
}

type ChatsResponse struct {
	ChatInfos []ChatInfo `json:"chatInfos"`
}

type ChatResponse struct {
	Chat store.Chat `json:"chat"`
}

type Model struct {
	Model      string     `json:"model"`
	Digest     string     `json:"digest,omitempty"`
	ModifiedAt *time.Time `json:"modified_at,omitempty"`
}

type ModelsResponse struct {
	Models []Model `json:"models"`
}

type InferenceCompute struct {
	Library string `json:"library"`
	Variant string `json:"variant"`
	Compute string `json:"compute"`
	Driver  string `json:"driver"`
	Name    string `json:"name"`
	VRAM    string `json:"vram"`
}

type InferenceComputeResponse struct {
	InferenceComputes    []InferenceCompute `json:"inferenceComputes"`
	DefaultContextLength int                `json:"defaultContextLength"`
}

type ModelCapabilitiesResponse struct {
	Capabilities []model.Capability `json:"capabilities"`
}

// ChatEvent is for regular chat messages and assistant interactions
type ChatEvent struct {
	EventName string `json:"eventName" ts_type:"\"chat\" | \"thinking\" | \"assistant_with_tools\" | \"tool_call\" | \"tool\" | \"tool_result\" | \"tool_approval\" | \"done\" | \"chat_created\" | \"loading\" | \"rag_sources\""`

	// Chat/Assistant message fields
	Content           *string    `json:"content,omitempty"`
	Thinking          *string    `json:"thinking,omitempty"`
	ThinkingTimeStart *time.Time `json:"thinkingTimeStart,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`
	ThinkingTimeEnd   *time.Time `json:"thinkingTimeEnd,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`

	// Tool-related fields
	ToolCalls      []store.ToolCall `json:"toolCalls,omitempty"`
	ToolCall       *store.ToolCall  `json:"toolCall,omitempty"`
	ToolName       *string          `json:"toolName,omitempty"`
	ToolResult     *bool            `json:"toolResult,omitempty"`
	ToolResultData any              `json:"toolResultData,omitempty"`

	// Chat creation fields
	ChatID *string `json:"chatId,omitempty"`

	// Tool state field from the new code
	ToolState any `json:"toolState,omitempty"`

	// Generation info (sent with "done" event)
	EvalCount          *int     `json:"evalCount,omitempty"`
	EvalDurationMs     *float64 `json:"evalDurationMs,omitempty"`
	PromptEvalCount    *int     `json:"promptEvalCount,omitempty"`
	PromptEvalDurationMs *float64 `json:"promptEvalDurationMs,omitempty"`
	TokensPerSecond    *float64 `json:"tokensPerSecond,omitempty"`
}

// DownloadEvent is for model download progress
type DownloadEvent struct {
	EventName string `json:"eventName" ts_type:"\"download\""`
	Total     int64  `json:"total" ts_type:"number"`
	Completed int64  `json:"completed" ts_type:"number"`
	Done      bool   `json:"done" ts_type:"boolean"`
}

// ErrorEvent is for error messages
type ErrorEvent struct {
	EventName string `json:"eventName" ts_type:"\"error\""`
	Error     string `json:"error"`
	Code      string `json:"code,omitempty"`    // Optional error code for different error types
	Details   string `json:"details,omitempty"` // Optional additional details
}

type SettingsResponse struct {
	Settings store.Settings `json:"settings"`
}

type HealthResponse struct {
	Healthy bool `json:"healthy"`
}

type User struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	Bio       string `json:"bio,omitempty"`
	AvatarURL string `json:"avatarurl,omitempty"`
	FirstName string `json:"firstname,omitempty"`
	LastName  string `json:"lastname,omitempty"`
	Plan      string `json:"plan,omitempty"`
}

type Attachment struct {
	Filename string `json:"filename"`
	Data     string `json:"data,omitempty"` // omitempty = optional, no data = existing file reference
}

type ChatRequest struct {
	Model       string       `json:"model"`
	Prompt      string       `json:"prompt"`
	Index       *int         `json:"index,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
	WebSearch   *bool        `json:"web_search,omitempty"`
	FileTools   *bool        `json:"file_tools,omitempty"`
	ForceUpdate bool         `json:"forceUpdate,omitempty"`
	Think       any          `json:"think,omitempty"`
	Format      any          `json:"format,omitempty"`
	Temperature      *float64 `json:"temperature,omitempty"`
	TopP             *float64 `json:"top_p,omitempty"`
	NumPredict       *int     `json:"num_predict,omitempty"`
	TopK             *int     `json:"top_k,omitempty"`
	MinP             *float64 `json:"min_p,omitempty"`
	TypicalP         *float64 `json:"typical_p,omitempty"`
	RepeatPenalty    *float64 `json:"repeat_penalty,omitempty"`
	RepeatLastN      *int     `json:"repeat_last_n,omitempty"`
	FrequencyPenalty *float64 `json:"frequency_penalty,omitempty"`
	PresencePenalty  *float64 `json:"presence_penalty,omitempty"`
	Seed             *int      `json:"seed,omitempty"`
	FlashAttn        *bool     `json:"flash_attn,omitempty"`
	CacheTypeK       *string   `json:"cache_type_k,omitempty"`
	CacheTypeV       *string   `json:"cache_type_v,omitempty"`
	Stop             []string  `json:"stop,omitempty"`
	NumGPU             *int      `json:"num_gpu,omitempty"`
	NumCtx             *int      `json:"num_ctx,omitempty"`
	NumThread          *int      `json:"num_thread,omitempty"`
	NumBatch           *int      `json:"num_batch,omitempty"`
	UseMlock           *bool     `json:"use_mlock,omitempty"`
	RopeFrequencyBase  *float64  `json:"rope_frequency_base,omitempty"`
	RopeFrequencyScale *float64            `json:"rope_frequency_scale,omitempty"`
	LogitBias          map[string]float64  `json:"logit_bias,omitempty"`
}

type Error struct {
	Error string `json:"error"`
}

// SystemMetrics exposes runtime metrics for the monitoring widget (LOT 42)
type SystemMetrics struct {
	MemoryUsedMB  int     `json:"memory_used_mb"`
	MemoryTotalMB int     `json:"memory_total_mb"`
	MemoryPercent float64 `json:"memory_percent"`
	Goroutines    int     `json:"goroutines"`
	UptimeSeconds int64   `json:"uptime_seconds"`
	HeapAllocMB   int     `json:"heap_alloc_mb"`
}

type ModelUpstreamResponse struct {
	Stale bool   `json:"stale"`
	Error string `json:"error,omitempty"`
}

// Serializable data for the browser state
type BrowserStateData struct {
	PageStack  []string         `json:"page_stack"`  // Sequential list of page URLs
	ViewTokens int              `json:"view_tokens"` // Number of tokens to show in viewport
	URLToPage  map[string]*Page `json:"url_to_page"` // URL to page contents
}

// Page represents the contents of a page
type Page struct {
	URL       string         `json:"url"`
	Title     string         `json:"title"`
	Text      string         `json:"text"`
	Lines     []string       `json:"lines"`
	Links     map[int]string `json:"links,omitempty" ts_type:"Record<number, string>"`
	FetchedAt time.Time      `json:"fetched_at"`
}

// SearchResponse wraps conversation search results
type SearchResponse struct {
	Results []store.SearchResult `json:"results"`
}

// BranchRequest is the payload for branching a chat at a specific message
type BranchRequest struct {
	MessageIndex int `json:"messageIndex"`
}

// BranchResponse returns the new chat ID after branching
type BranchResponse struct {
	ChatID string `json:"chatId"`
}
