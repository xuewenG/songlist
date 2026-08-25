package db

import (
	"log"

	"songlist/pkg/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

var DB *gorm.DB

func InitDB() {
	var err error
	DB, err = gorm.Open(sqlite.Open("songlist.db"), &gorm.Config{})
	if err != nil {
		log.Fatalf("连接数据库失败: %v", err)
	}

	err = DB.AutoMigrate(&model.Streamer{}, &model.Song{})
	if err != nil {
		log.Fatalf("数据库迁移失败: %v", err)
	}
}
