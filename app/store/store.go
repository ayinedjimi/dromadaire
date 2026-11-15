//go:build windows || darwin

// Package store provides a simple JSON file store for the desktop application
// to save and load data such as ollama server configuration, messages,
// login information and more.
package store

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/ollama/ollama/app/types/not"
)

type File struct {
	Filename string `json:"filename"`
	Data     []byte `json:"data"`
}

type User struct {
	Name     string    `json:"name"`
	Email    string    `json:"email"`
	Plan     string    `json:"plan"`
	CachedAt time.Time `json:"cachedAt"`
}

type Message struct {
	Role              string           `json:"role"`
	Content           string           `json:"content"`
	Thinking          string           `json:"thinking"`
	Stream            bool             `json:"stream"`
	Model             string           `json:"model,omitempty"`
	Attachments       []File           `json:"attachments,omitempty"`
	ToolCalls         []ToolCall       `json:"tool_calls,omitempty"`
	ToolCall          *ToolCall        `json:"tool_call,omitempty"`
	ToolName          string           `json:"tool_name,omitempty"`
	ToolResult        *json.RawMessage `json:"tool_result,omitempty"`
	CreatedAt         time.Time        `json:"created_at"`
	UpdatedAt         time.Time        `json:"updated_at"`
	ThinkingTimeStart *time.Time       `json:"thinkingTimeStart,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`
	ThinkingTimeEnd   *time.Time       `json:"thinkingTimeEnd,omitempty" ts_type:"Date | undefined" ts_transform:"__VALUE__ && new Date(__VALUE__)"`
}

type MessageOptions struct {
	Model             string
	Attachments       []File
	Stream            bool
	Thinking          string
	ToolCalls         []ToolCall
	ToolCall          *ToolCall
	ToolResult        *json.RawMessage
	ThinkingTimeStart *time.Time
	ThinkingTimeEnd   *time.Time
}

func NewMessage(role, content string, opts *MessageOptions) Message {
	now := time.Now()
	msg := Message{
		Role:      role,
		Content:   content,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if opts != nil {
		msg.Model = opts.Model
		msg.Attachments = opts.Attachments
		msg.Stream = opts.Stream
		msg.Thinking = opts.Thinking
		msg.ToolCalls = opts.ToolCalls
		msg.ToolCall = opts.ToolCall
		msg.ToolResult = opts.ToolResult
		msg.ThinkingTimeStart = opts.ThinkingTimeStart
		msg.ThinkingTimeEnd = opts.ThinkingTimeEnd
	}

	return msg
}

type ToolCall struct {
	Type     string       `json:"type"`
	Function ToolFunction `json:"function"`
}

type ToolFunction struct {
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Result    any    `json:"result,omitempty"`
}

type Model struct {
	Model      string     `json:"model"`
	Digest     string     `json:"digest,omitempty"`
	ModifiedAt *time.Time `json:"modified_at,omitempty"`
}

type Chat struct {
	ID           string          `json:"id"`
	Messages     []Message       `json:"messages"`
	Title        string          `json:"title"`
	CreatedAt    time.Time       `json:"created_at"`
	BrowserState json.RawMessage `json:"browser_state,omitempty" ts_type:"BrowserStateData"`
	Pinned       bool            `json:"pinned"`
	Folder       string          `json:"folder,omitempty"`
}

func NewChat(id string) *Chat {
	return &Chat{
		ID:        id,
		Messages:  []Message{},
		CreatedAt: time.Now(),
	}
}

type Settings struct {
	Expose bool
	Browser bool
	Survey bool
	Models string

	Agent bool
	Tools bool
	WorkingDir string

	ContextLength int

	AirplaneMode bool

	TurboEnabled bool

	WebSearchEnabled bool

	ThinkEnabled bool
	ThinkLevel string

	SelectedModel string

	SidebarOpen bool

	LastHomeView string

	AutoUpdateEnabled bool

	EncryptionEnabled bool

	RAGEnabled bool
	EmbeddingModel string

	PasswordEnabled bool
	PasswordHash string `json:"-"`
	AutoDeleteOnFailure bool

	LockTimeoutMinutes int
	AutoDeleteDays int
	ClipboardClearSeconds int

	SearchEnabled bool

	RAGCitationsEnabled bool
	RAGPreviewEnabled bool

	ArtifactsEnabled bool

	Theme string

	KeyboardShortcutsEnabled bool

	NumThread       int
	KeepAlive       string
	MaxLoadedModels int
	KVCacheType     string
	NumBatch        int
	UseMlock        bool
	RopeFrequencyBase  float64
	RopeFrequencyScale float64

	VulkanEnabled bool
	NumParallel   int
	// LamazeroEngine selects the CPU engine for lamazero/ models: "auto" (default), "official" or "turbo".
	LamazeroEngine string
	// LamazeroKVCache is the KV cache type of the CPU engine: "f16" (default), "turbo3" or "turbo4".
	LamazeroKVCache string

	ResponseMode string
	SystemPrompt string

	HumanSubMode string
	WritingStyleRules string
	StyleAnalysisModel string

	RAGAffinityThreshold float64
	RAGRetrievalLimit    int

	ChatFullWidth    bool
	AutoTitleEnabled bool
	ShowTokenCount   bool

	ContextOverflowPolicy string

	SidebarWidth      int
	ContextPanelWidth int

	PortableMode bool `json:",omitempty"`
}

type SearchResult struct {
	ChatID    string    `json:"chat_id"`
	ChatTitle string    `json:"chat_title"`
	Role      string    `json:"role"`
	Excerpt   string    `json:"excerpt"`
	CreatedAt time.Time `json:"created_at"`
}

type Store struct {
	DBPath string

	dbMu sync.Mutex
	db   *database

	encKey   []byte
	encKeyMu sync.Mutex
}

func (s *Store) KeyPath() string {
	return KeyPathForDB(s.DBPath)
}

var defaultDBPath = func() string {
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "Ollama", "db.sqlite")
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Ollama", "db.sqlite")
	default:
		return filepath.Join(os.Getenv("HOME"), ".ollama", "db.sqlite")
	}
}()

