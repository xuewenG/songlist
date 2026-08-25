package handler

import (
	"net/http"
	"unicode/utf8"

	"songlist/pkg/middleware"
	"songlist/pkg/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type StreamerHandler struct {
	BaseHandler
}

func NewStreamerHandler(db *gorm.DB) *StreamerHandler {
	return &StreamerHandler{BaseHandler: *NewBaseHandler(db)}
}

// Register 主播注册
func (h *StreamerHandler) Register(c *gin.Context) {
	var input struct {
		Name     string `json:"name" binding:"required"`
		RoomId   string `json:"roomId" binding:"required"`
		Domain   string `json:"domain" binding:"required"`
		Password string `json:"password" binding:"required,min=6"`
		Avatar   string `json:"avatar"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 检查主播名称是否已存在
	var nameCount int64
	h.db.Model(&model.Streamer{}).Where("name = ?", input.Name).Count(&nameCount)
	if nameCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "主播名称已存在"})
		return
	}

	// 检查直播间ID是否已存在
	var roomCount int64
	h.db.Model(&model.Streamer{}).Where("roomId = ?", input.RoomId).Count(&roomCount)
	if roomCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "直播间ID已存在"})
		return
	}

	// 检查域名是否已存在
	var domainCount int64
	h.db.Model(&model.Streamer{}).Where("domain = ?", input.Domain).Count(&domainCount)
	if domainCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "域名已存在"})
		return
	}

	// 加密密码
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码加密失败"})
		return
	}

	// 创建主播
	streamer := model.Streamer{
		Name:     input.Name,
		RoomId:   input.RoomId,
		Domain:   input.Domain,
		Password: string(hashedPassword),
		Avatar:   input.Avatar,
	}

	if err := h.db.Create(&streamer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 生成 token
	token, err := middleware.GenerateToken(streamer.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"streamer": streamer,
	})
}

// Login 主播登录
func (h *StreamerHandler) Login(c *gin.Context) {
	var input struct {
		Password string `json:"password" binding:"required"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	targetStreamerId, err := h.GetTargetStreamerId(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var streamer model.Streamer
	if err := h.db.Where("id = ?", targetStreamerId).First(&streamer).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "主播不存在"})
		return
	}

	// 验证密码
	if err := bcrypt.CompareHashAndPassword([]byte(streamer.Password), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "密码错误"})
		return
	}

	// 生成 token
	token, err := middleware.GenerateToken(streamer.Id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成token失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":    token,
		"streamer": streamer,
	})
}

// ChangePassword 修改当前主播的登录密码
func (h *StreamerHandler) ChangePassword(c *gin.Context) {
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未认证"})
		return
	}

	var input struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请求参数格式错误"})
		return
	}
	if input.CurrentPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入当前密码"})
		return
	}
	if utf8.RuneCountInString(input.NewPassword) < 6 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "新密码至少需要 6 个字符"})
		return
	}
	if len([]byte(input.NewPassword)) > 72 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "新密码不能超过 72 个字节"})
		return
	}

	var streamer model.Streamer
	if err := h.db.First(&streamer, currentStreamerId).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "主播不存在"})
		return
	}

	if err := bcrypt.CompareHashAndPassword(
		[]byte(streamer.Password),
		[]byte(input.CurrentPassword),
	); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "当前密码错误"})
		return
	}

	if bcrypt.CompareHashAndPassword([]byte(streamer.Password), []byte(input.NewPassword)) == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "新密码不能与当前密码相同"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword(
		[]byte(input.NewPassword),
		bcrypt.DefaultCost,
	)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "新密码长度无效"})
		return
	}

	if err := h.db.Model(&streamer).Update("password", string(hashedPassword)).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "密码修改失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "密码修改成功"})
}

// GetProfile 获取主播信息
func (h *StreamerHandler) GetProfile(c *gin.Context) {
	targetStreamerId, err := h.GetTargetStreamerId(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var streamer model.Streamer
	if err := h.db.Where("id = ?", targetStreamerId).First(&streamer).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取主播信息失败"})
		return
	}

	// 访客请求时，删除敏感信息
	currentStreamerId := h.GetCurrentStreamerId(c)
	if currentStreamerId != targetStreamerId {
		streamer.Id = 0
		streamer.Domain = ""
		streamer.CreatedAt = nil
		streamer.UpdatedAt = nil
	}

	c.JSON(http.StatusOK, streamer)
}
