// Dromadaire LOT 9B: Incognito mode context
// Conversations in incognito mode are never written to the database.
import { createContext, useContext, useState, useCallback, useMemo } from "react";

interface IncognitoContextType {
  incognito: boolean;
  toggleIncognito: () => void;
}

const IncognitoContext = createContext<IncognitoContextType>({
  incognito: false,
  toggleIncognito: () => {},
});

export const useIncognito = () => useContext(IncognitoContext);

export function IncognitoProvider({ children }: { children: React.ReactNode }) {
  const [incognito, setIncognito] = useState(false);
  const toggleIncognito = useCallback(
    () => setIncognito((prev) => !prev),
    [],
  );

  const value = useMemo(() => ({ incognito, toggleIncognito }), [incognito, toggleIncognito]);

  return (
    <IncognitoContext.Provider value={value}>
      {children}
    </IncognitoContext.Provider>
  );
}