var legacyConfigPath = func() string {
	switch runtime.GOOS {
	case "windows":
		return filepath.Join(os.Getenv("LOCALAPPDATA"), "Ollama", "config.json")
	case "darwin":
		return filepath.Join(os.Getenv("HOME"), "Library", "Application Support", "Ollama", "config.json")
	default:
		return filepath.Join(os.Getenv("HOME"), ".ollama", "config.json")
	}
}()

type legacyData struct {
	ID           string `json:"id"`
	FirstTimeRun bool   `json:"first-time-run"`
}

func (s *Store) ensureDB() error {
	if s.db != nil {
		return nil
	}

	s.dbMu.Lock()
	defer s.dbMu.Unlock()

	if s.db != nil {
		return nil
	}

	dbPath := s.DBPath
	if dbPath == "" {
		dbPath = defaultDBPath
	}

	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return fmt.Errorf("create db directory: %w", err)
	}

	database, err := newDatabase(dbPath)
	if err != nil {
		return fmt.Errorf("open database: %w", err)
	}

	id, err := database.getID()
	if err != nil || id == "" {
		u, err := uuid.NewV7()
		if err == nil {
			database.setID(u.String())
		}
	}

	s.db = database

	migrated, err := database.isConfigMigrated()
	if err != nil || !migrated {
		if err := s.migrateFromConfig(database); err != nil {
			slog.Warn("failed to migrate from config.json", "error", err)
		}
	}

	if err := s.migrateCloudSetting(database); err != nil {
		return fmt.Errorf("migrate cloud setting: %w", err)
	}

	return nil
}

func (s *Store) migrateCloudSetting(database *database) error {
	migrated, err := database.isCloudSettingMigrated()
	if err != nil {
		return err
	}
	if migrated {
		return nil
	}

	airplaneMode, err := database.getAirplaneMode()
	if err != nil {
		return err
	}

	if airplaneMode {
		if err := setCloudEnabled(false); err != nil {
			return fmt.Errorf("migrate airplane_mode to cloud disabled: %w", err)
		}
	}

	if err := database.setCloudSettingMigrated(true); err != nil {
		return err
	}

	return nil
}

