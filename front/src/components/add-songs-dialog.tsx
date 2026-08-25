import { useMemo, useRef, useState, type ChangeEvent } from 'react'
import type { Cell } from 'exceljs'
import { CircleAlert, Download, Info, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createSongs, getApiErrorMessage } from '@/lib/api'
import type { SongInput } from '@/types'

interface AddSongsDialogProps {
  open: boolean
  genres: string[]
  languages: string[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void | Promise<void>
}

interface SongRow extends SongInput {
  key: number
  sourceIndex?: number
  error?: string
}

const MAX_BATCH_SIZE = 1000
let nextRowKey = 1

function createEmptyRow(): SongRow {
  return {
    key: nextRowKey++,
    title: '',
    artist: '',
    language: '',
    genre: '',
  }
}

function hasAnyValue(song: SongInput) {
  return Boolean(song.title.trim() || song.artist.trim() || song.language.trim() || song.genre.trim())
}

function hasRequiredFields(song: SongInput) {
  return Boolean(song.title.trim() && song.artist.trim())
}

function getSongDedupKey(song: Pick<SongInput, 'title' | 'artist'>) {
  const title = song.title.trim()
  const artist = song.artist.trim()
  return title && artist ? `${title.toLowerCase()}\u0000${artist.toLowerCase()}` : null
}

function getCellText(cell: Cell) {
  return cell.text.trim()
}

export function AddSongsDialog({
  open,
  genres,
  languages,
  onOpenChange,
  onSaved,
}: AddSongsDialogProps) {
  const [rows, setRows] = useState<SongRow[]>([createEmptyRow()])
  const [rowsToAdd, setRowsToAdd] = useState(1)
  const [importing, setImporting] = useState(false)
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const tableViewportRef = useRef<HTMLDivElement>(null)
  const rowElementRefs = useRef<Map<number, HTMLTableRowElement>>(new Map())
  const lastLocatedProblemKeyRef = useRef<number | undefined>(undefined)

  const filledRowCount = useMemo(() => rows.filter(hasAnyValue).length, [rows])
  const duplicateMessages = useMemo(() => {
    const messages = new Map<number, string>()
    const groupedRows = new Map<string, { row: SongRow; index: number }[]>()

    rows.forEach((row, index) => {
      const key = getSongDedupKey(row)
      if (!key) return
      const group = groupedRows.get(key) || []
      group.push({ row, index })
      groupedRows.set(key, group)
    })

    groupedRows.forEach((group) => {
      if (group.length < 2) return

      group.forEach(({ row }, groupIndex) => {
        const otherRow = group[groupIndex === 0 ? 1 : 0]
        messages.set(row.key, `与第 ${otherRow.index + 1} 行重复`)
      })
    })

    return messages
  }, [rows])
  const submittableRowCount = useMemo(
    () => rows.filter((row) => hasRequiredFields(row) && !duplicateMessages.has(row.key)).length,
    [duplicateMessages, rows],
  )
  const hasFailedRows = useMemo(() => rows.some((row) => Boolean(row.error)), [rows])
  const hasRowMessages = hasFailedRows || duplicateMessages.size > 0
  const problemRowKeys = useMemo(
    () =>
      rows
        .filter((row) => duplicateMessages.has(row.key) || Boolean(row.error))
        .map((row) => row.key),
    [duplicateMessages, rows],
  )
  const remainingCapacity = Math.max(0, MAX_BATCH_SIZE - rows.length)

  const resetRows = () => {
    setRows([createEmptyRow()])
    setRowsToAdd(1)
    lastLocatedProblemKeyRef.current = undefined
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !submitting) resetRows()
    if (!submitting) onOpenChange(nextOpen)
  }

  const updateRow = (key: number, field: keyof SongInput, value: string) => {
    setRows((currentRows) =>
      currentRows.map((row) =>
        row.key === key
          ? { ...row, [field]: value, error: undefined, sourceIndex: undefined }
          : row,
      ),
    )
  }

  const addRows = () => {
    if (remainingCapacity === 0) {
      toast.warning(`单次最多添加 ${MAX_BATCH_SIZE} 首歌曲`)
      return
    }

    const requestedCount = Number.isFinite(rowsToAdd) ? Math.max(1, Math.floor(rowsToAdd)) : 1
    const count = Math.min(requestedCount, remainingCapacity)
    setRows((currentRows) => [
      ...currentRows,
      ...Array.from({ length: count }, () => createEmptyRow()),
    ])
    if (count < requestedCount) toast.warning(`单次最多添加 ${MAX_BATCH_SIZE} 首歌曲`)
  }

