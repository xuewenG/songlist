package router

import (
	"songlist/pkg/handler"
	"songlist/pkg/middleware"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SetupRouter(r *gin.Engine, db *gorm.DB, contextPath string) {
	// 创建处理器实例
	streamerHandler := handler.NewStreamerHandler(db)
	songHandler := handler.NewSongHandler(db)

	api := r.Group(contextPath + "/api")
	api.Use(middleware.JWTAuth())

	// 主播相关路由
	streamer := api.Group("/streamer")
	{
		streamer.GET("/profile", streamerHandler.GetProfile)
		streamer.POST("/register", streamerHandler.Register)
		streamer.POST("/login", streamerHandler.Login)
		streamer.POST("/change-password", streamerHandler.ChangePassword)
	}

	// 歌曲相关路由
	song := api.Group("/song")
	{
		song.GET("/list", songHandler.ListSong)
		song.POST("/create", songHandler.CreateSong)
		song.POST("/update", songHandler.UpdateSong)
		song.POST("/delete", songHandler.DeleteSong)
		song.POST("/toggle-top", songHandler.ToggleTop)
	}
}
