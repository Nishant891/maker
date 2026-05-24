package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Ts      int64  `json:"ts"`
}

type Artifact struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	File   string `json:"file"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type Manifest struct {
	Name      string     `json:"name"`
	Messages  []Message  `json:"messages"`
	Artifacts []Artifact `json:"artifacts"`
}

var manifestMu sync.Mutex

func canvasJSONPath(dir string) string { return filepath.Join(dir, "canvas.json") }

func readManifest(dir string) (Manifest, error) {
	manifestMu.Lock()
	defer manifestMu.Unlock()
	return readManifestLocked(dir)
}

func readManifestLocked(dir string) (Manifest, error) {
	var m Manifest
	b, err := os.ReadFile(canvasJSONPath(dir))
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, err
	}
	if m.Messages == nil {
		m.Messages = []Message{}
	}
	if m.Artifacts == nil {
		m.Artifacts = []Artifact{}
	}
	return m, nil
}

func writeManifestLocked(dir string, m Manifest) error {
	if m.Messages == nil {
		m.Messages = []Message{}
	}
	if m.Artifacts == nil {
		m.Artifacts = []Artifact{}
	}
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(canvasJSONPath(dir), b, 0o644)
}

func appendMessage(dir string, msg Message) error {
	manifestMu.Lock()
	defer manifestMu.Unlock()
	m, err := readManifestLocked(dir)
	if err != nil {
		m = Manifest{Messages: []Message{}, Artifacts: []Artifact{}}
	}
	m.Messages = append(m.Messages, msg)
	return writeManifestLocked(dir, m)
}

func handleCanvas(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			Name string `json:"name"`
			Dir  string `json:"dir"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			httpErr(w, http.StatusBadRequest, "invalid json")
			return
		}
		dir, err := normalizeDir(body.Dir)
		if err != nil {
			httpErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := ensureWritableDir(dir); err != nil {
			httpErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if err := os.MkdirAll(filepath.Join(dir, "artifacts"), 0o755); err != nil {
			httpErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		manifestMu.Lock()
		created := false
		if _, err := os.Stat(canvasJSONPath(dir)); errors.Is(err, os.ErrNotExist) {
			m := Manifest{Name: body.Name, Messages: []Message{}, Artifacts: []Artifact{}}
			if err := writeManifestLocked(dir, m); err != nil {
				manifestMu.Unlock()
				httpErr(w, http.StatusInternalServerError, err.Error())
				return
			}
			created = true
		}
		manifestMu.Unlock()
		if created {
			log.Printf("[canvas] created %q at %s", body.Name, dir)
		} else {
			log.Printf("[canvas] opened existing canvas at %s", dir)
		}
		respondCanvas(w, dir)

	case http.MethodGet:
		dir, err := normalizeDir(r.URL.Query().Get("dir"))
		if err != nil {
			httpErr(w, http.StatusBadRequest, err.Error())
			return
		}
		respondCanvas(w, dir)

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func respondCanvas(w http.ResponseWriter, dir string) {
	m, err := readManifest(dir)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, "manifest read: "+err.Error())
		return
	}
	files, _ := listFiles(dir)
	writeJSON(w, struct {
		Dir      string   `json:"dir"`
		Manifest Manifest `json:"manifest"`
		Files    []string `json:"files"`
	}{Dir: dir, Manifest: m, Files: files})
}

func listFiles(dir string) ([]string, error) {
	var out []string
	err := filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(dir, p)
		if rel == "canvas.json" {
			return nil
		}
		if strings.HasPrefix(filepath.Base(rel), ".") {
			return nil
		}
		out = append(out, filepath.ToSlash(rel))
		return nil
	})
	sort.Strings(out)
	return out, err
}

func handleFile(w http.ResponseWriter, r *http.Request) {
	dir, err := normalizeDir(r.URL.Query().Get("dir"))
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	rel := r.URL.Query().Get("file")
	if rel == "" {
		httpErr(w, http.StatusBadRequest, "file required")
		return
	}
	abs, err := safeJoin(dir, rel)
	if err != nil {
		log.Printf("[file] reject %q in %q: %v", rel, dir, err)
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	f, err := os.Open(abs)
	if err != nil {
		log.Printf("[file] miss %s", abs)
		httpErr(w, http.StatusNotFound, "not found")
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentTypeFor(abs))
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, f)
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

func normalizeDir(p string) (string, error) {
	if p == "" {
		return "", errors.New("dir required")
	}
	if strings.HasPrefix(p, "~/") || p == "~" {
		home, err := os.UserHomeDir()
		if err == nil {
			if p == "~" {
				p = home
			} else {
				p = filepath.Join(home, p[2:])
			}
		}
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil || !st.IsDir() {
		return "", errors.New("directory does not exist: " + abs)
	}
	return abs, nil
}

func ensureWritableDir(dir string) error {
	probe := filepath.Join(dir, ".maker-write-probe")
	f, err := os.Create(probe)
	if err != nil {
		return errors.New("directory not writable: " + dir)
	}
	_ = f.Close()
	_ = os.Remove(probe)
	return nil
}

func safeJoin(base, rel string) (string, error) {
	if filepath.IsAbs(rel) {
		return "", errors.New("absolute paths not allowed")
	}
	clean := filepath.Clean(rel)
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes canvas dir")
	}
	abs := filepath.Join(base, clean)
	absResolved, err := filepath.Abs(abs)
	if err != nil {
		return "", err
	}
	baseResolved, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	if absResolved != baseResolved &&
		!strings.HasPrefix(absResolved, baseResolved+string(filepath.Separator)) {
		return "", errors.New("path escapes canvas dir")
	}
	return absResolved, nil
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
