package middleware

import (
	"errors"
	"songlist/pkg/config"
	"songlist/pkg/db"
	"songlist/pkg/model"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

func getJWTSecret() []byte {
	return []byte(config.AppConfig.JWTSecret)
}

type Claims struct {
	StreamerId uint `json:"streamerId"`
	jwt.RegisteredClaims
}

// generateToken 生成 JWT token
func GenerateToken(streamerId uint) (string, error) {
	now := time.Now()
	claims := Claims{
		StreamerId: streamerId,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(30 * 24 * time.Hour)),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(getJWTSecret())
}

// parseToken 解析 JWT token
func parseToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(
		tokenString,
		&Claims{},
		func(token *jwt.Token) (any, error) {
			return getJWTSecret(), nil
		},
	)

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*Claims); ok && token.Valid {
		var streamer model.Streamer
		if err := db.DB.First(&streamer, claims.StreamerId).Error; err != nil {
			return nil, errors.New("无效的streamerId")
		}

		return claims, nil
	}

	return nil, errors.New("无效的token")
}

func JWTAuth() gin.HandlerFunc {
	return func(c *gin.Context) {
		token := c.GetHeader("X-Token")
		if token == "" {
			c.Next()
			return
		}

		// 解析 token
		claims, err := parseToken(token)
		if err != nil {
			c.Next()
			return
		}

		// 将用户信息存储在上下文中
		c.Set("streamerId", claims.StreamerId)
		c.Next()
	}
}
