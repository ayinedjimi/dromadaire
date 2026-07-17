import { createContext, useContext, useState, type ReactNode } from "react";

interface FolderContextValue {
  activeFolder: string;
  setActiveFolder: (folder: string) => void;
}

const FolderContext = createContext<FolderContextValue>({
  activeFolder: "",
  setActiveFolder: () => {},
});

export function FolderProvider({ children }: { children: ReactNode }) {
  const [activeFolder, setActiveFolder] = useState("");
  return (
    <FolderContext.Provider value={{ activeFolder, setActiveFolder }}>
      {children}
    </FolderContext.Provider>
  );
}

export function useFolder() {
  return useContext(FolderContext);
}
