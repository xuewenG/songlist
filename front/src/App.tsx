import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ArrowUp,
  Library,
  ListFilter,
  Loader2,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  Video,
} from 'lucide-react'
import { toast } from 'sonner'

import { AddSongsDialog } from '@/components/add-songs-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  changePassword,
  deleteSong,
  getApiErrorMessage,
  getSongList,
  getStreamerProfile,
  login,
  TOKEN_STORAGE_KEY,
  toggleSongTop,
} from '@/lib/api'
import type { Song, Streamer } from '@/types'

const ALL_FILTER_VALUE = '__all__'

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('浏览器不支持复制功能')
}

function App() {
  const [streamer, setStreamer] = useState<Streamer | null>(null)
  const [songs, setSongs] = useState<Song[]>([])
  const [profileLoading, setProfileLoading] = useState(false)
  const [songsLoading, setSongsLoading] = useState(false)
  const [loginLoading, setLoginLoading] = useState(false)
  const [changePasswordLoading, setChangePasswordLoading] = useState(false)
  const [deletingSongId, setDeletingSongId] = useState<number | null>(null)
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) || '')
  const [searchKeyword, setSearchKeyword] = useState('')
  const [selectedGenre, setSelectedGenre] = useState('')
  const [selectedLanguage, setSelectedLanguage] = useState('')
  const [showLoginDialog, setShowLoginDialog] = useState(false)
  const [showChangePasswordDialog, setShowChangePasswordDialog] = useState(false)
  const [showAddSongsDialog, setShowAddSongsDialog] = useState(false)
  const [password, setPassword] = useState('')
  const [changePasswordForm, setChangePasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [songPendingDelete, setSongPendingDelete] = useState<Song | null>(null)
  const [togglingSongIds, setTogglingSongIds] = useState<Set<number>>(() => new Set())
  const lastAvatarClickTime = useRef(0)
  const avatarClickCount = useRef(0)

  const isLoggedIn = Boolean(token)
  const loading = profileLoading || songsLoading

  const fetchProfile = useCallback(async () => {
    setProfileLoading(true)
    try {
      setStreamer(await getStreamerProfile())
    } catch (error) {
      toast.error(getApiErrorMessage(error, '主播信息加载失败'))
    } finally {
      setProfileLoading(false)
    }
  }, [])

  const fetchSongs = useCallback(async () => {
    setSongsLoading(true)
    try {
      setSongs(await getSongList())
    } catch (error) {
      toast.error(getApiErrorMessage(error, '歌曲列表加载失败'))
    } finally {
      setSongsLoading(false)
    }
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- Initial API loading intentionally updates loading state.
    void Promise.all([fetchProfile(), fetchSongs()])
  }, [fetchProfile, fetchSongs])

  useEffect(() => {
    document.title = streamer ? `${streamer.name}的歌单` : '歌单'
  }, [streamer])

  const genres = useMemo(
    () => [...new Set(songs.map((song) => song.genre).filter((genre): genre is string => Boolean(genre)))],
    [songs],
  )
  const languages = useMemo(
    () => [
      ...new Set(
        songs.map((song) => song.language).filter((language): language is string => Boolean(language)),
      ),
    ],
    [songs],
  )
  const filteredSongs = useMemo(() => {
    const keyword = searchKeyword.toLowerCase()
    return songs.filter((song) => {
      if (keyword && !song.title.toLowerCase().includes(keyword)) return false
      if (selectedGenre && song.genre !== selectedGenre) return false
      if (selectedLanguage && song.language !== selectedLanguage) return false
      return true
    })
  }, [searchKeyword, selectedGenre, selectedLanguage, songs])

  const handleAvatarClick = () => {
    const now = Date.now()
    avatarClickCount.current = now - lastAvatarClickTime.current > 200 ? 1 : avatarClickCount.current + 1
    lastAvatarClickTime.current = now
    if (avatarClickCount.current === 5 && !isLoggedIn) {
      setShowLoginDialog(true)
      avatarClickCount.current = 0
    }
  }

  const handleLogin = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!password) {
      toast.warning('请输入密码')
      return
    }

    setLoginLoading(true)
    try {
      const result = await login(password)
      localStorage.setItem(TOKEN_STORAGE_KEY, result.token)
      setToken(result.token)
      setStreamer(result.streamer)
      setShowLoginDialog(false)
      setPassword('')
      toast.success('登录成功')
      await fetchSongs()
    } catch {
      toast.error('密码错误')
    } finally {
      setLoginLoading(false)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    void Promise.all([fetchProfile(), fetchSongs()])
  }

  const resetChangePasswordForm = () => {
    setChangePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
  }

  const handleChangePasswordDialogOpenChange = (open: boolean) => {
    if (changePasswordLoading) return
    setShowChangePasswordDialog(open)
    if (!open) resetChangePasswordForm()
  }

  const handleChangePassword = async (event?: FormEvent) => {
    event?.preventDefault()
    const { currentPassword, newPassword, confirmPassword } = changePasswordForm
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.warning('请填写完整的密码信息')
      return
    }
    if (Array.from(newPassword).length < 6) {
      toast.warning('新密码至少需要 6 个字符')
      return
    }
    if (new TextEncoder().encode(newPassword).length > 72) {
      toast.warning('新密码不能超过 72 个字节')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.warning('两次输入的新密码不一致')
      return
    }
    if (currentPassword === newPassword) {
      toast.warning('新密码不能与当前密码相同')
      return
    }

    setChangePasswordLoading(true)
    try {
      await changePassword(currentPassword, newPassword)
      toast.success('密码修改成功')
      setShowChangePasswordDialog(false)
      resetChangePasswordForm()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '密码修改失败'))
    } finally {
      setChangePasswordLoading(false)
    }
  }

  const copySongRequest = async (song: Song) => {
    try {
      await copyText(`点歌 ${song.title}`)
      toast.success('复制成功')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  const handleToggleSongTop = async (song: Song) => {
    setTogglingSongIds((currentIds) => new Set(currentIds).add(song.id))
    try {
      const updatedSong = await toggleSongTop(song.id)
      toast.success(updatedSong.sticky ? '已置顶' : '已取消置顶')
      await fetchSongs()
    } catch (error) {
      toast.error(getApiErrorMessage(error, song.sticky ? '取消置顶失败' : '置顶失败'))
    } finally {
      setTogglingSongIds((currentIds) => {
        const nextIds = new Set(currentIds)
        nextIds.delete(song.id)
        return nextIds
      })
    }
  }

  const handleDeleteSong = async () => {
    if (!songPendingDelete) return

    setDeletingSongId(songPendingDelete.id)
    try {
      await deleteSong(songPendingDelete.id)
      toast.success('歌曲已删除')
      setSongPendingDelete(null)
      await fetchSongs()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '歌曲删除失败'))
    } finally {
      setDeletingSongId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-pink-100 dark:from-gray-900 dark:to-gray-800">
      <main className="container mx-auto px-4 py-8">
        <Card className="mb-8 gap-0 rounded-2xl border-0 bg-white/60 p-5 ring-0 backdrop-blur-lg dark:bg-gray-800/60">
          <div className="flex items-center gap-4">
            {streamer?.avatar ? (
              <img
                src={streamer.avatar}
                alt={streamer.name}
                className="size-16 shrink-0 rounded-full border-2 border-purple-500 object-cover"
                onClick={handleAvatarClick}
              />
            ) : (
              <button
                type="button"
                aria-label="主播头像"
                className="flex size-16 shrink-0 items-center justify-center rounded-full border-2 border-purple-500 bg-purple-100 text-xl text-purple-700 dark:bg-purple-950 dark:text-purple-200"
                onClick={handleAvatarClick}
              >
                {streamer?.name?.slice(0, 1) || '歌'}
              </button>
            )}
            <div className="flex-1">
              <h1 className="text-2xl text-gray-900 dark:text-white">
                {streamer?.name}
                {isLoggedIn && (
                  <span className="ml-2 text-sm text-green-600 dark:text-green-400">[已登录]</span>
                )}
                {isLoggedIn && (
                  <button
                    type="button"
                    className="ml-2 text-sm text-blue-600 dark:text-blue-400"
                    onClick={() => setShowChangePasswordDialog(true)}
                  >
                    [修改密码]
                  </button>
                )}
                {isLoggedIn && (
                  <button
                    type="button"
                    className="ml-2 text-sm text-red-600 dark:text-red-400"
                    onClick={handleLogout}
                  >
                    [退出登录]
                  </button>
                )}
              </h1>
              <Button
                type="button"
                variant="outline"
                className="mt-2 rounded-full bg-white/80 hover:border-purple-500/10 hover:bg-purple-500/10 dark:bg-gray-900/60"
                disabled={!streamer?.roomId}
                onClick={() => window.open(`https://live.bilibili.com/${streamer?.roomId}`, '_blank')}
              >
                <Video />
                直播间
              </Button>
            </div>
          </div>
        </Card>

        <Card className="gap-0 rounded-2xl border-0 bg-white/60 p-5 ring-0 backdrop-blur-lg dark:bg-gray-800/60">
          <div className="mb-6 space-y-4 md:flex md:items-center md:gap-4 md:space-y-0">
            <div className="relative min-w-[300px] flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchKeyword}
                className="rounded-xl bg-white/60 pl-8 dark:bg-gray-900/40"
                placeholder="搜索歌曲..."
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </div>
            <Select
              value={selectedGenre}
              onValueChange={(value) => setSelectedGenre(value === ALL_FILTER_VALUE ? '' : value)}
            >
              <SelectTrigger className="w-full rounded-xl bg-white/60 md:w-[180px] dark:bg-gray-900/40">
                <SelectValue placeholder="所有曲风" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>全部</SelectItem>
                {genres.map((genre) => (
                  <SelectItem key={genre} value={genre}>
                    {genre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedLanguage}
              onValueChange={(value) =>
                setSelectedLanguage(value === ALL_FILTER_VALUE ? '' : value)
              }
            >
              <SelectTrigger className="w-full rounded-xl bg-white/60 md:w-[180px] dark:bg-gray-900/40">
                <SelectValue placeholder="所有语言" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_FILTER_VALUE}>全部</SelectItem>
                {languages.map((language) => (
                  <SelectItem key={language} value={language}>
                    {language}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isLoggedIn && (
              <Button type="button" onClick={() => setShowAddSongsDialog(true)}>
                <Plus />
                添加歌曲
              </Button>
            )}
          </div>

          <div className="mb-4 flex items-center justify-start gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5">
              <Library className="size-4" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                总数：
                <span className="font-semibold text-purple-600 dark:text-purple-100">
                  {songs.length}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5">
              <ListFilter className="size-4" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                筛选：
                <span className="font-semibold text-pink-600 dark:text-pink-400">
                  {filteredSongs.length}
                </span>
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl">
            <Table className="song-list-table min-w-[420px]">
              <TableHeader>
                <TableRow className="border-transparent hover:bg-transparent">
                  <TableHead className="min-w-24 font-bold">歌名</TableHead>
                  <TableHead className="min-w-24 font-bold">歌手</TableHead>
                  <TableHead className="min-w-20 font-bold">曲风</TableHead>
                  <TableHead className="min-w-20 font-bold">语言</TableHead>
                  {isLoggedIn && <TableHead className="w-24 text-center font-bold">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSongs.map((song) => (
                  <TableRow
                    key={song.id}
                    className="cursor-pointer border-transparent hover:bg-purple-500/10"
                    onClick={() => void copySongRequest(song)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {song.sticky && <Pin className="size-4" />}
                        <span className="font-medium">{song.title}</span>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{song.artist}</TableCell>
                    <TableCell className="font-medium">{song.genre}</TableCell>
                    <TableCell className="font-medium">{song.language}</TableCell>
                    {isLoggedIn && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-gray-600 hover:bg-purple-500/10 hover:text-purple-600 dark:text-gray-300 dark:hover:text-purple-300"
                            disabled={togglingSongIds.has(song.id) || deletingSongId === song.id}
                            aria-label={song.sticky ? `取消置顶 ${song.title}` : `置顶 ${song.title}`}
                            title={song.sticky ? '取消置顶' : '置顶'}
                            onClick={(event) => {
                              event.stopPropagation()
                              void handleToggleSongTop(song)
                            }}
                          >
                            {togglingSongIds.has(song.id) ? (
                              <Loader2 className="animate-spin" />
                            ) : song.sticky ? (
                              <PinOff />
                            ) : (
                              <Pin />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={togglingSongIds.has(song.id) || deletingSongId === song.id}
                            aria-label={`删除 ${song.title}`}
                            title="删除歌曲"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSongPendingDelete(song)
                            }}
                          >
                            {deletingSongId === song.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Trash2 />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {!songsLoading && filteredSongs.length === 0 && (
                  <TableRow className="border-transparent hover:bg-transparent">
                    <TableCell
                      colSpan={isLoggedIn ? 5 : 4}
                      className="h-24 text-center text-muted-foreground"
                    >
                      没有找到符合条件的歌曲，请尝试其他过滤条件
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                加载中
              </div>
            )}
          </div>
        </Card>
      </main>

      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        aria-label="回到顶部"
        className="fixed right-[18px] bottom-[98px] z-20 size-10 rounded-full bg-white/60 text-gray-700 shadow-[0_2px_12px_0_rgba(0,0,0,0.1)] backdrop-blur-sm hover:bg-white"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      >
        <ArrowUp />
      </Button>

      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100%-2rem)] max-w-[400px] sm:max-w-[400px]"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">登录</DialogTitle>
          </DialogHeader>
          <form className="grid grid-cols-[auto_1fr] items-center gap-3" onSubmit={handleLogin}>
            <label htmlFor="login-password">密码</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              autoFocus
              placeholder="请输入密码"
              onChange={(event) => setPassword(event.target.value)}
            />
          </form>
          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={loginLoading}
              onClick={() => setShowLoginDialog(false)}
            >
              取消
            </Button>
            <Button type="button" disabled={loginLoading} onClick={() => void handleLogin()}>
              {loginLoading && <Loader2 className="animate-spin" />}
              登录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(songPendingDelete)}
        onOpenChange={(open) => {
          if (!open && deletingSongId === null) setSongPendingDelete(null)
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-lg">删除歌曲</DialogTitle>
            <DialogDescription>
              确定要删除“{songPendingDelete?.title} - {songPendingDelete?.artist}”吗？删除后将从歌单中移除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={deletingSongId !== null}
              onClick={() => setSongPendingDelete(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletingSongId !== null}
              onClick={() => void handleDeleteSong()}
            >
              {deletingSongId !== null && <Loader2 className="animate-spin" />}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showChangePasswordDialog}
        onOpenChange={handleChangePasswordDialogOpenChange}
      >
        <DialogContent
          showCloseButton={false}
          className="w-[calc(100%-2rem)] max-w-[440px] sm:max-w-[440px]"
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="text-lg">修改密码</DialogTitle>
          </DialogHeader>
          <form
            className="grid grid-cols-[5rem_1fr] items-center gap-3"
            onSubmit={handleChangePassword}
          >
            <label htmlFor="current-password">当前密码</label>
            <Input
              id="current-password"
              type="password"
              value={changePasswordForm.currentPassword}
              autoComplete="current-password"
              autoFocus
              placeholder="请输入当前密码"
              onChange={(event) =>
                setChangePasswordForm((form) => ({
                  ...form,
                  currentPassword: event.target.value,
                }))
              }
            />
            <label htmlFor="new-password">新密码</label>
            <Input
              id="new-password"
              type="password"
              value={changePasswordForm.newPassword}
              maxLength={72}
              autoComplete="new-password"
              placeholder="至少 6 个字符"
              onChange={(event) =>
                setChangePasswordForm((form) => ({ ...form, newPassword: event.target.value }))
              }
            />
            <label htmlFor="confirm-password">确认密码</label>
            <Input
              id="confirm-password"
              type="password"
              value={changePasswordForm.confirmPassword}
              maxLength={72}
              autoComplete="new-password"
              placeholder="请再次输入新密码"
              onChange={(event) =>
                setChangePasswordForm((form) => ({
                  ...form,
                  confirmPassword: event.target.value,
                }))
              }
            />
          </form>
          <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={changePasswordLoading}
              onClick={() => handleChangePasswordDialogOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={changePasswordLoading}
              onClick={() => void handleChangePassword()}
            >
              {changePasswordLoading && <Loader2 className="animate-spin" />}
              确认修改
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddSongsDialog
        open={showAddSongsDialog}
        genres={genres}
        languages={languages}
        onOpenChange={setShowAddSongsDialog}
        onSaved={fetchSongs}
      />
    </div>
  )
}

export default App
