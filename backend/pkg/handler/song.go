package handler

import (
	"fmt"
	"log"
	"net/http"
	"songlist/pkg/model"
	"sort"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type SongHandler struct {
	BaseHandler
	createMu sync.Mutex
}

type songInput struct {
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Language string `json:"language"`
	Genre    string `json:"genre"`
}

type createSongInput struct {
	Songs []songInput `json:"songs"`
}

type createSongResponse struct {
	Created []model.Song `json:"created"`
	Skipped []songInput  `json:"skipped"`
	Failed  []failedSong `json:"failed"`
}

type indexedSong struct {
	Index int
	Song  songInput
}

type failedSong struct {
	Index  int       `json:"index"`
	Song   songInput `json:"song"`
	Reason string    `json:"reason"`
}

const maxBatchSongCount = 1000

func NewSongHandler(db *gorm.DB) *SongHandler {
	return &SongHandler{BaseHandler: *NewBaseHandler(db)}
}

// ListSong 获取歌曲列表
func (h *SongHandler) ListSong(c *gin.Context) {
	targetStreamerId, err := h.GetTargetStreamerId(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var songs []model.Song
	query := h.db.Model(&model.Song{}).Where("streamerId = ?", targetStreamerId).Order("sticky desc, artist asc")

	if err := query.Find(&songs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 访客请求时，删除敏感信息
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId != targetStreamerId {
		for i := range songs {
			songs[i].StreamerId = 0
			songs[i].CreatedAt = nil
			songs[i].UpdatedAt = nil
			songs[i].DeletedAt = nil
		}
	}

	c.JSON(http.StatusOK, songs)
}

// CreateSong 批量创建歌曲，按照歌名和歌手去重
func (h *SongHandler) CreateSong(c *gin.Context) {
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var input createSongInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(input.Songs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请至少添加一首歌曲"})
		return
	}
	if len(input.Songs) > maxBatchSongCount {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("单次最多添加 %d 首歌曲", maxBatchSongCount)})
		return
	}

	validSongs := make([]indexedSong, 0, len(input.Songs))
	failed := make([]failedSong, 0)
	for i := range input.Songs {
		normalizeSongInput(&input.Songs[i])
		if err := validateSongInput(input.Songs[i]); err != nil {
			failed = append(failed, failedSong{
				Index:  i + 1,
				Song:   input.Songs[i],
				Reason: err.Error(),
			})
			continue
		}
		validSongs = append(validSongs, indexedSong{Index: i + 1, Song: input.Songs[i]})
	}

	created, skipped, saveFailed, err := h.createSongs(currentStreamerId, validSongs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	failed = append(failed, saveFailed...)
	sort.Slice(failed, func(i, j int) bool {
		return failed[i].Index < failed[j].Index
	})

	c.JSON(http.StatusOK, createSongResponse{
		Created: created,
		Skipped: skipped,
		Failed:  failed,
	})
}

func normalizeSongInput(song *songInput) {
	song.Title = strings.TrimSpace(song.Title)
	song.Artist = strings.TrimSpace(song.Artist)
	song.Language = strings.TrimSpace(song.Language)
	song.Genre = strings.TrimSpace(song.Genre)
}

func validateSongInput(song songInput) error {
	if song.Title == "" {
		return fmt.Errorf("歌名不能为空")
	}
	if song.Artist == "" {
		return fmt.Errorf("歌手不能为空")
	}
	if utf8.RuneCountInString(song.Title) > 255 {
		return fmt.Errorf("歌名不能超过 255 个字符")
	}
	if utf8.RuneCountInString(song.Artist) > 255 {
		return fmt.Errorf("歌手不能超过 255 个字符")
	}
	if utf8.RuneCountInString(song.Language) > 50 {
		return fmt.Errorf("语言不能超过 50 个字符")
	}
	if utf8.RuneCountInString(song.Genre) > 100 {
		return fmt.Errorf("曲风不能超过 100 个字符")
	}

	return nil
}

func songDedupKey(title string, artist string) string {
	return strings.ToLower(strings.TrimSpace(title)) + "\x00" + strings.ToLower(strings.TrimSpace(artist))
}

func (h *SongHandler) createSongs(streamerId uint, songs []indexedSong) ([]model.Song, []songInput, []failedSong, error) {
	// 同一进程内串行化新增操作，避免并发请求在查询和写入之间产生重复数据。
	h.createMu.Lock()
	defer h.createMu.Unlock()

	var existingSongs []model.Song
	if err := h.db.Select("title", "artist").Where("streamerId = ?", streamerId).Find(&existingSongs).Error; err != nil {
		return nil, nil, nil, err
	}

	knownSongs := make(map[string]struct{}, len(existingSongs)+len(songs))
	for _, song := range existingSongs {
		knownSongs[songDedupKey(song.Title, song.Artist)] = struct{}{}
	}

	created := make([]model.Song, 0, len(songs))
	skipped := make([]songInput, 0)
	failed := make([]failedSong, 0)
	for _, indexed := range songs {
		song := indexed.Song
		key := songDedupKey(song.Title, song.Artist)
		if _, exists := knownSongs[key]; exists {
			skipped = append(skipped, song)
			continue
		}

		newSong := model.Song{
			Title:      song.Title,
			Artist:     song.Artist,
			Language:   song.Language,
			Genre:      song.Genre,
			StreamerId: streamerId,
		}
		if err := h.db.Create(&newSong).Error; err != nil {
			log.Printf("第 %d 首歌曲保存失败: %v", indexed.Index, err)
			failed = append(failed, failedSong{
				Index:  indexed.Index,
				Song:   song,
				Reason: "保存失败",
			})
			continue
		}

		knownSongs[key] = struct{}{}
		created = append(created, newSong)
	}

	return created, skipped, failed, nil
}

// UpdateSong 更新歌曲
func (h *SongHandler) UpdateSong(c *gin.Context) {
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var input struct {
		Id       uint   `json:"id" binding:"required"`
		Title    string `json:"title"`
		Artist   string `json:"artist"`
		Language string `json:"language"`
		Genre    string `json:"genre"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updatedInput := songInput{
		Title:    input.Title,
		Artist:   input.Artist,
		Language: input.Language,
		Genre:    input.Genre,
	}
	normalizeSongInput(&updatedInput)
	if err := validateSongInput(updatedInput); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.createMu.Lock()
	defer h.createMu.Unlock()

	// 检查权限
	var song model.Song
	if err := h.db.Where("id = ? AND streamerId = ?", input.Id, currentStreamerId).First(&song).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusForbidden, gin.H{"error": "没有权限修改该歌曲"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}

		return
	}

	var existingSongs []model.Song
	if err := h.db.Select("title", "artist").Where(
		"streamerId = ? AND id <> ?",
		currentStreamerId,
		input.Id,
	).Find(&existingSongs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	updatedSongKey := songDedupKey(updatedInput.Title, updatedInput.Artist)
	for _, existingSong := range existingSongs {
		if songDedupKey(existingSong.Title, existingSong.Artist) == updatedSongKey {
			c.JSON(http.StatusConflict, gin.H{"error": "歌名和歌手相同的歌曲已存在"})
			return
		}
	}

	// 更新字段
	song.Title = updatedInput.Title
	song.Artist = updatedInput.Artist
	song.Language = updatedInput.Language
	song.Genre = updatedInput.Genre

	if err := h.db.Save(&song).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, song)
}

// DeleteSong 删除歌曲
func (h *SongHandler) DeleteSong(c *gin.Context) {
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var input struct {
		Id uint `json:"id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查权限并删除
	result := h.db.Where("id = ? AND streamerId = ?", input.Id, currentStreamerId).Delete(&model.Song{})
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusForbidden, gin.H{"error": "没有权限删除该歌曲"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}

// ToggleTop 切换歌曲置顶状态
func (h *SongHandler) ToggleTop(c *gin.Context) {
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var input struct {
		Id uint `json:"id" binding:"required"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查权限
	var song model.Song
	if err := h.db.Where("id = ? AND streamerId = ?", input.Id, currentStreamerId).First(&song).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusForbidden, gin.H{"error": "没有权限修改该歌曲"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	// 切换置顶状态
	song.Sticky = !song.Sticky

	if err := h.db.Save(&song).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, song)
}
