//go:build windows || darwin

package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// currentSchemaVersion defines the current database schema version.
// v1-v16: upstream Ollama v0.31.2
// v17-v29: Dromadaire custom (privacy, RAG, encryption, perf, UI)
const currentSchemaVersion = 31

// database wraps the SQLite connection.
// SQLite handles its own locking for concurrent access:
// - Multiple readers can access the database simultaneously
// - Writers are serialized (only one writer at a time)
// - WAL mode allows readers to not block writers
// This means we don't need application-level locks for database operations.
type database struct {
	conn *sql.DB
}

func newDatabase(dbPath string) (*database, error) {
	conn, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_journal_mode=WAL&_busy_timeout=5000&_txlock=immediate")
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	// Single connection eliminates WAL snapshot staleness across queries.
	// All cursor-holding loops scan rows into memory and close cursors before sub-queries.
	conn.SetMaxOpenConns(1)

	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	db := &database{conn: conn}

	if err := db.init(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}

	return db, nil
}

func (db *database) Close() error {
	if _, err := db.conn.Exec("PRAGMA wal_checkpoint(TRUNCATE);"); err != nil {
		slog.Warn("wal_checkpoint on close failed", "error", err)
	}

	return db.conn.Close()
}

func (db *database) init() error {
	if _, err := db.conn.Exec("PRAGMA foreign_keys = ON"); err != nil {
		return fmt.Errorf("enable foreign keys: %w", err)
	}

	schema := fmt.Sprintf(`
	CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		device_id TEXT NOT NULL DEFAULT '',
		has_completed_first_run BOOLEAN NOT NULL DEFAULT 0,
		expose BOOLEAN NOT NULL DEFAULT 0,
		survey BOOLEAN NOT NULL DEFAULT TRUE,
		browser BOOLEAN NOT NULL DEFAULT 0,
		models TEXT NOT NULL DEFAULT '',
		agent BOOLEAN NOT NULL DEFAULT 0,
		tools BOOLEAN NOT NULL DEFAULT 0,
		working_dir TEXT NOT NULL DEFAULT '',
		context_length INTEGER NOT NULL DEFAULT 0,
		window_width INTEGER NOT NULL DEFAULT 0,
		window_height INTEGER NOT NULL DEFAULT 0,
		config_migrated BOOLEAN NOT NULL DEFAULT 0,
		airplane_mode BOOLEAN NOT NULL DEFAULT 0,
		turbo_enabled BOOLEAN NOT NULL DEFAULT 0,
		websearch_enabled BOOLEAN NOT NULL DEFAULT 0,
		selected_model TEXT NOT NULL DEFAULT '',
		sidebar_open BOOLEAN NOT NULL DEFAULT 0,
		last_home_view TEXT NOT NULL DEFAULT 'launch',
		think_enabled BOOLEAN NOT NULL DEFAULT 0,
		think_level TEXT NOT NULL DEFAULT '',
		cloud_setting_migrated BOOLEAN NOT NULL DEFAULT 0,
		remote TEXT NOT NULL DEFAULT '',
		auto_update_enabled BOOLEAN NOT NULL DEFAULT 1,
		encryption_enabled BOOLEAN NOT NULL DEFAULT 0,
		rag_enabled BOOLEAN NOT NULL DEFAULT 0,
		embedding_model TEXT NOT NULL DEFAULT 'snowflake-arctic-embed:33m',
		password_enabled BOOLEAN NOT NULL DEFAULT 0,
		password_hash TEXT NOT NULL DEFAULT '',
		auto_delete_on_failure BOOLEAN NOT NULL DEFAULT 0,
		lock_timeout_minutes INTEGER NOT NULL DEFAULT 0,
		auto_delete_days INTEGER NOT NULL DEFAULT 0,
		clipboard_clear_seconds INTEGER NOT NULL DEFAULT 0,
		search_enabled BOOLEAN NOT NULL DEFAULT 1,
		rag_citations_enabled BOOLEAN NOT NULL DEFAULT 1,
		rag_preview_enabled BOOLEAN NOT NULL DEFAULT 1,
		artifacts_enabled BOOLEAN NOT NULL DEFAULT 1,
		theme TEXT NOT NULL DEFAULT 'light',
		keyboard_shortcuts_enabled BOOLEAN NOT NULL DEFAULT 1,
		num_thread INTEGER NOT NULL DEFAULT 0,
		keep_alive TEXT NOT NULL DEFAULT '',
		max_loaded_models INTEGER NOT NULL DEFAULT 0,
		kv_cache_type TEXT NOT NULL DEFAULT '',
		num_batch INTEGER NOT NULL DEFAULT 0,
		vulkan_enabled BOOLEAN NOT NULL DEFAULT 0,
		num_parallel INTEGER NOT NULL DEFAULT 0,
		response_mode TEXT NOT NULL DEFAULT '',
		system_prompt TEXT NOT NULL DEFAULT '',
		human_sub_mode TEXT NOT NULL DEFAULT '',
		writing_style_rules TEXT NOT NULL DEFAULT '',
		style_analysis_model TEXT NOT NULL DEFAULT 'gemma3:4b',
		schema_version INTEGER NOT NULL DEFAULT %d
	);

	INSERT OR IGNORE INTO settings (id, context_length) VALUES (1, 2048);

	CREATE TABLE IF NOT EXISTS rag_documents (
		id TEXT PRIMARY KEY,
		filename TEXT NOT NULL,
		file_size INTEGER NOT NULL DEFAULT 0,
		content_hash TEXT NOT NULL DEFAULT '',
		chunk_count INTEGER NOT NULL DEFAULT 0,
		status TEXT NOT NULL DEFAULT 'pending',
		error_message TEXT NOT NULL DEFAULT '',
		embedding_model TEXT NOT NULL DEFAULT '',
		progress_current INTEGER NOT NULL DEFAULT 0,
		progress_total INTEGER NOT NULL DEFAULT 0,
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS rag_chunks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		document_id TEXT NOT NULL,
		chunk_index INTEGER NOT NULL,
		content TEXT NOT NULL,
		embedding BLOB,
		embedding_dim INTEGER NOT NULL DEFAULT 0,
		token_count INTEGER NOT NULL DEFAULT 0,
		FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks(document_id);
	CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON rag_documents(status);

	CREATE TABLE IF NOT EXISTS login_attempts (
		id INTEGER PRIMARY KEY CHECK (id = 1),
		failed_count INTEGER NOT NULL DEFAULT 0,
		last_failed_at TIMESTAMP
	);
	INSERT OR IGNORE INTO login_attempts (id) VALUES (1);

	CREATE TABLE IF NOT EXISTS chats (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL DEFAULT '',
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		browser_state TEXT,
		pinned BOOLEAN NOT NULL DEFAULT 0,
		folder TEXT NOT NULL DEFAULT ''
	);

	CREATE TABLE IF NOT EXISTS messages (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		chat_id TEXT NOT NULL,
		role TEXT NOT NULL,
		content TEXT NOT NULL DEFAULT '',
		thinking TEXT NOT NULL DEFAULT '',
		stream BOOLEAN NOT NULL DEFAULT 0,
		model_name TEXT,
		model_cloud BOOLEAN,
		model_ollama_host BOOLEAN,
		created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
		thinking_time_start TIMESTAMP,
		thinking_time_end TIMESTAMP,
		tool_result TEXT,
		rag_sources TEXT,
		FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id);
	CREATE INDEX IF NOT EXISTS idx_messages_chat_id_id ON messages(chat_id, id);

	CREATE TABLE IF NOT EXISTS tool_calls (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		type TEXT NOT NULL,
		function_name TEXT NOT NULL,
		function_arguments TEXT NOT NULL,
		function_result TEXT,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_tool_calls_message_id ON tool_calls(message_id);

	CREATE TABLE IF NOT EXISTS attachments (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		message_id INTEGER NOT NULL,
		filename TEXT NOT NULL,
		data BLOB NOT NULL,
		FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

	CREATE TABLE IF NOT EXISTS users (
		name TEXT NOT NULL DEFAULT '',
		email TEXT NOT NULL DEFAULT '',
		plan TEXT NOT NULL DEFAULT '',
		cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
	);
	`, currentSchemaVersion)

	_, err := db.conn.Exec(schema)
	if err != nil {
		return err
	}

	if err := db.migrate(); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}

	// TODO: Can eventually be removed - cleans up data from foreign key bug (ollama/ollama#11785, ollama/app#476)
	if err := db.cleanupOrphanedData(); err != nil {
		return fmt.Errorf("cleanup orphaned data: %w", err)
	}

	return nil
}

