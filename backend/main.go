package main

import (
	"log"

	"songlist/pkg/config"
	"songlist/pkg/db"
	"songlist/pkg/router"

	"github.com/gin-gonic/gin"
)

var mode string
var version string
var commitId string

func main() {
	err := config.InitConfig()
	if err != nil {
		log.Fatalf("初始化配置失败: %v", err)
	}

	db.InitDB()

	log.Printf(
		"服务器正在启动:\n模式: %s\n版本: %s\n提交ID: %s\n端口: %s\nContext Path: %s\n",
		mode,
		version,
		commitId,
		config.AppConfig.Port,
		config.AppConfig.ContextPath,
	)

	if config.AppConfig.Port == "" {
		log.Fatalf("无效的端口: %s\n", config.AppConfig.Port)
		return
	}

	if mode == "prod" {
		gin.SetMode(gin.ReleaseMode)
	}

	r := gin.Default()
	r.SetTrustedProxies(nil)

	router.SetupRouter(r, db.DB, config.AppConfig.ContextPath)
	setupStaticFiles(r, config.AppConfig.ContextPath)

	if err := r.Run(":" + config.AppConfig.Port); err != nil {
		log.Fatalf("启动服务器失败: %v", err)
	}
}
