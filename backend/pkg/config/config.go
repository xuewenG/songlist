package config

import (
	"fmt"
	"os"
	"path"
	"strings"
	"unicode"

	"gopkg.in/yaml.v3"
)

const DefaultJWTSecret = "your-secret-key-change-this-in-production"

type Config struct {
	Port        string `yaml:"port"`
	JWTSecret   string `yaml:"jwt_secret"`
	ContextPath string `yaml:"context_path"`
}

var AppConfig = &Config{}

func InitConfig() error {
	configBytes, err := os.ReadFile("config.yaml")
	if err != nil {
		return fmt.Errorf("读取配置文件失败: %w", err)
	}

	err = yaml.Unmarshal(configBytes, &AppConfig)
	if err != nil {
		return fmt.Errorf("解析配置文件失败: %w", err)
	}

	return AppConfig.Validate()
}

func (c *Config) Validate() error {
	jwtSecret := strings.TrimSpace(c.JWTSecret)
	if jwtSecret == "" {
		return fmt.Errorf("JWT 密钥不能为空，请配置 jwt_secret 后再启动")
	}
	if jwtSecret == DefaultJWTSecret {
		return fmt.Errorf("JWT 密钥仍为默认值，请修改 jwt_secret 后再启动")
	}
	c.JWTSecret = jwtSecret

	contextPath := strings.TrimSpace(c.ContextPath)
	if strings.ContainsAny(contextPath, "?#\\") || strings.ContainsFunc(contextPath, unicode.IsSpace) {
		return fmt.Errorf("context_path 必须是有效的 URL 路径")
	}

	trimmedContextPath := strings.Trim(contextPath, "/")
	if trimmedContextPath == "" {
		c.ContextPath = ""
		return nil
	}

	c.ContextPath = path.Clean("/" + trimmedContextPath)
	if c.ContextPath == "/" {
		c.ContextPath = ""
	}

	return nil
}
