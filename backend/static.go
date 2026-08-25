package main

import (
	"bytes"
	"html"
	"io/fs"
	"net/http"
	"path"
	"strings"

	"github.com/gin-gonic/gin"
)

var staticFiles fs.FS

func setupStaticFiles(r *gin.Engine, contextPath string) {
	if staticFiles == nil {
		return
	}

	indexHTML, err := fs.ReadFile(staticFiles, "index.html")
	if err != nil {
		panic("读取内嵌前端首页失败: " + err.Error())
	}
	pageBasePath := contextPath + "/"
	runtimeConfig := []byte(
		`<base href="` + html.EscapeString(pageBasePath) + `">` +
			`<meta name="songlist-context-path" content="` + html.EscapeString(contextPath) + `">`,
	)
	indexHTML = bytes.Replace(indexHTML, []byte("<head>"), append([]byte("<head>"), runtimeConfig...), 1)

	fileServer := http.FileServer(http.FS(staticFiles))
	r.NoRoute(func(c *gin.Context) {
		if c.Request.Method != http.MethodGet && c.Request.Method != http.MethodHead {
			c.Status(http.StatusNotFound)
			return
		}

		urlPath := c.Request.URL.Path
		if contextPath != "" {
			if urlPath == contextPath {
				c.Redirect(http.StatusPermanentRedirect, contextPath+"/")
				return
			}
			if !strings.HasPrefix(urlPath, contextPath+"/") {
				c.Status(http.StatusNotFound)
				return
			}
			urlPath = strings.TrimPrefix(urlPath, contextPath)
		}

		requestPath := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
		if requestPath != "" && requestPath != "index.html" {
			if info, statErr := fs.Stat(staticFiles, requestPath); statErr == nil && !info.IsDir() {
				c.Request.URL.Path = "/" + requestPath
				fileServer.ServeHTTP(c.Writer, c.Request)
				return
			}
		}

		if urlPath == "/api" || strings.HasPrefix(urlPath, "/api/") {
			c.Status(http.StatusNotFound)
			return
		}

		if requestPath == "" || requestPath == "index.html" || strings.Contains(c.GetHeader("Accept"), "text/html") {
			c.Data(http.StatusOK, "text/html; charset=utf-8", indexHTML)
			return
		}

		c.Status(http.StatusNotFound)
	})
}
