package handler

import (
	"fmt"
	"songlist/pkg/model"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type BaseHandler struct {
	db *gorm.DB
}

func NewBaseHandler(db *gorm.DB) *BaseHandler {
	return &BaseHandler{db: db}
}

func (h *BaseHandler) GetCurrentStreamerId(c *gin.Context) uint {
	streamerId, exists := c.Get("streamerId")
	if !exists {
		return 0
	}

	return streamerId.(uint)
}

func (h *BaseHandler) GetCurrentStreamer(c *gin.Context) *model.Streamer {
	streamerId := h.GetCurrentStreamerId(c)
	if streamerId == 0 {
		return nil
	}

	var streamer model.Streamer
	if err := h.db.Where("id = ?", streamerId).First(&streamer).Error; err != nil {
		return nil
	}

	return &streamer
}

func (h *BaseHandler) GetTargetStreamerId(c *gin.Context) (uint, error) {
	streamerId := c.Query("streamerId")
	if streamerId != "" {
		id, err := strconv.ParseUint(streamerId, 10, 32)
		if err != nil {
			return 0, fmt.Errorf("主播ID格式错误")
		}

		return uint(id), nil
	}

	domain := c.Request.Host
	if domain == "" {
		return 0, fmt.Errorf("需要提供主播ID或域名")
	}

	var streamer model.Streamer
	if err := h.db.Where("domain = ?", domain).First(&streamer).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return 0, fmt.Errorf("未查询到域名对应的主播ID")
		}

		return 0, err
	}

	return streamer.Id, nil
}
