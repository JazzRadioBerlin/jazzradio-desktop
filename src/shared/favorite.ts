export type Favorite = {
  id: string;
  artist: string;
  title: string;
  artworkUrl?: string;
  addedAt: string;
};

export type FavoriteDraft = {
  artist: string;
  title: string;
  artworkUrl?: string | null;
};

export function favoriteId(artist: string, title: string): string {
  return `${artist} ${title}`
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function isFavorite(value: unknown): value is Favorite {
  if (!value || typeof value !== 'object') return false;
  const item = value as Favorite;
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.artist === 'string' &&
    typeof item.title === 'string' &&
    typeof item.addedAt === 'string' &&
    (item.artworkUrl === undefined || typeof item.artworkUrl === 'string')
  );
}