  const removeRow = (key: number) => {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((row) => row.key !== key)
      return nextRows.length > 0 ? nextRows : [createEmptyRow()]
    })
  }

  const locateNextProblemRow = () => {
    if (problemRowKeys.length === 0) return

    const currentIndex = lastLocatedProblemKeyRef.current
      ? problemRowKeys.indexOf(lastLocatedProblemKeyRef.current)
      : -1
    const nextKey = problemRowKeys[(currentIndex + 1) % problemRowKeys.length]
    const rowElement = rowElementRefs.current.get(nextKey)
    const viewport = tableViewportRef.current
    if (!rowElement || !viewport) return

    const viewportRect = viewport.getBoundingClientRect()
    const rowRect = rowElement.getBoundingClientRect()
    const targetTop =
      viewport.scrollTop +
      rowRect.top -
      viewportRect.top -
      (viewport.clientHeight - rowRect.height) / 2

    lastLocatedProblemKeyRef.current = nextKey
    viewport.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }

  const importExcel = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setImporting(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load((await file.arrayBuffer()) as never)
      const worksheet = workbook.worksheets[0]
      if (!worksheet) throw new Error('Excel 文件中没有工作表')

      const headerAliases: Record<string, keyof SongInput> = {
        歌名: 'title',
        title: 'title',
        歌手: 'artist',
        artist: 'artist',
        语言: 'language',
        language: 'language',
        曲风: 'genre',
        genre: 'genre',
      }
      const columns = new Map<keyof SongInput, number>()
      worksheet.getRow(1).eachCell((cell, columnNumber) => {
        const field = headerAliases[getCellText(cell).toLowerCase()]
        if (field) columns.set(field, columnNumber)
      })

      if (!columns.has('title') || !columns.has('artist')) {
        throw new Error('表头不完整，请使用默认模板填写后再导入')
      }

      const importedRows: SongRow[] = []
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return
        const song: SongRow = {
          key: nextRowKey++,
          title: getCellText(row.getCell(columns.get('title')!)),
          artist: getCellText(row.getCell(columns.get('artist')!)),
          language: columns.has('language')
            ? getCellText(row.getCell(columns.get('language')!))
            : '',
          genre: columns.has('genre') ? getCellText(row.getCell(columns.get('genre')!)) : '',
        }
        if (hasAnyValue(song)) importedRows.push(song)
      })

      if (importedRows.length === 0) throw new Error('Excel 文件中没有可导入的歌曲')

      const manuallyEnteredRows = rows.filter(hasAnyValue)
      if (manuallyEnteredRows.length + importedRows.length > MAX_BATCH_SIZE) {
        throw new Error(`单次最多添加 ${MAX_BATCH_SIZE} 首歌曲`)
      }

      setRows([...manuallyEnteredRows, ...importedRows])
      toast.success(`已从 Excel 导入 ${importedRows.length} 首歌曲`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Excel 导入失败')
    } finally {
      setImporting(false)
    }
  }

  const downloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('歌曲导入模板')
      worksheet.columns = [
        { header: '歌名', key: 'title', width: 28 },
        { header: '歌手', key: 'artist', width: 24 },
        { header: '语言', key: 'language', width: 16 },
        { header: '曲风', key: 'genre', width: 16 },
      ]
      worksheet.views = [{ state: 'frozen', ySplit: 1 }]
      worksheet.autoFilter = 'A1:D1'
      worksheet.getRow(1).font = { bold: true }
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEDE9FE' },
      }
      worksheet.getCell('A1').note = '必填，例如：夜曲'
      worksheet.getCell('B1').note = '必填，例如：周杰伦'
      worksheet.getCell('C1').note = '选填，例如：国语'
      worksheet.getCell('D1').note = '选填，例如：流行'

      const buffer = await workbook.xlsx.writeBuffer()
      const url = URL.createObjectURL(
        new Blob([buffer as unknown as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      )
      const link = document.createElement('a')
      link.href = url
      link.download = '歌曲导入模板.xlsx'
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('模板下载失败')
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const submitSongs = async () => {
    const filledRows = rows.filter(hasAnyValue)
    if (filledRows.length === 0) {
      toast.warning('请至少填写一首歌曲')
      return
    }
    if (duplicateMessages.size > 0) {
      toast.warning('存在重复歌曲，请修改标红行后再提交')
      return
    }

    const songs = filledRows.map(({ title, artist, language, genre }) => ({
      title: title.trim(),
      artist: artist.trim(),
      language: language.trim(),
      genre: genre.trim(),
    }))

    setSubmitting(true)
    try {
      const result = await createSongs(songs)
      if (result.created.length > 0) await onSaved()

      if (result.failed.length > 0) {
        setRows(
          result.failed.map(({ index, song, reason }) => ({
            ...song,
            key: nextRowKey++,
            sourceIndex: index,
            error: reason,
          })),
        )
        toast.warning(
          `成功 ${result.created.length} 首，重复 ${result.skipped.length} 首，失败 ${result.failed.length} 首；请修改失败行后重试`,
        )
        return
      }

      if (result.created.length > 0) {
        const skippedMessage =
          result.skipped.length > 0 ? `，跳过重复歌曲 ${result.skipped.length} 首` : ''
        toast.success(`成功添加 ${result.created.length} 首歌曲${skippedMessage}`)
      } else {
        toast.warning(`没有新增歌曲，已跳过 ${result.skipped.length} 首重复歌曲`)
      }
      onOpenChange(false)
      resetRows()
    } catch (error) {
      toast.error(getApiErrorMessage(error, '歌曲添加失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-h-[92vh] w-[94vw] max-w-[920px] gap-4 overflow-hidden sm:max-w-[920px]"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg">添加歌曲</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 space-y-4 overflow-y-auto pr-1 pb-1">
          <Alert className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200">
            <Info />
            <AlertDescription className="text-current">
              当前表单会按照歌名和歌手检查重复，重复行将标红，请修改后再提交。
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
            >
              {importing ? <Loader2 className="animate-spin" /> : <Upload />}
              从 Excel 导入
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={downloadingTemplate}
              onClick={downloadTemplate}
            >
              {downloadingTemplate ? <Loader2 className="animate-spin" /> : <Download />}
              下载 Excel 模板
            </Button>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              支持 .xlsx 文件，歌名和歌手为必填列，语言和曲风为选填列
            </span>
            <Button
              type="button"
              variant="outline"
              className="ml-auto"
              disabled={problemRowKeys.length === 0}
              title={problemRowKeys.length === 0 ? '当前没有问题歌曲' : '跳转到下一条问题歌曲'}
              onClick={locateNextProblemRow}
            >
              <CircleAlert />
              下一个问题（{problemRowKeys.length}）
            </Button>
            <input
              ref={fileInputRef}
              className="hidden"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={importExcel}
            />
          </div>

          <div
            ref={tableViewportRef}
            className="max-h-[430px] overflow-auto rounded-xl border bg-background/70"
          >
            <Table className="min-w-[790px]">
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-12 text-center">#</TableHead>
                  <TableHead className="min-w-40">歌名（必填）</TableHead>
                  <TableHead className="min-w-36">歌手（必填）</TableHead>
                  <TableHead className="min-w-32">语言（选填）</TableHead>
                  <TableHead className="min-w-32">曲风（选填）</TableHead>
                  {hasRowMessages && <TableHead className="min-w-40">提示</TableHead>}
                  <TableHead className="w-14" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => {
                  const duplicateMessage = duplicateMessages.get(row.key)
                  const rowMessage =
                    duplicateMessage ||
                    (row.error ? `原第 ${row.sourceIndex} 行：${row.error}` : undefined)

                  return (
                  <TableRow
                    key={row.key}
                    ref={(element) => {
                      if (element) rowElementRefs.current.set(row.key, element)
                      else rowElementRefs.current.delete(row.key)
                    }}
                    className={
                      duplicateMessage
                        ? 'bg-red-50/80 hover:bg-red-50/80 dark:bg-red-950/25 dark:hover:bg-red-950/25'
                        : 'hover:bg-transparent'
                    }
                  >
                    <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <Input
                        value={row.title}
                        maxLength={255}
                        aria-invalid={Boolean(duplicateMessage || (row.error && !row.title.trim()))}
                        placeholder="请输入歌名"
                        onChange={(event) => updateRow(row.key, 'title', event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.artist}
                        maxLength={255}
                        aria-invalid={Boolean(duplicateMessage || (row.error && !row.artist.trim()))}
                        placeholder="请输入歌手"
                        onChange={(event) => updateRow(row.key, 'artist', event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.language}
                        maxLength={50}
                        list="song-language-options"
                        placeholder="请选择或输入"
                        onChange={(event) => updateRow(row.key, 'language', event.target.value)}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.genre}
                        maxLength={100}
                        list="song-genre-options"
                        placeholder="请选择或输入"
                        onChange={(event) => updateRow(row.key, 'genre', event.target.value)}
                      />
                    </TableCell>
                    {hasRowMessages && (
                      <TableCell className="whitespace-normal text-sm text-red-500">
                        {rowMessage}
                      </TableCell>
                    )}
                    <TableCell className="text-center">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`删除第 ${index + 1} 行`}
                        onClick={() => removeRow(row.key)}
                      >
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          <datalist id="song-language-options">
            {languages.map((language) => (
              <option key={language} value={language} />
            ))}
          </datalist>
          <datalist id="song-genre-options">
            {genres.map((genre) => (
              <option key={genre} value={genre} />
            ))}
          </datalist>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <Button
                type="button"
                variant="ghost"
                className="px-2 text-purple-600 hover:bg-purple-500/10 hover:text-purple-700 dark:text-purple-300"
                disabled={remainingCapacity === 0}
                onClick={addRows}
              >
                <Plus />
                添加
              </Button>
              <Input
                type="number"
                min={1}
                max={remainingCapacity || 1}
                step={1}
                value={rowsToAdd}
                aria-label="要添加的行数"
                className="rows-to-add-input w-20 text-center"
                onChange={(event) => {
                  const value = event.target.valueAsNumber
                  setRowsToAdd(Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1)
                }}
              />
              <span>行</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {duplicateMessages.size > 0 && (
                <span className="font-medium text-red-500">重复 {duplicateMessages.size} 行</span>
              )}
              <span className="text-gray-500 dark:text-gray-400">
                已填写 {filledRowCount} 行，可提交 {submittableRowCount} 行
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 border-0 bg-transparent p-0 pt-2">
          <Button type="button" variant="outline" disabled={submitting} onClick={() => handleOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || duplicateMessages.size > 0}
            onClick={submitSongs}
          >
            {submitting && <Loader2 className="animate-spin" />}
            添加歌曲
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
