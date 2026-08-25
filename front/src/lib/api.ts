import axios from 'axios'

import type { CreateSongsResponse, LoginResponse, Song, SongInput, Streamer } from '@/types'

export const TOKEN_STORAGE_KEY = 'x-token'

const contextPath =
  document.querySelector<HTMLMetaElement>('meta[name="songlist-context-path"]')?.content ?? ''

const api = axios.create({
  baseURL: `${contextPath}/api`,
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (token) config.headers['X-Token'] = token
  return config
})

export async function getStreamerProfile(): Promise<Streamer> {
  const { data } = await api.get('/streamer/profile')
  return data
}

export async function getSongList(): Promise<Song[]> {
  const { data } = await api.get('/song/list')
  return data
}

export async function login(password: string): Promise<LoginResponse> {
  const { data } = await api.post('/streamer/login', { password })
  return data
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.post('/streamer/change-password', { currentPassword, newPassword })
}

export async function createSongs(songs: SongInput[]): Promise<CreateSongsResponse> {
  const { data } = await api.post('/song/create', { songs })
  return data
}

export async function toggleSongTop(id: number): Promise<Song> {
  const { data } = await api.post('/song/toggle-top', { id })
  return data
}

export async function deleteSong(id: number): Promise<void> {
  await api.post('/song/delete', { id })
}

export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError<{ error?: string }>(error)) {
    return error.response?.data?.error || fallback
  }
  return error instanceof Error ? error.message : fallback
}