func (s *Store) migrateFromConfig(database *database) error {
	configPath := legacyConfigPath

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return database.setConfigMigrated(true)
	}

	b, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("read legacy config: %w", err)
	}

	var legacy legacyData
	if err := json.Unmarshal(b, &legacy); err != nil {
		slog.Warn("failed to parse legacy config.json", "error", err)
		return database.setConfigMigrated(true)
	}

	if legacy.ID != "" {
		if err := database.setID(legacy.ID); err != nil {
			return fmt.Errorf("migrate device ID: %w", err)
		}
		slog.Info("migrated device ID from config.json")
	}

	hasCompleted := legacy.FirstTimeRun
	if err := database.setHasCompletedFirstRun(hasCompleted); err != nil {
		return fmt.Errorf("migrate first time run: %w", err)
	}
	slog.Info("migrated first run status from config.json", "hasCompleted", hasCompleted)

	if err := database.setConfigMigrated(true); err != nil {
		return fmt.Errorf("mark config as migrated: %w", err)
	}

	slog.Info("successfully migrated settings from config.json")
	return nil
}

func (s *Store) ID() (string, error) {
	if err := s.ensureDB(); err != nil {
		return "", err
	}

	return s.db.getID()
}

func (s *Store) HasCompletedFirstRun() (bool, error) {
	if err := s.ensureDB(); err != nil {
		return false, err
	}

	return s.db.getHasCompletedFirstRun()
}

func (s *Store) SetHasCompletedFirstRun(hasCompleted bool) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	return s.db.setHasCompletedFirstRun(hasCompleted)
}

func (s *Store) Settings() (Settings, error) {
	if err := s.ensureDB(); err != nil {
		return Settings{}, fmt.Errorf("load settings: %w", err)
	}

	settings, err := s.db.getSettings()
	if err != nil {
		return Settings{}, err
	}

	if settings.Models == "" {
		dir := os.Getenv("OLLAMA_MODELS")
		if dir != "" {
			settings.Models = dir
		} else {
			home, err := os.UserHomeDir()
			if err == nil {
				settings.Models = filepath.Join(home, ".ollama", "models")
			}
		}
	}

	if settings.LastHomeView == "" {
		settings.LastHomeView = "launch"
	}

	return settings, nil
}

func (s *Store) SetSettings(settings Settings) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	return s.db.setSettings(settings)
}

func (s *Store) SearchChats(query string) ([]SearchResult, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}

	return s.db.searchChats(query, s)
}

func (s *Store) Chats() ([]Chat, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}

	chats, err := s.db.getAllChats()
	if err != nil {
		return nil, err
	}

	key, keyErr := s.getEncryptionKey()
	if keyErr != nil {
		return nil, fmt.Errorf("Chats: %w", keyErr)
	}
	if key != nil {
		for i := range chats {
			if decrypted, err := DecryptString(key, chats[i].Title); err == nil {
				chats[i].Title = decrypted
			}
			for j := range chats[i].Messages {
				if decrypted, err := DecryptString(key, chats[i].Messages[j].Content); err == nil {
					chats[i].Messages[j].Content = decrypted
				}
			}
		}
	}

	return chats, nil
}

func (s *Store) Chat(id string) (*Chat, error) {
	return s.ChatWithOptions(id, true)
}

func (s *Store) ChatWithOptions(id string, loadAttachmentData bool) (*Chat, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}

	chat, err := s.db.getChatWithOptions(id, loadAttachmentData)
	if err != nil {
		return nil, fmt.Errorf("%w: chat %s", not.Found, id)
	}

	if err := s.decryptChat(chat); err != nil {
		slog.Warn("failed to decrypt chat", "chat_id", id, "error", err)
	}

	return chat, nil
}

func (s *Store) SetChat(chat Chat) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	if err := s.encryptChat(&chat); err != nil {
		return fmt.Errorf("encrypt chat: %w", err)
	}

	return s.db.saveChat(chat)
}

func (s *Store) PinChat(id string, pinned bool) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.pinChat(id, pinned)
}

func (s *Store) SetChatFolder(id, folder string) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.setChatFolder(id, folder)
}

func (s *Store) DeleteChat(id string) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	if err := s.db.deleteChat(id); err != nil {
		return fmt.Errorf("%w: chat %s", not.Found, id)
	}

	chatImgDir := filepath.Join(s.ImgDir(), id)
	if err := os.RemoveAll(chatImgDir); err != nil {
		slog.Warn("failed to delete chat images", "chat_id", id, "error", err)
	}

	return nil
}

