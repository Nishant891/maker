package main

import (
	"encoding/json"
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

// saveReq is the body of POST /api/save — write `Content` to `Dir/File`,
// where File is scoped inside Dir the same way handleFile reads it.
type saveReq struct {
	Dir     string `json:"dir"`
	File    string `json:"file"`
	Content string `json:"content"`
}

type saveResp struct {
	Ok    bool   `json:"ok"`
	Error string `json:"error,omitempty"`
}

// handleSave persists the iframe-edited artifact back to disk. This is what
// makes the in-browser editor's changes durable. The canvas-guard refuses
// any path inside the maker repo, and safeJoin keeps file inside dir.
func handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req saveReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 32<<20)).Decode(&req); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Dir == "" || req.File == "" {
		httpErr(w, http.StatusBadRequest, "dir and file required")
		return
	}
	dir, err := expandHome(req.Dir)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	dir, err = filepath.Abs(dir)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if ok, reason := canUseAsCanvas(dir); !ok {
		httpErr(w, http.StatusBadRequest, reason)
		return
	}
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		httpErr(w, http.StatusBadRequest, "working dir does not exist: "+dir)
		return
	}
	abs, err := safeJoin(dir, req.File)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	// Only allow saving HTML files — the editor only produces HTML, and this
	// keeps the endpoint from being repurposed to overwrite anything else.
	if ext := strings.ToLower(filepath.Ext(abs)); ext != ".html" && ext != ".htm" {
		httpErr(w, http.StatusBadRequest, "only .html files are saveable")
		return
	}
	if err := atomicWrite(abs, []byte(req.Content)); err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, saveResp{Ok: true})
}

// atomicWrite writes content to a tempfile in the same directory and then
// renames it over the target, so a crashed write never truncates the file.
func atomicWrite(target string, content []byte) error {
	dir := filepath.Dir(target)
	tmp, err := os.CreateTemp(dir, ".maker-save-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(content); err != nil {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, target)
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
