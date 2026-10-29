import { createContext, useContext } from 'react';
import { useAssetLibrary } from '../hooks/useAssetLibrary';

export type AssetLibraryContextValue = ReturnType<typeof useAssetLibrary>;

export const AssetLibraryContext = createContext<AssetLibraryContextValue | null>(null);

export function useAssetLibraryContext(): AssetLibraryContextValue {
  const ctx = useContext(AssetLibraryContext);
  if (!ctx) {
    throw new Error('useAssetLibraryContext must be used within AssetLibraryContext.Provider (e.g. inside AssetPage or AssetExpandedDialog)');
  }
  return ctx;
}
