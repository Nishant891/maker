// Maker server: a small HTTP layer in front of `opencode run --format json`.
//
// Endpoints:
//   GET  /api/browse?path=...     list immediate subdirectories
//   POST /api/select              {path}        validate + mkdir -p the working dir
//   POST /api/generate            {dir,prompt}  SSE stream of UIEvents from opencode
//   GET  /api/file?dir=&file=     serve a generated artifact from inside dir
//   POST /api/save                {dir,file,content}  persist iframe edits to disk
package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// codeDir is the maker repo root, resolved at startup. The server refuses to
// treat any path inside it (or the path itself) as a working directory so the
// agent can never scribble inside the code folder.
var codeDir string

// appModel is the opencode provider/model used for every generation. Set from
// the --model flag at startup.
var appModel string

func main() {
	port := flag.String("port", "5174", "port to listen on")
	model := flag.String("model", DefaultModel,
		"opencode model as provider/model (empty = opencode default)")
	flag.Parse()

	log.SetFlags(log.Ltime | log.Lmicroseconds)
	appModel = *model

	if _, err := Find(); err != nil {
		log.Fatalf("opencode not found on PATH (install from https://opencode.ai): %v", err)
	}

	if cwd, err := os.Getwd(); err == nil {
		codeDir = findRepoRoot(cwd)
	}
	if codeDir == "" {
		log.Printf("[server] WARN: could not find repo root; code-folder guard disabled")
	} else {
		log.Printf("[server] code-folder guard: %s", codeDir)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/browse", withCORS(handleBrowse))
	mux.HandleFunc("/api/select", withCORS(handleSelect))
	mux.HandleFunc("/api/generate", withCORS(handleGenerate))
	mux.HandleFunc("/api/file", withCORS(handleFile))
	mux.HandleFunc("/api/save", withCORS(handleSave))

	addr := ":" + *port
	log.Printf("[server] listening on http://localhost%s", addr)
	srv := &http.Server{
		Addr:         addr,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 0, // SSE: no write deadline
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}

// findRepoRoot walks up from start until it sees a .git directory and returns
// that path. Returns "" if none is found.
func findRepoRoot(start string) string {
	p := start
	for {
		if st, err := os.Stat(filepath.Join(p, ".git")); err == nil && st.IsDir() {
			return p
		}
		parent := filepath.Dir(p)
		if parent == p {
			return ""
		}
		p = parent
	}
}
