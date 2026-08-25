export interface Streamer {
  id?: number
  name: string
  avatar?: string
  roomId: string | number
}

export interface Song {
  id: number
  title: string
  artist: string
  genre?: string
  language?: string
  sticky: boolean
}

export interface SongInput {
  title: string
  artist: string
  genre: string
  language: string
}

export interface FailedSong {
  index: number
  song: SongInput
  reason: string
}

export interface CreateSongsResponse {
  created: Song[]
  skipped: SongInput[]
  failed: FailedSong[]
}

export interface LoginResponse {
  token: string
  streamer: Streamer
}