func (s *Store) WindowSize() (int, int, error) {
	if err := s.ensureDB(); err != nil {
		return 0, 0, err
	}

	return s.db.getWindowSize()
}

func (s *Store) SetWindowSize(width, height int) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	return s.db.setWindowSize(width, height)
}

func (s *Store) UpdateLastMessage(chatID string, message Message) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	if err := s.encryptMessage(&message); err != nil {
		return fmt.Errorf("encrypt message: %w", err)
	}

	return s.db.updateLastMessage(chatID, message)
}

func (s *Store) UpdateLastMessageContentByID(messageID int64, content, thinking string, thinkingTimeStart, thinkingTimeEnd *time.Time) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	key, keyErr := s.getEncryptionKey()
	if keyErr != nil {
		return fmt.Errorf("UpdateLastMessageContentByID: %w", keyErr)
	}
	if key != nil {
		if content != "" && !IsEncrypted(content) {
			if encrypted, err := EncryptString(key, content); err == nil {
				content = encrypted
			}
		}
		if thinking != "" && !IsEncrypted(thinking) {
			if encrypted, err := EncryptString(key, thinking); err == nil {
				thinking = encrypted
			}
		}
	}

	return s.db.updateLastMessageContentByID(messageID, content, thinking, thinkingTimeStart, thinkingTimeEnd)
}

func (s *Store) GetLastMessageID(chatID string) (int64, error) {
	if err := s.ensureDB(); err != nil {
		return 0, err
	}
	return s.db.getLastMessageID(chatID)
}

func (s *Store) AppendMessage(chatID string, message Message) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	if err := s.encryptMessage(&message); err != nil {
		return fmt.Errorf("encrypt message: %w", err)
	}

	return s.db.appendMessage(chatID, message)
}

func (s *Store) UpdateChatBrowserState(chatID string, state json.RawMessage) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	key, keyErr := s.getEncryptionKey()
	if keyErr != nil {
		return fmt.Errorf("UpdateChatBrowserState: %w", keyErr)
	}
	if key != nil {
		if encrypted, err := EncryptBytes(key, []byte(state)); err == nil && encrypted != nil {
			state = json.RawMessage(encrypted)
		}
	}

	return s.db.updateChatBrowserState(chatID, state)
}

func (s *Store) UpdateMessageRAGSources(chatID string, messageIndex int, sourcesJSON string) {
	if err := s.ensureDB(); err != nil {
		slog.Error("UpdateMessageRAGSources: ensureDB failed", "error", err)
		return
	}
	if err := s.db.updateMessageRAGSources(chatID, messageIndex, sourcesJSON); err != nil {
		slog.Error("UpdateMessageRAGSources: update failed", "chatID", chatID, "messageIndex", messageIndex, "error", err)
	}
}

func (s *Store) RAGChunksByDocument(docID string) ([]RAGChunk, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}
	return s.db.getRAGChunksByDocument(docID)
}

func (s *Store) User() (*User, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}

	return s.db.getUser()
}

func (s *Store) SetUser(user User) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	user.CachedAt = time.Now()
	return s.db.setUser(user)
}

func (s *Store) ClearUser() error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	return s.db.clearUser()
}

func (s *Store) Close() error {
	s.dbMu.Lock()
	defer s.dbMu.Unlock()

	if s.db != nil {
		return s.db.Close()
	}
	return nil
}

// ========== Encryption helpers ==========

func (s *Store) getEncryptionKey() ([]byte, error) {
	s.encKeyMu.Lock()
	defer s.encKeyMu.Unlock()

	if s.encKey != nil {
		return s.encKey, nil
	}

	settings, err := s.db.getSettings()
	if err != nil {
		slog.Error("getEncryptionKey: failed to read settings", "error", err)
		return nil, fmt.Errorf("get settings: %w", err)
	}
	if !settings.EncryptionEnabled {
		return nil, nil
	}

	key, err := LoadKey(s.KeyPath())
	if err != nil {
		slog.Error("getEncryptionKey: encryption enabled but key load failed", "error", err)
		return nil, fmt.Errorf("load encryption key: %w", err)
	}

	s.encKey = key
	return key, nil
}

