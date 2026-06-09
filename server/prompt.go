package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// browseResp is the shape of GET /api/browse.
type browseResp struct {
	Path   string   `json:"path"`
	Parent string   `json:"parent"`
	Dirs   []string `json:"dirs"`
	CanUse bool     `json:"canUse"`
	Reason string   `json:"reason,omitempty"`
}

// handleBrowse lists immediate subdirectories of ?path=, hiding dotfiles.
// Path is expanded (~), made absolute, and the response includes whether the
// caller is allowed to select this directory as a working dir.
func handleBrowse(w http.ResponseWriter, r *http.Request) {
	p := r.URL.Query().Get("path")
	if p == "" {
		if home, err := os.UserHomeDir(); err == nil {
			p = home
		} else {
			p = "/"
		}
	}
	p, err := expandHome(p)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	info, err := os.Stat(abs)
	if err != nil || !info.IsDir() {
		httpErr(w, http.StatusNotFound, "directory does not exist: "+abs)
		return
	}

	entries, err := os.ReadDir(abs)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	dirs := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".") {
			continue
		}
		dirs = append(dirs, name)
	}
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i]) < strings.ToLower(dirs[j])
	})

	parent := filepath.Dir(abs)
	if parent == abs {
		parent = ""
	}
	canUse, reason := canUseAsCanvas(abs)
	writeJSON(w, browseResp{Path: abs, Parent: parent, Dirs: dirs, CanUse: canUse, Reason: reason})
}

// selectReq is the body of POST /api/select.
type selectReq struct {
	Path   string `json:"path"`
	Create string `json:"create"` // optional new subfolder to create inside Path
}

// selectResp is the response of POST /api/select.
type selectResp struct {
	Path    string `json:"path"`
	Ok      bool   `json:"ok"`
	Reason  string `json:"reason,omitempty"`
	Created bool   `json:"created,omitempty"`
}

// handleSelect validates a path the user picked as a working directory. If the
// directory does not exist, it is created. If Create is non-empty, a subfolder
// named Create is created inside Path and the resulting path is returned.
func handleSelect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var req selectReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 8<<10)).Decode(&req); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	p, err := expandHome(req.Path)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if c := strings.TrimSpace(req.Create); c != "" {
		if strings.ContainsAny(c, "/\\") {
			writeJSON(w, selectResp{Path: abs, Ok: false, Reason: "folder name cannot contain / or \\"})
			return
		}
		abs = filepath.Join(abs, c)
	}

	if ok, reason := canUseAsCanvas(abs); !ok {
		writeJSON(w, selectResp{Path: abs, Ok: false, Reason: reason})
		return
	}

	created := false
	info, err := os.Stat(abs)
	switch {
	case err == nil && info.IsDir():
		// already exists; fine
	case err == nil && !info.IsDir():
		writeJSON(w, selectResp{Path: abs, Ok: false, Reason: abs + " exists but is not a directory"})
		return
	case errors.Is(err, os.ErrNotExist):
		if err := os.MkdirAll(abs, 0o755); err != nil {
			writeJSON(w, selectResp{Path: abs, Ok: false, Reason: "create failed: " + err.Error()})
			return
		}
		created = true
	default:
		writeJSON(w, selectResp{Path: abs, Ok: false, Reason: err.Error()})
		return
	}

	if err := probeWritable(abs); err != nil {
		writeJSON(w, selectResp{Path: abs, Ok: false, Reason: "directory not writable: " + abs})
		return
	}
	writeJSON(w, selectResp{Path: abs, Ok: true, Created: created})
}

// canUseAsCanvas refuses paths that live inside (or equal) the maker repo root
// so we never write artifacts into the codebase itself.
func canUseAsCanvas(abs string) (bool, string) {
	if codeDir == "" {
		return true, ""
	}
	if abs == codeDir {
		return false, "cannot use the maker code folder as a working directory"
	}
	rel, err := filepath.Rel(codeDir, abs)
	if err == nil && !strings.HasPrefix(rel, "..") && rel != "." {
		return false, "cannot create a working directory inside the maker code folder"
	}
	return true, ""
}

func probeWritable(dir string) error {
	probe := filepath.Join(dir, ".maker-write-probe")
	f, err := os.Create(probe)
	if err != nil {
		return err
	}
	_ = f.Close()
	_ = os.Remove(probe)
	return nil
}

func expandHome(p string) (string, error) {
	if p != "~" && !strings.HasPrefix(p, "~/") {
		return p, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if p == "~" {
		return home, nil
	}
	return filepath.Join(home, p[2:]), nil
}
