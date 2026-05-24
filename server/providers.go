package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

type Provider struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

func handleProviders(w http.ResponseWriter, r *http.Request) {
	names := []string{"claude", "opencode", "ollama"}
	out := []Provider{}
	for _, n := range names {
		if p := findBinary(n); p != "" {
			out = append(out, Provider{Name: n, Path: p})
		}
	}
	log.Printf("[providers] detected %d: %v", len(out), out)
	writeJSON(w, out)
}

func findBinary(name string) string {
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	home, _ := os.UserHomeDir()
	candidates := []string{
		filepath.Join(home, ".local", "bin", name),
		filepath.Join(home, ".bun", "bin", name),
		filepath.Join(home, ".npm-global", "bin", name),
		filepath.Join(home, ".cargo", "bin", name),
		filepath.Join("/opt/homebrew/bin", name),
		filepath.Join("/usr/local/bin", name),
		filepath.Join("/usr/bin", name),
	}
	for _, c := range candidates {
		st, err := os.Stat(c)
		if err != nil || st.IsDir() {
			continue
		}
		if st.Mode()&0o111 != 0 {
			return c
		}
	}
	return ""
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