// migrate handles database schema migrations.
//
// FORWARD-ONLY POLICY: Migrations are not wrapped in transactions because SQLite
// auto-commits DDL statements (ALTER TABLE, CREATE TABLE, CREATE INDEX) — wrapping
// them in BEGIN/COMMIT provides no rollback protection. Each migration step is
// idempotent (uses IF NOT EXISTS, checks for duplicate columns) so re-running after
// a partial failure is safe.
func (db *database) migrate() error {
	version, err := db.getSchemaVersion()
	if err != nil {
		return fmt.Errorf("get schema version after migration attempt: %w", err)
	}

	if version < currentSchemaVersion {
		slog.Info("database migration starting", "from_version", version, "to_version", currentSchemaVersion)
	}

	for version < currentSchemaVersion {
		nextVersion := version + 1
		slog.Info("database migration step", "from", version, "to", nextVersion)

		switch version {
		// --- Upstream Ollama v0.31.2 migrations (v1→v16) ---
		case 1:
			if err := db.migrateV1ToV2(); err != nil {
				return fmt.Errorf("migrate v1 to v2: %w", err)
			}
			version = 2
		case 2:
			if err := db.migrateV2ToV3(); err != nil {
				return fmt.Errorf("migrate v2 to v3: %w", err)
			}
			version = 3
		case 3:
			if err := db.migrateV3ToV4(); err != nil {
				return fmt.Errorf("migrate v3 to v4: %w", err)
			}
			version = 4
		case 4:
			if err := db.migrateV4ToV5(); err != nil {
				return fmt.Errorf("migrate v4 to v5: %w", err)
			}
			version = 5
		case 5:
			if err := db.migrateV5ToV6(); err != nil {
				return fmt.Errorf("migrate v5 to v6: %w", err)
			}
			version = 6
		case 6:
			if err := db.migrateV6ToV7(); err != nil {
				return fmt.Errorf("migrate v6 to v7: %w", err)
			}
			version = 7
		case 7:
			if err := db.migrateV7ToV8(); err != nil {
				return fmt.Errorf("migrate v7 to v8: %w", err)
			}
			version = 8
		case 8:
			if err := db.migrateV8ToV9(); err != nil {
				return fmt.Errorf("migrate v8 to v9: %w", err)
			}
			version = 9
		case 9:
			if err := db.migrateV9ToV10(); err != nil {
				return fmt.Errorf("migrate v9 to v10: %w", err)
			}
			version = 10
		case 10:
			if err := db.migrateV10ToV11(); err != nil {
				return fmt.Errorf("migrate v10 to v11: %w", err)
			}
			version = 11
		case 11:
			if err := db.migrateV11ToV12(); err != nil {
				return fmt.Errorf("migrate v11 to v12: %w", err)
			}
			version = 12
		case 12:
			if err := db.migrateV12ToV13(); err != nil {
				return fmt.Errorf("migrate v12 to v13: %w", err)
			}
			version = 13
		case 13:
			if err := db.migrateV13ToV14(); err != nil {
				return fmt.Errorf("migrate v13 to v14: %w", err)
			}
			version = 14
		case 14:
			if err := db.migrateV14ToV15(); err != nil {
				return fmt.Errorf("migrate v14 to v15: %w", err)
			}
			version = 15
		case 15:
			if err := db.migrateV15ToV16(); err != nil {
				return fmt.Errorf("migrate v15 to v16: %w", err)
			}
			version = 16
		// --- Dromadaire custom migrations (v17→v29) ---
		case 16:
			if err := db.migrateV16ToV17(); err != nil {
				return fmt.Errorf("migrate v16 to v17: %w", err)
			}
			version = 17
		case 17:
			if err := db.migrateV17ToV18(); err != nil {
				return fmt.Errorf("migrate v17 to v18: %w", err)
			}
			version = 18
		case 18:
			if err := db.migrateV18ToV19(); err != nil {
				return fmt.Errorf("migrate v18 to v19: %w", err)
			}
			version = 19
		case 19:
			if err := db.migrateV19ToV20(); err != nil {
				return fmt.Errorf("migrate v19 to v20: %w", err)
			}
			version = 20
		case 20:
			if err := db.migrateV20ToV21(); err != nil {
				return fmt.Errorf("migrate v20 to v21: %w", err)
			}
			version = 21
		case 21:
			if err := db.migrateV21ToV22(); err != nil {
				return fmt.Errorf("migrate v21 to v22: %w", err)
			}
			version = 22
		case 22:
			if err := db.migrateV22ToV23(); err != nil {
				return fmt.Errorf("migrate v22 to v23: %w", err)
			}
			version = 23
		case 23:
			if err := db.migrateV23ToV24(); err != nil {
				return fmt.Errorf("migrate v23 to v24: %w", err)
			}
			version = 24
		case 24:
			if err := db.migrateV24ToV25(); err != nil {
				return fmt.Errorf("migrate v24 to v25: %w", err)
			}
			version = 25
		case 25:
			if err := db.migrateV25ToV26(); err != nil {
				return fmt.Errorf("migrate v25 to v26: %w", err)
			}
			version = 26
		case 26:
			if err := db.migrateV26ToV27(); err != nil {
				return fmt.Errorf("migrate v26 to v27: %w", err)
			}
			version = 27
		case 27:
			if err := db.migrateV27ToV28(); err != nil {
				return fmt.Errorf("migrate v27 to v28: %w", err)
			}
			version = 28
		case 28:
			if err := db.migrateV28ToV29(); err != nil {
				return fmt.Errorf("migrate v28 to v29: %w", err)
			}
			version = 29
		case 29:
			if err := db.migrateV29ToV30(); err != nil {
				return fmt.Errorf("migrate v29 to v30: %w", err)
			}
			version = 30
		case 30:
			if err := db.migrateV30ToV31(); err != nil {
				return fmt.Errorf("migrate v30 to v31: %w", err)
			}
			version = 31
		default:
			version = currentSchemaVersion
		}
	}

	return nil
}

// ============================================================
// Upstream migrations v1→v16 (Ollama v0.31.2)
// ============================================================

