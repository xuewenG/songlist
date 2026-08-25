//go:build prod

package main

import (
	"embed"
	"io/fs"
)

//go:embed public
var embeddedPublicFiles embed.FS

func init() {
	publicFiles, err := fs.Sub(embeddedPublicFiles, "public")
	if err != nil {
		panic("初始化内嵌前端资源失败: " + err.Error())
	}
	staticFiles = publicFiles
}
