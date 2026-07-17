import { useQuery } from "@tanstack/react-query";
import { searchChats, type SearchResult } from "@/api";
import { useDebounce } from "./useDebounce";

/**
 * React Query hook for searching conversations.
 * Debounces input by 300ms and only fires when query is non-empty.
 */
export function useSearch(query: string) {
  const debouncedQuery = useDebounce(query.trim(), 300);

  return useQuery<SearchResult[]>({
    queryKey: ["search-chats", debouncedQuery],
    queryFn: () => searchChats(debouncedQuery),
    enabled: debouncedQuery.length > 0,
    staleTime: 30_000,
  });
}