func (s *Store) ensureEncryptionKey() ([]byte, error) {
	s.encKeyMu.Lock()
	defer s.encKeyMu.Unlock()

	if s.encKey != nil {
		return s.encKey, nil
	}

	keyPath := s.KeyPath()
	key, err := LoadKey(keyPath)
	if err == nil {
		s.encKey = key
		return key, nil
	}

	key, err = GenerateKey()
	if err != nil {
		return nil, fmt.Errorf("generate encryption key: %w", err)
	}

	if err := SaveKey(keyPath, key); err != nil {
		return nil, fmt.Errorf("save encryption key: %w", err)
	}

	slog.Info("generated new encryption key", "path", keyPath)
	s.encKey = key
	return key, nil
}

func (s *Store) encryptMessage(msg *Message) error {
	key, err := s.getEncryptionKey()
	if err != nil {
		return fmt.Errorf("encryptMessage: %w", err)
	}
	if key == nil {
		return nil
	}

	if msg.Content != "" && !IsEncrypted(msg.Content) {
		encrypted, err := EncryptString(key, msg.Content)
		if err != nil {
			return fmt.Errorf("encrypt content: %w", err)
		}
		msg.Content = encrypted
	}

	if msg.Thinking != "" && !IsEncrypted(msg.Thinking) {
		encrypted, err := EncryptString(key, msg.Thinking)
		if err != nil {
			return fmt.Errorf("encrypt thinking: %w", err)
		}
		msg.Thinking = encrypted
	}

	for i := range msg.Attachments {
		if len(msg.Attachments[i].Data) > 0 && !IsEncryptedBytes(msg.Attachments[i].Data) {
			encrypted, err := EncryptBytes(key, msg.Attachments[i].Data)
			if err != nil {
				return fmt.Errorf("encrypt attachment %s: %w", msg.Attachments[i].Filename, err)
			}
			msg.Attachments[i].Data = encrypted
		}
	}

	return nil
}

func (s *Store) decryptMessage(msg *Message) error {
	key, err := s.getEncryptionKey()
	if err != nil {
		return fmt.Errorf("decryptMessage: %w", err)
	}
	if key == nil {
		return nil
	}

	if msg.Content != "" {
		decrypted, err := DecryptString(key, msg.Content)
		if err != nil {
			return fmt.Errorf("decrypt content: %w", err)
		}
		msg.Content = decrypted
	}

	if msg.Thinking != "" {
		decrypted, err := DecryptString(key, msg.Thinking)
		if err != nil {
			return fmt.Errorf("decrypt thinking: %w", err)
		}
		msg.Thinking = decrypted
	}

	for i := range msg.Attachments {
		if len(msg.Attachments[i].Data) > 0 {
			decrypted, err := DecryptBytes(key, msg.Attachments[i].Data)
			if err != nil {
				return fmt.Errorf("decrypt attachment %s: %w", msg.Attachments[i].Filename, err)
			}
			msg.Attachments[i].Data = decrypted
		}
	}

	return nil
}

