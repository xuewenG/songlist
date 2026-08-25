package model

import (
	"time"

	"gorm.io/gorm"
)

type Song struct {
	Id         uint            `json:"id,omitempty" gorm:"column:id;primarykey"`
	Title      string          `json:"title,omitempty" gorm:"column:title;type:varchar(255);not null"`
	Artist     string          `json:"artist,omitempty" gorm:"column:artist;type:varchar(255);not null"`
	Language   string          `json:"language,omitempty" gorm:"column:language;type:varchar(50);not null"`
	Genre      string          `json:"genre,omitempty" gorm:"column:genre;type:varchar(100);not null"`
	StreamerId uint            `json:"streamerId,omitempty" gorm:"column:streamerId;not null"`
	Streamer   *Streamer       `json:"streamer,omitempty" gorm:"foreignKey:StreamerId"`
	Sticky     bool            `json:"sticky" gorm:"column:sticky;default:false"`
	CreatedAt  *time.Time      `json:"createdAt,omitempty" gorm:"column:createdAt"`
	UpdatedAt  *time.Time      `json:"updatedAt,omitempty" gorm:"column:updatedAt"`
	DeletedAt  *gorm.DeletedAt `json:"deletedAt,omitempty" gorm:"column:deletedAt;index"`
}
