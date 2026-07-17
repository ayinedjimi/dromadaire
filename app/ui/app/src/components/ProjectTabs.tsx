import { useMemo, useState, useRef, useEffect } from "react";
import { useChats } from "@/hooks/useChats";
import { FolderSimple, Plus, X } from "@phosphor-icons/react";

interface ProjectTabsProps {
  activeFolder: string;
  onFolderChange: (folder: string) => void;
}

export function ProjectTabs({ activeFolder, onFolderChange }: ProjectTabsProps) {
  const { data } = useChats();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const folders = useMemo(() => {
    if (!data?.chatInfos) return [];
    const set = new Set<string>();
    data.chatInfos.forEach(c => { if (c.folder) set.add(c.folder); });
    return Array.from(set).sort();
  }, [data?.chatInfos]);

  const folderCounts = useMemo(() => {
    if (!data?.chatInfos) return new Map<string, number>();
    const counts = new Map<string, number>();
    data.chatInfos.forEach(c => {
      const f = c.folder || "";
      counts.set(f, (counts.get(f) || 0) + 1);
    });
    return counts;
  }, [data?.chatInfos]);

  useEffect(() => {
    if (showNewInput && inputRef.current) {
      inputRef.current.focus();
    }
  }, [showNewInput]);

  const handleCreateFolder = () => {
    const name = newFolderName.trim();
    if (name) {
      onFolderChange(name);
    }
    setShowNewInput(false);
    setNewFolderName("");
  };

  if (folders.length === 0 && !showNewInput) return null;

  const totalCount = data?.chatInfos?.length ?? 0;

  return (
    <div className="project-tabs">
      <div className="project-tabs-scroll" ref={scrollRef}>
        <button
          className={`project-tab ${!activeFolder ? "project-tab-active" : ""}`}
          onClick={() => onFolderChange("")}
        >
          <span>Tous</span>
          <span className="project-tab-count">{totalCount}</span>
        </button>

        {folders.map(f => (
          <button
            key={f}
            className={`project-tab ${activeFolder === f ? "project-tab-active" : ""}`}
            onClick={() => onFolderChange(activeFolder === f ? "" : f)}
          >
            <FolderSimple size={13} weight={activeFolder === f ? "fill" : "regular"} />
            <span>{f}</span>
            <span className="project-tab-count">{folderCounts.get(f) || 0}</span>
          </button>
        ))}

        {showNewInput ? (
          <div className="project-tab-new-input">
            <input
              ref={inputRef}
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") { setShowNewInput(false); setNewFolderName(""); }
              }}
              onBlur={handleCreateFolder}
              placeholder="Nom du projet..."
              className="project-tab-new-field"
            />
            <button
              className="project-tab-new-cancel"
              onMouseDown={e => { e.preventDefault(); setShowNewInput(false); setNewFolderName(""); }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            className="project-tab project-tab-add"
            onClick={() => setShowNewInput(true)}
            title="Nouveau projet"
          >
            <Plus size={13} />
          </button>
        )}
      </div>

      <style>{`
        .project-tabs {
          display: flex;
          align-items: center;
          border-bottom: 1px solid var(--pt-border, hsl(0 0% 92%));
          padding: 0 12px;
          flex-shrink: 0;
          background: var(--pt-bg, white);
        }
        .project-tabs-scroll {
          display: flex;
          align-items: center;
          gap: 2px;
          overflow-x: auto;
          scrollbar-width: none;
          -ms-overflow-style: none;
          padding: 6px 0;
        }
        .project-tabs-scroll::-webkit-scrollbar { display: none; }
        .project-tab {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 4px 10px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: var(--pt-tab-text, hsl(0 0% 50%));
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          cursor: pointer;
          transition: background 120ms, color 120ms;
          line-height: 1.5;
        }
        .project-tab:hover {
          background: var(--pt-tab-hover, hsl(0 0% 95%));
          color: var(--pt-tab-text-hover, hsl(0 0% 20%));
        }
        .project-tab-active {
          background: var(--pt-tab-active-bg, hsl(0 0% 92%));
          color: var(--pt-tab-active-text, hsl(0 0% 10%));
          font-weight: 600;
        }
        .project-tab-count {
          font-size: 10px;
          opacity: 0.6;
          font-weight: 400;
        }
        .project-tab-add {
          color: var(--pt-add-color, hsl(0 0% 55%));
          padding: 4px 6px;
        }
        .project-tab-add:hover {
          color: var(--pt-add-hover, hsl(0 0% 20%));
        }
        .project-tab-new-input {
          display: flex;
          align-items: center;
          gap: 2px;
        }
        .project-tab-new-field {
          width: 110px;
          padding: 3px 8px;
          border-radius: 6px;
          border: 1px solid var(--pt-input-border, hsl(217 70% 60%));
          background: var(--pt-input-bg, white);
          font-size: 12px;
          outline: none;
          color: inherit;
        }
        .project-tab-new-cancel {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 4px;
          border: none;
          background: transparent;
          color: var(--pt-tab-text, hsl(0 0% 50%));
          cursor: pointer;
        }

        @media (prefers-color-scheme: dark) {
          .project-tabs {
            --pt-border: hsl(0 0% 18%);
            --pt-bg: hsl(0 0% 7%);
          }
          .project-tab {
            --pt-tab-text: hsl(0 0% 50%);
            --pt-tab-hover: hsl(0 0% 16%);
            --pt-tab-text-hover: hsl(0 0% 80%);
          }
          .project-tab-active {
            --pt-tab-active-bg: hsl(0 0% 20%);
            --pt-tab-active-text: hsl(0 0% 92%);
          }
          .project-tab-new-field {
            --pt-input-border: hsl(217 50% 40%);
            --pt-input-bg: hsl(0 0% 15%);
          }
        }
        :root[data-theme="dark"] .project-tabs {
          --pt-border: hsl(0 0% 18%);
          --pt-bg: hsl(0 0% 7%);
        }
        :root[data-theme="dark"] .project-tab {
          --pt-tab-text: hsl(0 0% 50%);
          --pt-tab-hover: hsl(0 0% 16%);
          --pt-tab-text-hover: hsl(0 0% 80%);
        }
        :root[data-theme="dark"] .project-tab-active {
          --pt-tab-active-bg: hsl(0 0% 20%);
          --pt-tab-active-text: hsl(0 0% 92%);
        }
      `}</style>
    </div>
  );
}
