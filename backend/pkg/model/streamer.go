package model

import (
	"time"

	"gorm.io/gorm"
)

type Streamer struct {
	Id        uint            `json:"id,omitempty" gorm:"column:id;primarykey"`
	Name      string          `json:"name,omitempty" gorm:"column:name;type:varchar(255);not null;unique"`
	RoomId    string          `json:"roomId,omitempty" gorm:"column:roomId;type:varchar(50);not null;unique"`
	Domain    string          `json:"domain,omitempty" gorm:"column:domain;type:varchar(255);not null;unique"`
	Password  string          `json:"-" gorm:"column:password;type:varchar(255);not null"`
	Avatar    string          `json:"avatar,omitempty" gorm:"column:avatar;type:varchar(255)"`
	Songs     *[]Song         `json:"songs,omitempty" gorm:"foreignKey:StreamerId"`
	CreatedAt *time.Time      `json:"createdAt,omitempty" gorm:"column:createdAt"`
	UpdatedAt *time.Time      `json:"updatedAt,omitempty" gorm:"column:updatedAt"`
	DeletedAt *gorm.DeletedAt `json:"deletedAt,omitempty" gorm:"column:deletedAt;index"`
}