func (s *Store) encryptChat(chat *Chat) error {
	key, err := s.getEncryptionKey()
	if err != nil {
		return fmt.Errorf("encryptChat: %w", err)
	}
	if key == nil {
		return nil
	}

	if chat.Title != "" && !IsEncrypted(chat.Title) {
		encrypted, err := EncryptString(key, chat.Title)
		if err != nil {
			return fmt.Errorf("encrypt title: %w", err)
		}
		chat.Title = encrypted
	}

	if len(chat.BrowserState) > 0 && !IsEncryptedBytes(chat.BrowserState) {
		encrypted, err := EncryptBytes(key, []byte(chat.BrowserState))
		if err != nil {
			return fmt.Errorf("encrypt browser state: %w", err)
		}
		chat.BrowserState = json.RawMessage(encrypted)
	}

	for i := range chat.Messages {
		if err := s.encryptMessage(&chat.Messages[i]); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) decryptChat(chat *Chat) error {
	key, err := s.getEncryptionKey()
	if err != nil {
		return fmt.Errorf("decryptChat: %w", err)
	}
	if key == nil {
		return nil
	}

	if chat.Title != "" {
		decrypted, err := DecryptString(key, chat.Title)
		if err != nil {
			return fmt.Errorf("decrypt title: %w", err)
		}
		chat.Title = decrypted
	}

	if len(chat.BrowserState) > 0 {
		decrypted, err := DecryptBytes(key, chat.BrowserState)
		if err != nil {
			return fmt.Errorf("decrypt browser state: %w", err)
		}
		chat.BrowserState = json.RawMessage(decrypted)
	}

	for i := range chat.Messages {
		if err := s.decryptMessage(&chat.Messages[i]); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) SetEncryptionEnabled(enabled bool) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	settings, err := s.db.getSettings()
	if err != nil {
		return fmt.Errorf("load settings: %w", err)
	}

	if settings.EncryptionEnabled == enabled {
		return nil
	}

	if enabled {
		key, err := s.ensureEncryptionKey()
		if err != nil {
			return fmt.Errorf("ensure encryption key: %w", err)
		}

		ids, err := s.db.getAllChatIDs()
		if err != nil {
			return fmt.Errorf("list chat ids: %w", err)
		}
		total := len(ids)

		for i, id := range ids {
			chat, err := s.db.getChatWithOptions(id, true)
			if err != nil {
				return fmt.Errorf("load chat %s: %w", id, err)
			}
			if chat.Title != "" && !IsEncrypted(chat.Title) {
				if encrypted, err := EncryptString(key, chat.Title); err == nil {
					chat.Title = encrypted
				}
			}
			if len(chat.BrowserState) > 0 && !IsEncryptedBytes(chat.BrowserState) {
				if encrypted, err := EncryptBytes(key, []byte(chat.BrowserState)); err == nil {
					chat.BrowserState = json.RawMessage(encrypted)
				}
			}
			for j := range chat.Messages {
				msg := &chat.Messages[j]
				if msg.Content != "" && !IsEncrypted(msg.Content) {
					if encrypted, err := EncryptString(key, msg.Content); err == nil {
						msg.Content = encrypted
					}
				}
				if msg.Thinking != "" && !IsEncrypted(msg.Thinking) {
					if encrypted, err := EncryptString(key, msg.Thinking); err == nil {
						msg.Thinking = encrypted
					}
				}
				for k := range msg.Attachments {
					if len(msg.Attachments[k].Data) > 0 && !IsEncryptedBytes(msg.Attachments[k].Data) {
						if encrypted, err := EncryptBytes(key, msg.Attachments[k].Data); err == nil {
							msg.Attachments[k].Data = encrypted
						}
					}
				}
			}
			if err := s.db.saveChat(*chat); err != nil {
				return fmt.Errorf("save encrypted chat %s: %w", chat.ID, err)
			}
			slog.Info("encrypted chat", "id", id, "progress", fmt.Sprintf("%d/%d", i+1, total))
		}

		slog.Info("encrypted all chat data", "chats", total)

		settings.EncryptionEnabled = true
		if err := s.db.setSettings(settings); err != nil {
			return fmt.Errorf("persist encryption flag: %w", err)
		}
	} else {
		key, err := LoadKey(s.KeyPath())
		if err != nil {
			return fmt.Errorf("load encryption key for decryption: %w", err)
		}

		ids, err := s.db.getAllChatIDs()
		if err != nil {
			return fmt.Errorf("list chat ids: %w", err)
		}
		total := len(ids)

		for i, id := range ids {
			chat, err := s.db.getChatWithOptions(id, true)
			if err != nil {
				return fmt.Errorf("load chat %s: %w", id, err)
			}
			if decrypted, err := DecryptString(key, chat.Title); err == nil {
				chat.Title = decrypted
			}
			if len(chat.BrowserState) > 0 {
				if decrypted, err := DecryptBytes(key, chat.BrowserState); err == nil {
					chat.BrowserState = json.RawMessage(decrypted)
				}
			}
			for j := range chat.Messages {
				msg := &chat.Messages[j]
				if decrypted, err := DecryptString(key, msg.Content); err == nil {
					msg.Content = decrypted
				}
				if decrypted, err := DecryptString(key, msg.Thinking); err == nil {
					msg.Thinking = decrypted
				}
				for k := range msg.Attachments {
					if len(msg.Attachments[k].Data) > 0 {
						if decrypted, err := DecryptBytes(key, msg.Attachments[k].Data); err == nil {
							msg.Attachments[k].Data = decrypted
						}
					}
				}
			}
			if err := s.db.saveChat(*chat); err != nil {
				return fmt.Errorf("save decrypted chat %s: %w", chat.ID, err)
			}
			slog.Info("decrypted chat", "id", id, "progress", fmt.Sprintf("%d/%d", i+1, total))
		}

		s.encKeyMu.Lock()
		s.encKey = nil
		s.encKeyMu.Unlock()

		slog.Info("decrypted all chat data", "chats", total)

		settings.EncryptionEnabled = false
		if err := s.db.setSettings(settings); err != nil {
			return fmt.Errorf("persist encryption flag: %w", err)
		}
	}

	return nil
}

// ========== RAG Store methods ==========

func (s *Store) RAGDocuments() ([]RAGDocument, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}
	return s.db.getAllRAGDocuments()
}