func (db *database) migrateV1ToV2() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN context_length INTEGER NOT NULL DEFAULT 4096;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add context_length column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN survey BOOLEAN NOT NULL DEFAULT TRUE;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add survey column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 2;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV2ToV3() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS attachments (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			message_id INTEGER NOT NULL,
			filename TEXT NOT NULL,
			data BLOB NOT NULL,
			FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("create attachments table: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 3`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV3ToV4() error {
	_, err := db.conn.Exec(`ALTER TABLE messages ADD COLUMN tool_result TEXT;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add tool_result column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 4;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV4ToV5() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN airplane_mode BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add airplane_mode column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 5;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV5ToV6() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN turbo_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add turbo_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN websearch_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add websearch_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN selected_model TEXT NOT NULL DEFAULT '';`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add selected_model column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN sidebar_open BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add sidebar_open column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 6;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV6ToV7() error {
	_, err := db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);`)
	if err != nil {
		return fmt.Errorf("create attachments index: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 7;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV7ToV8() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_enabled BOOLEAN NOT NULL DEFAULT 0;`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN think_level TEXT NOT NULL DEFAULT '';`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add think_level column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 8;`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV8ToV9() error {
	_, err := db.conn.Exec(`
		ALTER TABLE chats ADD COLUMN browser_state TEXT;
		UPDATE settings SET schema_version = 9;
	`)

	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add browser_state column: %w", err)
	}
	return nil
}

func (db *database) migrateV9ToV10() error {
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			name TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			plan TEXT NOT NULL DEFAULT '',
			cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		);
		UPDATE settings SET schema_version = 10;
	`)
	if err != nil {
		return fmt.Errorf("create users table: %w", err)
	}
	return nil
}

func (db *database) migrateV10ToV11() error {
	_, err := db.conn.Exec(`ALTER TABLE settings DROP COLUMN remote`)
	if err != nil && !columnNotExists(err) {
		return fmt.Errorf("drop remote column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 11`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV11ToV12() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN remote TEXT NOT NULL DEFAULT ''`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add remote column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 12`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV12ToV13() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN cloud_setting_migrated BOOLEAN NOT NULL DEFAULT 0`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add cloud_setting_migrated column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 13`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV13ToV14() error {
	_, err := db.conn.Exec(`UPDATE settings SET context_length = 0 WHERE context_length = 4096`)
	if err != nil {
		return fmt.Errorf("update context_length default: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 14`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV14ToV15() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN auto_update_enabled BOOLEAN NOT NULL DEFAULT 1`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add auto_update_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 15`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

func (db *database) migrateV15ToV16() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN last_home_view TEXT NOT NULL DEFAULT 'launch'`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add last_home_view column: %w", err)
	}

	_, err = db.conn.Exec(`UPDATE settings SET schema_version = 16`)
	if err != nil {
		return fmt.Errorf("update schema version: %w", err)
	}
	return nil
}

// ============================================================
// Dromadaire custom migrations (v17→v29)
// ============================================================

// migrateV16ToV17 adds encryption_enabled column
func (db *database) migrateV16ToV17() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN encryption_enabled BOOLEAN NOT NULL DEFAULT 0`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add encryption_enabled column: %w", err)
	}
	return db.setSchemaVersion(17)
}

// migrateV17ToV18 adds RAG tables and settings columns
func (db *database) migrateV17ToV18() error {
	_, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN rag_enabled BOOLEAN NOT NULL DEFAULT 0`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add rag_enabled column: %w", err)
	}

	_, err = db.conn.Exec(`ALTER TABLE settings ADD COLUMN embedding_model TEXT NOT NULL DEFAULT 'snowflake-arctic-embed:33m'`)
	if err != nil && !duplicateColumnError(err) {
		return fmt.Errorf("add embedding_model column: %w", err)
	}

	_, err = db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS rag_documents (
			id TEXT PRIMARY KEY,
			filename TEXT NOT NULL,
			file_size INTEGER NOT NULL DEFAULT 0,
			content_hash TEXT NOT NULL DEFAULT '',
			chunk_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'pending',
			error_message TEXT NOT NULL DEFAULT '',
			embedding_model TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("create rag_documents table: %w", err)
	}

	_, err = db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS rag_chunks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			document_id TEXT NOT NULL,
			chunk_index INTEGER NOT NULL,
			content TEXT NOT NULL,
			embedding BLOB,
			embedding_dim INTEGER NOT NULL DEFAULT 0,
			token_count INTEGER NOT NULL DEFAULT 0,
			FOREIGN KEY (document_id) REFERENCES rag_documents(id) ON DELETE CASCADE
		)
	`)
	if err != nil {
		return fmt.Errorf("create rag_chunks table: %w", err)
	}

	_, err = db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_rag_chunks_document_id ON rag_chunks(document_id)`)
	if err != nil {
		return fmt.Errorf("create rag_chunks index: %w", err)
	}

	return db.setSchemaVersion(18)
}

// migrateV18ToV19 adds embedding progress, password protection, login attempts
func (db *database) migrateV18ToV19() error {
	migrations := []string{
		"ALTER TABLE rag_documents ADD COLUMN progress_current INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE rag_documents ADD COLUMN progress_total INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE settings ADD COLUMN password_enabled BOOLEAN NOT NULL DEFAULT 0",
		"ALTER TABLE settings ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''",
		"ALTER TABLE settings ADD COLUMN auto_delete_on_failure BOOLEAN NOT NULL DEFAULT 0",
		`CREATE TABLE IF NOT EXISTS login_attempts (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			failed_count INTEGER NOT NULL DEFAULT 0,
			last_failed_at TIMESTAMP
		)`,
		"INSERT OR IGNORE INTO login_attempts (id) VALUES (1)",
	}
	for _, m := range migrations {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(19)
}

// migrateV19ToV20 adds auto-lock, auto-delete days, clipboard clear settings
func (db *database) migrateV19ToV20() error {
	migrations := []string{
		"ALTER TABLE settings ADD COLUMN lock_timeout_minutes INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE settings ADD COLUMN auto_delete_days INTEGER NOT NULL DEFAULT 0",
		"ALTER TABLE settings ADD COLUMN clipboard_clear_seconds INTEGER NOT NULL DEFAULT 0",
	}
	for _, m := range migrations {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(20)
}

// migrateV20ToV21 adds performance indexes
func (db *database) migrateV20ToV21() error {
	if _, err := db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_rag_documents_status ON rag_documents(status)`); err != nil {
		slog.Warn("create idx_rag_documents_status failed", "error", err)
	}
	if _, err := db.conn.Exec(`CREATE INDEX IF NOT EXISTS idx_messages_chat_id_id ON messages(chat_id, id)`); err != nil {
		slog.Warn("create idx_messages_chat_id_id failed", "error", err)
	}
	return db.setSchemaVersion(21)
}

// migrateV21ToV22 adds settings for search, citations, preview, artifacts, themes, shortcuts, rag_sources
func (db *database) migrateV21ToV22() error {
	alters := []string{
		`ALTER TABLE settings ADD COLUMN search_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE settings ADD COLUMN rag_citations_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE settings ADD COLUMN rag_preview_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE settings ADD COLUMN artifacts_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE settings ADD COLUMN theme TEXT NOT NULL DEFAULT 'light'`,
		`ALTER TABLE settings ADD COLUMN keyboard_shortcuts_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE messages ADD COLUMN rag_sources TEXT`,
	}
	for _, q := range alters {
		if _, err := db.conn.Exec(q); err != nil && !duplicateColumnError(err) {
			return fmt.Errorf("migrate v21 to v22: %w", err)
		}
	}
	return db.setSchemaVersion(22)
}

// migrateV22ToV23 enables artifacts by default for existing users
func (db *database) migrateV22ToV23() error {
	if _, err := db.conn.Exec(`UPDATE settings SET artifacts_enabled = 1 WHERE artifacts_enabled = 0`); err != nil {
		return fmt.Errorf("migrate v22 to v23: %w", err)
	}
	return db.setSchemaVersion(23)
}

// migrateV23ToV24 sets context_length to 2048 for CPU-only (16GB RAM)
func (db *database) migrateV23ToV24() error {
	if _, err := db.conn.Exec(`UPDATE settings SET context_length = 2048 WHERE context_length = 0 OR context_length >= 4096`); err != nil {
		return fmt.Errorf("migrate v23 to v24: %w", err)
	}
	return db.setSchemaVersion(24)
}

// migrateV24ToV25 adds advanced performance settings columns
func (db *database) migrateV24ToV25() error {
	migrations := []string{
		`ALTER TABLE settings ADD COLUMN num_thread INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN keep_alive TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN max_loaded_models INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN kv_cache_type TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN num_batch INTEGER NOT NULL DEFAULT 0`,
	}
	for _, m := range migrations {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(25)
}

// migrateV25ToV26 adds Vulkan GPU backend toggle
func (db *database) migrateV25ToV26() error {
	if _, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN vulkan_enabled BOOLEAN NOT NULL DEFAULT 0`); err != nil {
		if !duplicateColumnError(err) {
			return err
		}
	}
	return db.setSchemaVersion(26)
}

// migrateV26ToV27 adds response_mode and system_prompt columns
func (db *database) migrateV26ToV27() error {
	for _, m := range []string{
		`ALTER TABLE settings ADD COLUMN response_mode TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN system_prompt TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(27)
}

// migrateV27ToV28 adds human_sub_mode, writing_style_rules, style_analysis_model
func (db *database) migrateV27ToV28() error {
	for _, m := range []string{
		`ALTER TABLE settings ADD COLUMN human_sub_mode TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN writing_style_rules TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN style_analysis_model TEXT NOT NULL DEFAULT 'gemma3:4b'`,
	} {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(28)
}

// migrateV28ToV29 adds pinned and folder columns to chats
func (db *database) migrateV28ToV29() error {
	for _, m := range []string{
		`ALTER TABLE chats ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0`,
		`ALTER TABLE chats ADD COLUMN folder TEXT NOT NULL DEFAULT ''`,
	} {
		if _, err := db.conn.Exec(m); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}
	return db.setSchemaVersion(29)
}

// migrateV29ToV30 backfills upstream v8→v16 columns for databases
// upgrading from Dromadaire v6 (based on Ollama v0.16.2, which only
// had upstream migrations v1→v7). All ALTER TABLEs are idempotent.
func (db *database) migrateV29ToV30() error {
	settingsCols := []string{
		`ALTER TABLE settings ADD COLUMN think_enabled BOOLEAN NOT NULL DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN think_level TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN remote TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE settings ADD COLUMN cloud_setting_migrated BOOLEAN NOT NULL DEFAULT 0`,
		`ALTER TABLE settings ADD COLUMN auto_update_enabled BOOLEAN NOT NULL DEFAULT 1`,
		`ALTER TABLE settings ADD COLUMN last_home_view TEXT NOT NULL DEFAULT 'launch'`,
	}
	for _, stmt := range settingsCols {
		if _, err := db.conn.Exec(stmt); err != nil {
			if !duplicateColumnError(err) {
				return err
			}
		}
	}

	if _, err := db.conn.Exec(`ALTER TABLE chats ADD COLUMN browser_state TEXT`); err != nil {
		if !duplicateColumnError(err) {
			return err
		}
	}

	if _, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			name TEXT NOT NULL DEFAULT '',
			email TEXT NOT NULL DEFAULT '',
			plan TEXT NOT NULL DEFAULT '',
			cached_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create users table: %w", err)
	}

	return db.setSchemaVersion(30)
}

// migrateV30ToV31 adds num_parallel and disables auto-update
func (db *database) migrateV30ToV31() error {
	if _, err := db.conn.Exec(`ALTER TABLE settings ADD COLUMN num_parallel INTEGER NOT NULL DEFAULT 0`); err != nil {
		if !duplicateColumnError(err) {
			return err
		}
	}
	if _, err := db.conn.Exec(`UPDATE settings SET auto_update_enabled = 0`); err != nil {
		return err
	}
	return db.setSchemaVersion(31)
}

// ============================================================
// Helpers
// ============================================================

func (db *database) cleanupOrphanedData() error {
	_, err := db.conn.Exec(`
		DELETE FROM tool_calls
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned tool_calls: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM attachments
		WHERE message_id NOT IN (SELECT id FROM messages)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned attachments: %w", err)
	}

	_, err = db.conn.Exec(`
		DELETE FROM messages
		WHERE chat_id NOT IN (SELECT id FROM chats)
	`)
	if err != nil {
		return fmt.Errorf("cleanup orphaned messages: %w", err)
	}

	return nil
}

func duplicateColumnError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "duplicate column name")
}

func columnNotExists(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no such column")
}

// ============================================================
// Chat CRUD
// ============================================================

func (db *database) getAllChats() ([]Chat, error) {
	query := `
		SELECT
			c.id,
			c.title,
			c.created_at,
			c.pinned,
			c.folder,
			COALESCE(first_msg.content, '') as first_user_content,
			COALESCE(datetime(MAX(m.updated_at)), datetime(c.created_at)) as last_updated
		FROM chats c
		LEFT JOIN (
			SELECT chat_id, content, MIN(id) as min_id
			FROM messages
			WHERE role = 'user'
			GROUP BY chat_id
		) first_msg ON c.id = first_msg.chat_id
		LEFT JOIN messages m ON c.id = m.chat_id
		GROUP BY c.id, c.title, c.created_at, c.pinned, c.folder, first_msg.content
		ORDER BY last_updated DESC
	`

	rows, err := db.conn.Query(query)
	if err != nil {
		return nil, fmt.Errorf("query chats: %w", err)
	}
	defer rows.Close()

	var chats []Chat
	for rows.Next() {
		var chat Chat
		var createdAt time.Time
		var firstUserContent string
		var lastUpdatedStr string

		err := rows.Scan(
			&chat.ID,
			&chat.Title,
			&createdAt,
			&chat.Pinned,
			&chat.Folder,
			&firstUserContent,
			&lastUpdatedStr,
		)
		if err != nil {
			return nil, fmt.Errorf("scan chat: %w", err)
		}

		lastUpdated, parseErr := time.Parse("2006-01-02 15:04:05", lastUpdatedStr)
		if parseErr != nil {
			lastUpdated = createdAt
		}

		chat.CreatedAt = createdAt
		chat.Messages = []Message{}
		if firstUserContent != "" {
			chat.Messages = append(chat.Messages, Message{
				Role:      "user",
				Content:   firstUserContent,
				UpdatedAt: lastUpdated,
			})
		}

		chats = append(chats, chat)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chats: %w", err)
	}

	return chats, nil
}

func (db *database) getAllChatIDs() ([]string, error) {
	rows, err := db.conn.Query(`SELECT id FROM chats`)
	if err != nil {
		return nil, fmt.Errorf("query chat ids: %w", err)
	}

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan chat id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate chat ids: %w", err)
	}
	rows.Close()

	return ids, nil
}

func (db *database) getAllChatsWithAttachments() ([]Chat, error) {
	ids, err := db.getAllChatIDs()
	if err != nil {
		return nil, err
	}

	var chats []Chat
	for _, id := range ids {
		chat, err := db.getChatWithOptions(id, true)
		if err != nil {
			return nil, fmt.Errorf("load chat %s: %w", id, err)
		}
		chats = append(chats, *chat)
	}
	return chats, nil
}

func (db *database) getChatWithOptions(id string, loadAttachmentData bool) (*Chat, error) {
	query := `
		SELECT id, title, created_at, browser_state, pinned, folder
		FROM chats
		WHERE id = ?
	`

	var chat Chat
	var createdAt time.Time
	var browserState sql.NullString

	err := db.conn.QueryRow(query, id).Scan(
		&chat.ID,
		&chat.Title,
		&createdAt,
		&browserState,
		&chat.Pinned,
		&chat.Folder,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("chat not found")
		}
		return nil, fmt.Errorf("query chat: %w", err)
	}

	chat.CreatedAt = createdAt
	if browserState.Valid && browserState.String != "" {
		var raw json.RawMessage
		if err := json.Unmarshal([]byte(browserState.String), &raw); err == nil {
			chat.BrowserState = raw
		}
	}

	messages, err := db.getMessages(id, loadAttachmentData)
	if err != nil {
		return nil, fmt.Errorf("get messages: %w", err)
	}
	chat.Messages = messages

	return &chat, nil
}

func (db *database) saveChat(chat Chat) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	query := `
		INSERT INTO chats (id, title, created_at, browser_state, pinned, folder)
		VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			browser_state = COALESCE(excluded.browser_state, chats.browser_state),
			pinned = excluded.pinned,
			folder = excluded.folder
	`

	var browserState sql.NullString
	if chat.BrowserState != nil {
		browserState = sql.NullString{String: string(chat.BrowserState), Valid: true}
	}

	_, err = tx.Exec(query,
		chat.ID,
		chat.Title,
		chat.CreatedAt,
		browserState,
		chat.Pinned,
		chat.Folder,
	)
	if err != nil {
		return fmt.Errorf("save chat: %w", err)
	}

	_, err = tx.Exec("DELETE FROM messages WHERE chat_id = ?", chat.ID)
	if err != nil {
		return fmt.Errorf("delete messages: %w", err)
	}

	for _, msg := range chat.Messages {
		messageID, err := db.insertMessage(tx, chat.ID, msg)
		if err != nil {
			return fmt.Errorf("insert message: %w", err)
		}

		if err := db.insertToolCallsBatch(tx, messageID, msg.ToolCalls); err != nil {
			return fmt.Errorf("insert tool calls: %w", err)
		}
	}

	return tx.Commit()
}

func (db *database) updateChatBrowserState(chatID string, state json.RawMessage) error {
	_, err := db.conn.Exec(`UPDATE chats SET browser_state = ? WHERE id = ?`, string(state), chatID)
	if err != nil {
		return fmt.Errorf("update chat browser state: %w", err)
	}
	return nil
}

func (db *database) deleteChat(id string) error {
	_, err := db.conn.Exec("DELETE FROM chats WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("delete chat: %w", err)
	}

	if _, err := db.conn.Exec("PRAGMA wal_checkpoint(PASSIVE);"); err != nil {
		slog.Warn("wal_checkpoint after delete failed", "error", err)
	}

	return nil
}

func (db *database) deleteAllChats() error {
	_, err := db.conn.Exec("DELETE FROM chats")
	return err
}

func (db *database) deleteChatsOlderThan(days int) (int64, error) {
	result, err := db.conn.Exec("DELETE FROM chats WHERE created_at < datetime('now', ?)", fmt.Sprintf("-%d days", days))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func (db *database) pinChat(id string, pinned bool) error {
	_, err := db.conn.Exec(`UPDATE chats SET pinned = ? WHERE id = ?`, pinned, id)
	return err
}

func (db *database) setChatFolder(id, folder string) error {
	_, err := db.conn.Exec(`UPDATE chats SET folder = ? WHERE id = ?`, folder, id)
	return err
}

// ============================================================
// Message CRUD (batch-optimized)
// ============================================================

func (db *database) updateLastMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	var messageID int64
	err = tx.QueryRow(`
		SELECT MAX(id) FROM messages WHERE chat_id = ?
	`, chatID).Scan(&messageID)
	if err != nil {
		return fmt.Errorf("get last message id: %w", err)
	}

	query := `
		UPDATE messages
		SET content = ?, thinking = ?, model_name = ?, updated_at = ?, thinking_time_start = ?, thinking_time_end = ?, tool_result = ?
		WHERE id = ?
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	result, err := tx.Exec(query,
		msg.Content,
		msg.Thinking,
		modelName,
		msg.UpdatedAt,
		thinkingTimeStart,
		thinkingTimeEnd,
		toolResultJSON,
		messageID,
	)
	if err != nil {
		return fmt.Errorf("update last message: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("get rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return fmt.Errorf("no message found to update")
	}

	_, err = tx.Exec("DELETE FROM attachments WHERE message_id = ?", messageID)
	if err != nil {
		return fmt.Errorf("delete existing attachments: %w", err)
	}
	if err := db.insertAttachmentsBatch(tx, messageID, msg.Attachments); err != nil {
		return fmt.Errorf("insert attachments: %w", err)
	}

	_, err = tx.Exec("DELETE FROM tool_calls WHERE message_id = ?", messageID)
	if err != nil {
		return fmt.Errorf("delete existing tool calls: %w", err)
	}
	if err := db.insertToolCallsBatch(tx, messageID, msg.ToolCalls); err != nil {
		return fmt.Errorf("insert tool calls: %w", err)
	}

	return tx.Commit()
}

func (db *database) updateLastMessageContentByID(messageID int64, content, thinking string, thinkingTimeStart, thinkingTimeEnd *time.Time) error {
	var tStart, tEnd sql.NullTime
	if thinkingTimeStart != nil {
		tStart = sql.NullTime{Time: *thinkingTimeStart, Valid: true}
	}
	if thinkingTimeEnd != nil {
		tEnd = sql.NullTime{Time: *thinkingTimeEnd, Valid: true}
	}
	_, err := db.conn.Exec(
		`UPDATE messages SET content = ?, thinking = ?, updated_at = ?, thinking_time_start = ?, thinking_time_end = ? WHERE id = ?`,
		content, thinking, time.Now(), tStart, tEnd, messageID,
	)
	return err
}

func (db *database) getLastMessageID(chatID string) (int64, error) {
	var id int64
	err := db.conn.QueryRow(`SELECT MAX(id) FROM messages WHERE chat_id = ?`, chatID).Scan(&id)
	return id, err
}

func (db *database) appendMessage(chatID string, msg Message) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	messageID, err := db.insertMessage(tx, chatID, msg)
	if err != nil {
		return fmt.Errorf("insert message: %w", err)
	}

	if err := db.insertToolCallsBatch(tx, messageID, msg.ToolCalls); err != nil {
		return fmt.Errorf("insert tool calls: %w", err)
	}

	return tx.Commit()
}

func (db *database) getMessages(chatID string, loadAttachmentData bool) ([]Message, error) {
	query := `
		SELECT id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result
		FROM messages
		WHERE chat_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, chatID)
	if err != nil {
		return nil, fmt.Errorf("query messages: %w", err)
	}

	// Phase 1: scan all rows into memory and close the cursor.
	// This frees the connection so sub-queries can reuse it (MaxOpenConns=1).
	type scannedMsg struct {
		id                                int64
		msg                               Message
		thinkingTimeStart, thinkingTimeEnd sql.NullTime
		modelName                         sql.NullString
		toolResult                        sql.NullString
	}
	var scanned []scannedMsg

	for rows.Next() {
		var s scannedMsg
		err := rows.Scan(
			&s.id,
			&s.msg.Role,
			&s.msg.Content,
			&s.msg.Thinking,
			&s.msg.Stream,
			&s.modelName,
			&s.msg.CreatedAt,
			&s.msg.UpdatedAt,
			&s.thinkingTimeStart,
			&s.thinkingTimeEnd,
			&s.toolResult,
		)
		if err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan message: %w", err)
		}
		scanned = append(scanned, s)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("iterate messages: %w", err)
	}
	rows.Close()

	// Phase 2: batch-load all attachments and tool calls (2 queries instead of 2N).
	messageIDs := make([]int64, len(scanned))
	for i, s := range scanned {
		messageIDs[i] = s.id
	}

	attachmentMap, err := db.getAttachmentsBatch(messageIDs, loadAttachmentData)
	if err != nil {
		return nil, fmt.Errorf("batch get attachments: %w", err)
	}
	toolCallMap, err := db.getToolCallsBatch(messageIDs)
	if err != nil {
		return nil, fmt.Errorf("batch get tool calls: %w", err)
	}

	// Phase 3: assemble enriched messages.
	messages := make([]Message, 0, len(scanned))
	for _, s := range scanned {
		msg := s.msg

		msg.Attachments = attachmentMap[s.id]
		msg.ToolCalls = toolCallMap[s.id]

		if s.thinkingTimeStart.Valid {
			msg.ThinkingTimeStart = &s.thinkingTimeStart.Time
		}
		if s.thinkingTimeEnd.Valid {
			msg.ThinkingTimeEnd = &s.thinkingTimeEnd.Time
		}

		if s.toolResult.Valid && s.toolResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(s.toolResult.String), &result); err == nil {
				msg.ToolResult = &result
			}
		}

		if s.modelName.Valid && s.modelName.String != "" {
			msg.Model = s.modelName.String
		}

		messages = append(messages, msg)
	}

	return messages, nil
}

func (db *database) insertMessage(tx *sql.Tx, chatID string, msg Message) (int64, error) {
	query := `
		INSERT INTO messages (chat_id, role, content, thinking, stream, model_name, created_at, updated_at, thinking_time_start, thinking_time_end, tool_result)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	var thinkingTimeStart, thinkingTimeEnd sql.NullTime
	if msg.ThinkingTimeStart != nil {
		thinkingTimeStart = sql.NullTime{Time: *msg.ThinkingTimeStart, Valid: true}
	}
	if msg.ThinkingTimeEnd != nil {
		thinkingTimeEnd = sql.NullTime{Time: *msg.ThinkingTimeEnd, Valid: true}
	}

	var modelName sql.NullString
	if msg.Model != "" {
		modelName = sql.NullString{String: msg.Model, Valid: true}
	}

	var toolResultJSON sql.NullString
	if msg.ToolResult != nil {
		resultBytes, err := json.Marshal(msg.ToolResult)
		if err != nil {
			return 0, fmt.Errorf("marshal tool result: %w", err)
		}
		toolResultJSON = sql.NullString{String: string(resultBytes), Valid: true}
	}

	result, err := tx.Exec(query,
		chatID,
		msg.Role,
		msg.Content,
		msg.Thinking,
		msg.Stream,
		modelName,
		msg.CreatedAt,
		msg.UpdatedAt,
		thinkingTimeStart,
		thinkingTimeEnd,
		toolResultJSON,
	)
	if err != nil {
		return 0, err
	}

	messageID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	if err := db.insertAttachmentsBatch(tx, messageID, msg.Attachments); err != nil {
		return 0, fmt.Errorf("insert attachments: %w", err)
	}

	return messageID, nil
}

// ============================================================
// Attachments & ToolCalls (batch-optimized)
// ============================================================

func (db *database) getAttachments(messageID int64, loadData bool) ([]File, error) {
	var query string
	if loadData {
		query = `
			SELECT filename, data
			FROM attachments
			WHERE message_id = ?
			ORDER BY id ASC
		`
	} else {
		query = `
			SELECT filename, '' as data
			FROM attachments
			WHERE message_id = ?
			ORDER BY id ASC
		`
	}

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query attachments: %w", err)
	}
	defer rows.Close()

	var attachments []File
	for rows.Next() {
		var file File
		err := rows.Scan(&file.Filename, &file.Data)
		if err != nil {
			return nil, fmt.Errorf("scan attachment: %w", err)
		}
		attachments = append(attachments, file)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate attachments: %w", err)
	}

	return attachments, nil
}

func (db *database) getAttachmentsBatch(messageIDs []int64, loadData bool) (map[int64][]File, error) {
	result := make(map[int64][]File, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}

	const batchSize = 500
	for start := 0; start < len(messageIDs); start += batchSize {
		end := start + batchSize
		if end > len(messageIDs) {
			end = len(messageIDs)
		}
		chunk := messageIDs[start:end]

		placeholders := strings.Repeat("?,", len(chunk))
		placeholders = placeholders[:len(placeholders)-1]

		args := make([]interface{}, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}

		var query string
		if loadData {
			query = fmt.Sprintf(`SELECT message_id, filename, data FROM attachments WHERE message_id IN (%s) ORDER BY id ASC`, placeholders)
		} else {
			query = fmt.Sprintf(`SELECT message_id, filename, '' as data FROM attachments WHERE message_id IN (%s) ORDER BY id ASC`, placeholders)
		}

		rows, err := db.conn.Query(query, args...)
		if err != nil {
			return nil, fmt.Errorf("batch query attachments: %w", err)
		}

		for rows.Next() {
			var msgID int64
			var file File
			if err := rows.Scan(&msgID, &file.Filename, &file.Data); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch scan attachment: %w", err)
			}
			result[msgID] = append(result[msgID], file)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch iterate attachments: %w", err)
		}
		rows.Close()
	}

	return result, nil
}

func (db *database) getToolCalls(messageID int64) ([]ToolCall, error) {
	query := `
		SELECT type, function_name, function_arguments, function_result
		FROM tool_calls
		WHERE message_id = ?
		ORDER BY id ASC
	`

	rows, err := db.conn.Query(query, messageID)
	if err != nil {
		return nil, fmt.Errorf("query tool calls: %w", err)
	}
	defer rows.Close()

	var toolCalls []ToolCall
	for rows.Next() {
		var tc ToolCall
		var functionResult sql.NullString

		err := rows.Scan(
			&tc.Type,
			&tc.Function.Name,
			&tc.Function.Arguments,
			&functionResult,
		)
		if err != nil {
			return nil, fmt.Errorf("scan tool call: %w", err)
		}

		if functionResult.Valid && functionResult.String != "" {
			var result json.RawMessage
			if err := json.Unmarshal([]byte(functionResult.String), &result); err == nil {
				tc.Function.Result = &result
			}
		}

		toolCalls = append(toolCalls, tc)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tool calls: %w", err)
	}

	return toolCalls, nil
}

func (db *database) getToolCallsBatch(messageIDs []int64) (map[int64][]ToolCall, error) {
	result := make(map[int64][]ToolCall, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}

	const batchSize = 500
	for start := 0; start < len(messageIDs); start += batchSize {
		end := start + batchSize
		if end > len(messageIDs) {
			end = len(messageIDs)
		}
		chunk := messageIDs[start:end]

		placeholders := strings.Repeat("?,", len(chunk))
		placeholders = placeholders[:len(placeholders)-1]

		args := make([]interface{}, len(chunk))
		for i, id := range chunk {
			args[i] = id
		}

		query := fmt.Sprintf(`SELECT message_id, type, function_name, function_arguments, function_result FROM tool_calls WHERE message_id IN (%s) ORDER BY id ASC`, placeholders)

		rows, err := db.conn.Query(query, args...)
		if err != nil {
			return nil, fmt.Errorf("batch query tool calls: %w", err)
		}

		for rows.Next() {
			var msgID int64
			var tc ToolCall
			var functionResult sql.NullString

			if err := rows.Scan(&msgID, &tc.Type, &tc.Function.Name, &tc.Function.Arguments, &functionResult); err != nil {
				rows.Close()
				return nil, fmt.Errorf("batch scan tool call: %w", err)
			}

			if functionResult.Valid && functionResult.String != "" {
				var jsonResult json.RawMessage
				if err := json.Unmarshal([]byte(functionResult.String), &jsonResult); err == nil {
					tc.Function.Result = &jsonResult
				}
			}

			result[msgID] = append(result[msgID], tc)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, fmt.Errorf("batch iterate tool calls: %w", err)
		}
		rows.Close()
	}

	return result, nil
}

func (db *database) insertAttachment(tx *sql.Tx, messageID int64, file File) error {
	query := `
		INSERT INTO attachments (message_id, filename, data)
		VALUES (?, ?, ?)
	`
	_, err := tx.Exec(query, messageID, file.Filename, file.Data)
	return err
}

func (db *database) insertAttachmentsBatch(tx *sql.Tx, messageID int64, files []File) error {
	if len(files) == 0 {
		return nil
	}
	const maxPerBatch = 300
	for start := 0; start < len(files); start += maxPerBatch {
		end := start + maxPerBatch
		if end > len(files) {
			end = len(files)
		}
		batch := files[start:end]
		var sb strings.Builder
		sb.WriteString("INSERT INTO attachments (message_id, filename, data) VALUES ")
		args := make([]any, 0, len(batch)*3)
		for i, f := range batch {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString("(?, ?, ?)")
			args = append(args, messageID, f.Filename, f.Data)
		}
		if _, err := tx.Exec(sb.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

func (db *database) insertToolCall(tx *sql.Tx, messageID int64, tc ToolCall) error {
	query := `
		INSERT INTO tool_calls (message_id, type, function_name, function_arguments, function_result)
		VALUES (?, ?, ?, ?, ?)
	`

	var functionResult sql.NullString
	if tc.Function.Result != nil {
		resultJSON, err := json.Marshal(tc.Function.Result)
		if err != nil {
			return fmt.Errorf("marshal tool result: %w", err)
		}
		functionResult = sql.NullString{String: string(resultJSON), Valid: true}
	}

	_, err := tx.Exec(query,
		messageID,
		tc.Type,
		tc.Function.Name,
		tc.Function.Arguments,
		functionResult,
	)
	return err
}

func (db *database) insertToolCallsBatch(tx *sql.Tx, messageID int64, toolCalls []ToolCall) error {
	if len(toolCalls) == 0 {
		return nil
	}
	const maxPerBatch = 190
	for start := 0; start < len(toolCalls); start += maxPerBatch {
		end := start + maxPerBatch
		if end > len(toolCalls) {
			end = len(toolCalls)
		}
		batch := toolCalls[start:end]
		var sb strings.Builder
		sb.WriteString("INSERT INTO tool_calls (message_id, type, function_name, function_arguments, function_result) VALUES ")
		args := make([]any, 0, len(batch)*5)
		for i, tc := range batch {
			if i > 0 {
				sb.WriteString(", ")
			}
			sb.WriteString("(?, ?, ?, ?, ?)")
			var functionResult sql.NullString
			if tc.Function.Result != nil {
				resultJSON, err := json.Marshal(tc.Function.Result)
				if err != nil {
					return fmt.Errorf("marshal tool result: %w", err)
				}
				functionResult = sql.NullString{String: string(resultJSON), Valid: true}
			}
			args = append(args, messageID, tc.Type, tc.Function.Name, tc.Function.Arguments, functionResult)
		}
		if _, err := tx.Exec(sb.String(), args...); err != nil {
			return err
		}
	}
	return nil
}

// ============================================================
// Settings
// ============================================================

func (db *database) getID() (string, error) {
	var id string
	err := db.conn.QueryRow("SELECT device_id FROM settings").Scan(&id)
	if err != nil {
		return "", fmt.Errorf("get device id: %w", err)
	}
	return id, nil
}

func (db *database) setID(id string) error {
	_, err := db.conn.Exec("UPDATE settings SET device_id = ?", id)
	if err != nil {
		return fmt.Errorf("set device id: %w", err)
	}
	return nil
}

func (db *database) getHasCompletedFirstRun() (bool, error) {
	var hasCompletedFirstRun bool
	err := db.conn.QueryRow("SELECT has_completed_first_run FROM settings").Scan(&hasCompletedFirstRun)
	if err != nil {
		return false, fmt.Errorf("get has completed first run: %w", err)
	}
	return hasCompletedFirstRun, nil
}

func (db *database) setHasCompletedFirstRun(hasCompletedFirstRun bool) error {
	_, err := db.conn.Exec("UPDATE settings SET has_completed_first_run = ?", hasCompletedFirstRun)
	if err != nil {
		return fmt.Errorf("set has completed first run: %w", err)
	}
	return nil
}

func (db *database) getSettings() (Settings, error) {
	var s Settings

	err := db.conn.QueryRow(`
		SELECT expose, survey, browser, models, agent, tools, working_dir, context_length,
			airplane_mode, turbo_enabled, websearch_enabled, selected_model, sidebar_open,
			last_home_view, think_enabled, think_level, auto_update_enabled,
			encryption_enabled, rag_enabled, embedding_model,
			password_enabled, password_hash, auto_delete_on_failure,
			lock_timeout_minutes, auto_delete_days, clipboard_clear_seconds,
			search_enabled, rag_citations_enabled, rag_preview_enabled, artifacts_enabled,
			theme, keyboard_shortcuts_enabled,
			num_thread, keep_alive, max_loaded_models, kv_cache_type, num_batch, vulkan_enabled, num_parallel,
			response_mode, system_prompt, human_sub_mode, writing_style_rules, style_analysis_model
		FROM settings
	`).Scan(&s.Expose, &s.Survey, &s.Browser, &s.Models, &s.Agent, &s.Tools, &s.WorkingDir, &s.ContextLength,
		&s.AirplaneMode, &s.TurboEnabled, &s.WebSearchEnabled, &s.SelectedModel, &s.SidebarOpen,
		&s.LastHomeView, &s.ThinkEnabled, &s.ThinkLevel, &s.AutoUpdateEnabled,
		&s.EncryptionEnabled, &s.RAGEnabled, &s.EmbeddingModel,
		&s.PasswordEnabled, &s.PasswordHash, &s.AutoDeleteOnFailure,
		&s.LockTimeoutMinutes, &s.AutoDeleteDays, &s.ClipboardClearSeconds,
		&s.SearchEnabled, &s.RAGCitationsEnabled, &s.RAGPreviewEnabled, &s.ArtifactsEnabled,
		&s.Theme, &s.KeyboardShortcutsEnabled,
		&s.NumThread, &s.KeepAlive, &s.MaxLoadedModels, &s.KVCacheType, &s.NumBatch, &s.VulkanEnabled, &s.NumParallel,
		&s.ResponseMode, &s.SystemPrompt, &s.HumanSubMode, &s.WritingStyleRules, &s.StyleAnalysisModel)
	if err != nil {
		return Settings{}, fmt.Errorf("get settings: %w", err)
	}

	return s, nil
}

func (db *database) setSettings(s Settings) error {
	lastHomeView := strings.ToLower(strings.TrimSpace(s.LastHomeView))
	validLaunchView := map[string]struct{}{
		"launch":    {},
		"openclaw":  {},
		"claude":    {},
		"hermes":    {},
		"codex":     {},
		"codex-app": {},
		"copilot":   {},
		"opencode":  {},
		"droid":     {},
		"pi":        {},
	}
	if lastHomeView != "chat" {
		if _, ok := validLaunchView[lastHomeView]; !ok {
			lastHomeView = "launch"
		}
	}

	_, err := db.conn.Exec(`
		UPDATE settings
		SET expose = ?, survey = ?, browser = ?, models = ?, agent = ?, tools = ?, working_dir = ?, context_length = ?,
			airplane_mode = ?, turbo_enabled = ?, websearch_enabled = ?, selected_model = ?, sidebar_open = ?,
			last_home_view = ?, think_enabled = ?, think_level = ?, auto_update_enabled = ?,
			encryption_enabled = ?, rag_enabled = ?, embedding_model = ?,
			password_enabled = ?, password_hash = ?, auto_delete_on_failure = ?,
			lock_timeout_minutes = ?, auto_delete_days = ?, clipboard_clear_seconds = ?,
			search_enabled = ?, rag_citations_enabled = ?, rag_preview_enabled = ?, artifacts_enabled = ?,
			theme = ?, keyboard_shortcuts_enabled = ?,
			num_thread = ?, keep_alive = ?, max_loaded_models = ?, kv_cache_type = ?, num_batch = ?, vulkan_enabled = ?, num_parallel = ?,
			response_mode = ?, system_prompt = ?, human_sub_mode = ?, writing_style_rules = ?, style_analysis_model = ?
	`, s.Expose, s.Survey, s.Browser, s.Models, s.Agent, s.Tools, s.WorkingDir, s.ContextLength,
		s.AirplaneMode, s.TurboEnabled, s.WebSearchEnabled, s.SelectedModel, s.SidebarOpen,
		lastHomeView, s.ThinkEnabled, s.ThinkLevel, s.AutoUpdateEnabled,
		s.EncryptionEnabled, s.RAGEnabled, s.EmbeddingModel,
		s.PasswordEnabled, s.PasswordHash, s.AutoDeleteOnFailure,
		s.LockTimeoutMinutes, s.AutoDeleteDays, s.ClipboardClearSeconds,
		s.SearchEnabled, s.RAGCitationsEnabled, s.RAGPreviewEnabled, s.ArtifactsEnabled,
		s.Theme, s.KeyboardShortcutsEnabled,
		s.NumThread, s.KeepAlive, s.MaxLoadedModels, s.KVCacheType, s.NumBatch, s.VulkanEnabled, s.NumParallel,
		s.ResponseMode, s.SystemPrompt, s.HumanSubMode, s.WritingStyleRules, s.StyleAnalysisModel)
	if err != nil {
		return fmt.Errorf("set settings: %w", err)
	}
	return nil
}

func (db *database) isCloudSettingMigrated() (bool, error) {
	var migrated bool
	err := db.conn.QueryRow("SELECT cloud_setting_migrated FROM settings").Scan(&migrated)
	if err != nil {
		return false, fmt.Errorf("get cloud setting migration status: %w", err)
	}
	return migrated, nil
}

func (db *database) setCloudSettingMigrated(migrated bool) error {
	_, err := db.conn.Exec("UPDATE settings SET cloud_setting_migrated = ?", migrated)
	if err != nil {
		return fmt.Errorf("set cloud setting migration status: %w", err)
	}
	return nil
}

func (db *database) getAirplaneMode() (bool, error) {
	var airplaneMode bool
	err := db.conn.QueryRow("SELECT airplane_mode FROM settings").Scan(&airplaneMode)
	if err != nil {
		return false, fmt.Errorf("get airplane_mode: %w", err)
	}
	return airplaneMode, nil
}

func (db *database) getWindowSize() (int, int, error) {
	var width, height int
	err := db.conn.QueryRow("SELECT window_width, window_height FROM settings").Scan(&width, &height)
	if err != nil {
		return 0, 0, fmt.Errorf("get window size: %w", err)
	}
	return width, height, nil
}

func (db *database) setWindowSize(width, height int) error {
	_, err := db.conn.Exec("UPDATE settings SET window_width = ?, window_height = ?", width, height)
	if err != nil {
		return fmt.Errorf("set window size: %w", err)
	}
	return nil
}

func (db *database) isConfigMigrated() (bool, error) {
	var migrated bool
	err := db.conn.QueryRow("SELECT config_migrated FROM settings").Scan(&migrated)
	if err != nil {
		return false, fmt.Errorf("get config migrated: %w", err)
	}
	return migrated, nil
}

func (db *database) setConfigMigrated(migrated bool) error {
	_, err := db.conn.Exec("UPDATE settings SET config_migrated = ?", migrated)
	if err != nil {
		return fmt.Errorf("set config migrated: %w", err)
	}
	return nil
}

func (db *database) getSchemaVersion() (int, error) {
	var version int
	err := db.conn.QueryRow("SELECT schema_version FROM settings").Scan(&version)
	if err != nil {
		return 0, fmt.Errorf("get schema version: %w", err)
	}
	return version, nil
}

func (db *database) setSchemaVersion(version int) error {
	_, err := db.conn.Exec("UPDATE settings SET schema_version = ?", version)
	if err != nil {
		return fmt.Errorf("set schema version: %w", err)
	}
	return nil
}

// ============================================================
// User (disabled for Dromadaire — privacy fork)
// ============================================================

func (db *database) getUser() (*User, error) {
	return nil, nil
}

func (db *database) setUser(user User) error {
	return nil
}

func (db *database) clearUser() error {
	return nil
}

// ============================================================
// RAG documents & chunks
// ============================================================

func (db *database) insertRAGDocument(doc RAGDocument) error {
	_, err := db.conn.Exec(`
		INSERT INTO rag_documents (id, filename, file_size, content_hash, chunk_count, status, error_message, embedding_model, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, doc.ID, doc.Filename, doc.FileSize, doc.ContentHash, doc.ChunkCount, doc.Status, doc.ErrorMessage, doc.EmbeddingModel, doc.CreatedAt, doc.UpdatedAt)
	return err
}

func (db *database) getAllRAGDocuments() ([]RAGDocument, error) {
	rows, err := db.conn.Query(`
		SELECT id, filename, file_size, content_hash, chunk_count, status, error_message, embedding_model, progress_current, progress_total, created_at, updated_at
		FROM rag_documents ORDER BY created_at DESC LIMIT 1000
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []RAGDocument
	for rows.Next() {
		var d RAGDocument
		if err := rows.Scan(&d.ID, &d.Filename, &d.FileSize, &d.ContentHash, &d.ChunkCount, &d.Status, &d.ErrorMessage, &d.EmbeddingModel, &d.ProgressCurrent, &d.ProgressTotal, &d.CreatedAt, &d.UpdatedAt); err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}

func (db *database) getRAGDocumentByHash(hash string) (*RAGDocument, error) {
	var d RAGDocument
	err := db.conn.QueryRow(`
		SELECT id, filename, file_size, content_hash, chunk_count, status, error_message, embedding_model, progress_current, progress_total, created_at, updated_at
		FROM rag_documents WHERE content_hash = ?
	`, hash).Scan(&d.ID, &d.Filename, &d.FileSize, &d.ContentHash, &d.ChunkCount, &d.Status, &d.ErrorMessage, &d.EmbeddingModel, &d.ProgressCurrent, &d.ProgressTotal, &d.CreatedAt, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (db *database) updateRAGDocumentStatus(id, status, errorMsg string, chunkCount int) error {
	_, err := db.conn.Exec(`
		UPDATE rag_documents SET status = ?, error_message = ?, chunk_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
	`, status, errorMsg, chunkCount, id)
	return err
}

func (db *database) deleteRAGDocument(id string) error {
	_, err := db.conn.Exec(`DELETE FROM rag_documents WHERE id = ?`, id)
	return err
}

func (db *database) updateRAGDocumentProgress(id string, current, total int) error {
	_, err := db.conn.Exec(
		`UPDATE rag_documents SET progress_current = ?, progress_total = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		current, total, id)
	return err
}

func (db *database) insertRAGChunks(chunks []RAGChunk) error {
	tx, err := db.conn.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	const batchSize = 50
	for start := 0; start < len(chunks); start += batchSize {
		end := start + batchSize
		if end > len(chunks) {
			end = len(chunks)
		}
		batch := chunks[start:end]

		query := "INSERT INTO rag_chunks (document_id, chunk_index, content, embedding, embedding_dim, token_count) VALUES "
		args := make([]any, 0, len(batch)*6)
		for i, c := range batch {
			if i > 0 {
				query += ", "
			}
			query += "(?, ?, ?, ?, ?, ?)"
			args = append(args, c.DocumentID, c.ChunkIndex, c.Content, serializeEmbedding(c.Embedding), c.EmbeddingDim, c.TokenCount)
		}

		if _, err := tx.Exec(query, args...); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (db *database) getAllRAGChunksWithEmbeddings() ([]RAGChunk, error) {
	rows, err := db.conn.Query(`
		SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding, c.embedding_dim, c.token_count, d.filename
		FROM rag_chunks c JOIN rag_documents d ON c.document_id = d.id
		WHERE d.status = 'ready' AND c.embedding IS NOT NULL
		ORDER BY c.id DESC LIMIT ?
	`, maxVectorCacheEntries)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chunks []RAGChunk
	for rows.Next() {
		var c RAGChunk
		var embBytes []byte
		var filename string
		if err := rows.Scan(&c.ID, &c.DocumentID, &c.ChunkIndex, &c.Content, &embBytes, &c.EmbeddingDim, &c.TokenCount, &filename); err != nil {
			return nil, err
		}
		c.Embedding = deserializeEmbedding(embBytes)
		c.DocumentName = filename
		chunks = append(chunks, c)
	}
	return chunks, rows.Err()
}

func (db *database) getRAGChunksByDocument(docID string) ([]RAGChunk, error) {
	rows, err := db.conn.Query(`
		SELECT c.id, c.document_id, c.chunk_index, c.content, c.embedding_dim, c.token_count, d.filename
		FROM rag_chunks c JOIN rag_documents d ON c.document_id = d.id
		WHERE c.document_id = ?
		ORDER BY c.chunk_index
	`, docID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var chunks []RAGChunk
	for rows.Next() {
		var c RAGChunk
		var filename string
		if err := rows.Scan(&c.ID, &c.DocumentID, &c.ChunkIndex, &c.Content, &c.EmbeddingDim, &c.TokenCount, &filename); err != nil {
			return nil, err
		}
		c.DocumentName = filename
		chunks = append(chunks, c)
	}
	return chunks, rows.Err()
}

// ============================================================
// Login attempts
// ============================================================

func (db *database) incrementFailedAttempts() (int, error) {
	_, err := db.conn.Exec(
		"UPDATE login_attempts SET failed_count = failed_count + 1, last_failed_at = CURRENT_TIMESTAMP WHERE id = 1")
	if err != nil {
		return 0, err
	}
	var count int
	err = db.conn.QueryRow("SELECT failed_count FROM login_attempts WHERE id = 1").Scan(&count)
	return count, err
}

func (db *database) resetFailedAttempts() error {
	_, err := db.conn.Exec("UPDATE login_attempts SET failed_count = 0, last_failed_at = NULL WHERE id = 1")
	return err
}

func (db *database) getFailedAttempts() (int, error) {
	var count int
	err := db.conn.QueryRow("SELECT failed_count FROM login_attempts WHERE id = 1").Scan(&count)
	return count, err
}

// ============================================================
// Search
// ============================================================

func (db *database) searchChats(query string, s *Store) ([]SearchResult, error) {
	lowerQuery := strings.ToLower(query)

	key, err := s.getEncryptionKey()
	if err != nil {
		return nil, fmt.Errorf("encryption key: %w", err)
	}

	if key == nil {
		return db.searchChatsPlaintext(lowerQuery, query)
	}

	return db.searchChatsEncrypted(lowerQuery, query, key)
}

func (db *database) searchChatsPlaintext(lowerQuery, originalQuery string) ([]SearchResult, error) {
	likePattern := "%" + lowerQuery + "%"

	rows, err := db.conn.Query(`
		SELECT chat_id, title, role, content, created_at, source FROM (
			SELECT id AS chat_id, title, '' AS role, title AS content, created_at, 0 AS source
			FROM chats
			WHERE LOWER(title) LIKE ?
			UNION ALL
			SELECT m.chat_id, c.title, m.role, m.content, m.created_at, 1 AS source
			FROM messages m
			JOIN chats c ON c.id = m.chat_id
			WHERE LOWER(m.content) LIKE ?
		)
		ORDER BY source ASC, created_at DESC
	`, likePattern, likePattern)
	if err != nil {
		return nil, fmt.Errorf("search chats plaintext: %w", err)
	}
	defer rows.Close()

	seen := make(map[string]bool)
	var results []SearchResult

	for rows.Next() {
		var chatID, title, role, content string
		var createdAt time.Time
		var source int
		if err := rows.Scan(&chatID, &title, &role, &content, &createdAt, &source); err != nil {
			rows.Close()
			return nil, fmt.Errorf("searchChatsPlaintext scan: %w", err)
		}

		if seen[chatID] {
			continue
		}
		seen[chatID] = true

		var excerpt string
		if source == 0 {
			excerpt = title
		} else {
			lowerContent := strings.ToLower(content)
			idx := strings.Index(lowerContent, lowerQuery)
			if idx < 0 {
				continue
			}
			start := idx - 50
			if start < 0 {
				start = 0
			}
			end := idx + len(originalQuery) + 50
			if end > len(content) {
				end = len(content)
			}
			excerpt = content[start:end]
			if start > 0 {
				excerpt = "..." + excerpt
			}
			if end < len(content) {
				excerpt = excerpt + "..."
			}
		}

		results = append(results, SearchResult{
			ChatID:    chatID,
			ChatTitle: title,
			Role:      role,
			Excerpt:   excerpt,
			CreatedAt: createdAt,
		})
		if len(results) >= 20 {
			return results, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}

	return results, nil
}

func (db *database) searchChatsEncrypted(lowerQuery, originalQuery string, key []byte) ([]SearchResult, error) {
	chatRows, err := db.conn.Query(`SELECT id, title, created_at FROM chats ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("query chats for search: %w", err)
	}

	type chatRow struct {
		id        string
		title     string
		createdAt time.Time
	}
	var allChats []chatRow
	for chatRows.Next() {
		var c chatRow
		if err := chatRows.Scan(&c.id, &c.title, &c.createdAt); err != nil {
			chatRows.Close()
			return nil, fmt.Errorf("scan chat: %w", err)
		}
		allChats = append(allChats, c)
	}
	if err := chatRows.Err(); err != nil {
		chatRows.Close()
		return nil, fmt.Errorf("iterate chats: %w", err)
	}
	chatRows.Close()

	var results []SearchResult

	for _, c := range allChats {
		title := c.title
		if decrypted, err := DecryptString(key, title); err == nil {
			title = decrypted
		}

		if strings.Contains(strings.ToLower(title), lowerQuery) {
			results = append(results, SearchResult{
				ChatID:    c.id,
				ChatTitle: title,
				Role:      "",
				Excerpt:   title,
				CreatedAt: c.createdAt,
			})
			if len(results) >= 20 {
				return results, nil
			}
			continue
		}

		msgRows, err := db.conn.Query(
			`SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id LIMIT 100`, c.id,
		)
		if err != nil {
			slog.Warn("searchChatsEncrypted: query messages failed, skipping chat", "chat_id", c.id, "error", err)
			continue
		}

		for msgRows.Next() {
			var role, content string
			var msgCreatedAt time.Time
			if err := msgRows.Scan(&role, &content, &msgCreatedAt); err != nil {
				msgRows.Close()
				return nil, fmt.Errorf("searchChatsEncrypted scan chat %s: %w", c.id, err)
			}
			if decrypted, err := DecryptString(key, content); err == nil {
				content = decrypted
			}
			lowerContent := strings.ToLower(content)
			idx := strings.Index(lowerContent, lowerQuery)
			if idx >= 0 {
				start := idx - 50
				if start < 0 {
					start = 0
				}
				end := idx + len(originalQuery) + 50
				if end > len(content) {
					end = len(content)
				}
				excerpt := content[start:end]
				if start > 0 {
					excerpt = "..." + excerpt
				}
				if end < len(content) {
					excerpt = excerpt + "..."
				}

				results = append(results, SearchResult{
					ChatID:    c.id,
					ChatTitle: title,
					Role:      role,
					Excerpt:   excerpt,
					CreatedAt: msgCreatedAt,
				})
				if len(results) >= 20 {
					msgRows.Close()
					return results, nil
				}
				break
			}
		}
		if err := msgRows.Err(); err != nil {
			msgRows.Close()
			return nil, fmt.Errorf("searchChatsEncrypted iterate chat %s: %w", c.id, err)
		}
		msgRows.Close()
	}

	return results, nil
}

// updateMessageRAGSources stores RAG citation sources JSON for a specific message
func (db *database) updateMessageRAGSources(chatID string, messageIndex int, sourcesJSON string) error {
	var msgID int64
	err := db.conn.QueryRow(
		`SELECT id FROM messages WHERE chat_id = ? ORDER BY id LIMIT 1 OFFSET ?`,
		chatID, messageIndex,
	).Scan(&msgID)
	if err != nil {
		return fmt.Errorf("find message for rag sources: %w", err)
	}
	_, err = db.conn.Exec(`UPDATE messages SET rag_sources = ? WHERE id = ?`, sourcesJSON, msgID)
	return err
}
