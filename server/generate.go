package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
)

// genReq is the body of POST /api/generate.
type genReq struct {
	Dir    string `json:"dir"`
	Prompt string `json:"prompt"`
	StageW int    `json:"stageW"`
	StageH int    `json:"stageH"`
}

// handleGenerate spawns `opencode run` inside req.Dir and streams every
// translated UIEvent to the browser as Server-Sent Events. The wire format is
// one UIEvent per SSE frame:  data: <json>\n\n. The frontend dispatches by the
// "type" field on each parsed object.
func handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req genReq
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if req.Prompt == "" {
		httpErr(w, http.StatusBadRequest, "empty prompt")
		return
	}
	dir, err := expandHome(req.Dir)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if ok, reason := canUseAsCanvas(dir); !ok {
		httpErr(w, http.StatusBadRequest, reason)
		return
	}
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		httpErr(w, http.StatusBadRequest, "working dir does not exist: "+dir)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	log.Printf("[generate] dir=%s prompt=%q", dir, truncate(req.Prompt, 200))

	var sendMu sync.Mutex
	send := func(ev UIEvent) {
		sendMu.Lock()
		defer sendMu.Unlock()
		b, err := marshalNoEscape(ev)
		if err != nil {
			return
		}
		// Single-line JSON guarantees a single data: line per SSE frame.
		fmt.Fprintf(w, "data: %s\n\n", b)
		flusher.Flush()
		// Echo to stdout so the operator can watch the stream from the terminal,
		// matching the prior CLI behavior the user relied on.
		fmt.Println(string(b))
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	if err := Run(ctx, Options{
		WorkingDir: dir,
		Model:      appModel,
		Prompt:     req.Prompt,
		StageW:     req.StageW,
		StageH:     req.StageH,
	}, send); err != nil {
		log.Printf("[generate] run error: %v", err)
		send(UIEvent{Type: "error", Message: err.Error()})
	}
	send(UIEvent{Type: "done"})
	log.Printf("[generate] done dir=%s", dir)
}

// marshalNoEscape JSON-encodes v without HTML-escaping so the file content
// stays human-readable on the wire while still being valid JSON.
func marshalNoEscape(v any) ([]byte, error) {
	var sb strings.Builder
	enc := json.NewEncoder(&sb)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return []byte(strings.TrimRight(sb.String(), "\n")), nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