func (s *Store) InsertRAGDocument(doc RAGDocument) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.insertRAGDocument(doc)
}

func (s *Store) RAGDocumentByHash(hash string) (*RAGDocument, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}
	return s.db.getRAGDocumentByHash(hash)
}

func (s *Store) UpdateRAGDocumentStatus(id, status, errorMsg string, chunkCount int) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.updateRAGDocumentStatus(id, status, errorMsg, chunkCount)
}

func (s *Store) DeleteRAGDocument(id string) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	InvalidateVectorCache()
	return s.db.deleteRAGDocument(id)
}

func (s *Store) UpdateRAGDocumentProgress(id string, current, total int) error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.updateRAGDocumentProgress(id, current, total)
}

func (s *Store) IncrementFailedAttempts() (int, error) {
	if err := s.ensureDB(); err != nil {
		return 0, err
	}
	return s.db.incrementFailedAttempts()
}

func (s *Store) ResetFailedAttempts() error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.resetFailedAttempts()
}

func (s *Store) DeleteAllChats() error {
	if err := s.ensureDB(); err != nil {
		return err
	}
	return s.db.deleteAllChats()
}

func (s *Store) DeleteChatsOlderThan(days int) (int64, error) {
	if err := s.ensureDB(); err != nil {
		return 0, err
	}
	return s.db.deleteChatsOlderThan(days)
}

func (s *Store) DeleteEncryptionKey() error {
	s.encKeyMu.Lock()
	defer s.encKeyMu.Unlock()
	s.encKey = nil
	keyPath := s.KeyPath()
	if _, err := os.Stat(keyPath); err == nil {
		return os.Remove(keyPath)
	}
	return nil
}

func (s *Store) InsertRAGChunks(chunks []RAGChunk) error {
	if err := s.ensureDB(); err != nil {
		return err
	}

	key, keyErr := s.getEncryptionKey()
	if keyErr != nil {
		return fmt.Errorf("InsertRAGChunks: %w", keyErr)
	}
	if key != nil {
		for i := range chunks {
			if chunks[i].Content != "" && !IsEncrypted(chunks[i].Content) {
				encrypted, err := EncryptString(key, chunks[i].Content)
				if err != nil {
					return fmt.Errorf("encrypt chunk %d: %w", i, err)
				}
				chunks[i].Content = encrypted
			}
		}
	}

	InvalidateVectorCache()

	return s.db.insertRAGChunks(chunks)
}

func (s *Store) SearchRAGChunks(queryEmb []float32, topK int) ([]RAGSearchResult, error) {
	if err := s.ensureDB(); err != nil {
		return nil, err
	}

	results, err := s.db.searchRAGChunks(queryEmb, topK)
	if err != nil {
		return nil, err
	}

	key, keyErr := s.getEncryptionKey()
	if keyErr != nil {
		return nil, fmt.Errorf("SearchRAGChunks: %w", keyErr)
	}
	if key != nil {
		for i := range results {
			if results[i].Content != "" {
				if decrypted, err := DecryptString(key, results[i].Content); err == nil {
					results[i].Content = decrypted
				}
			}
		}
	}

	return results, nil
}
