package main

import (
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// handleFile serves a single file from ?dir=&file=, scoped so ?file= cannot
// escape ?dir= via .. or absolute paths. Used by the iframe to load the
// generated HTML artifact for preview.
func handleFile(w http.ResponseWriter, r *http.Request) {
	dir := r.URL.Query().Get("dir")
	rel := r.URL.Query().Get("file")
	if dir == "" || rel == "" {
		httpErr(w, http.StatusBadRequest, "dir and file required")
		return
	}
	abs, err := safeJoin(dir, rel)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		httpErr(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", contentTypeFor(abs))
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, f)
}

func safeJoin(base, rel string) (string, error) {
	if filepath.IsAbs(rel) {
		return "", errors.New("absolute paths not allowed")
	}
	clean := filepath.Clean(rel)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes working dir")
	}
	return filepath.Join(base, clean), nil
}

func contentTypeFor(p string) string {
	switch strings.ToLower(filepath.Ext(p)) {
	case ".html", ".htm":
		return "text/html; charset=utf-8"
	case ".json":
		return "application/json"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".txt", ".md":
		return "text/plain; charset=utf-8"
	}
	return "application/octet-stream"
}
