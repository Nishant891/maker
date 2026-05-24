package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const systemPrompt = `You are an artifact generator running inside a canvas directory.
The canvas directory is your current working directory (also exposed as $MAKER_CANVAS_DIR).

WORKFLOW — do these in order:

1. Briefly state your plan in ONE or TWO sentences before doing anything.
   Example: "I'll create three slides covering goals, timeline, and risks."

2. Create artifacts ONE AT A TIME. Before each one, announce it in plain text.
   Example: "Creating Slide 1: Goals." Then write the file.

3. For each artifact, write a self-contained plain HTML file (inline styles
   only, no external JavaScript) to artifacts/<id>.html with a short
   alphanumeric id (a1, a2, slide3, ...).

4. The FIRST LINE of every artifact HTML file MUST be a maker comment carrying
   the intended pixel dimensions, exactly in this form (substitute the real
   width and height):

       <!-- maker:w=1280,h=720 -->

   The server reads this to auto-register the artifact even if you don't touch
   canvas.json. Do not omit it.

5. After writing each artifact, update canvas.json in the canvas root:
   - append to "artifacts": { id, title, file, width, height } where
     "file" MUST be relative (e.g. "artifacts/a1.html"), NEVER absolute.
   - append to "messages": { role: "assistant", content: "<short reply>",
     ts: <unix-ms> }.

6. Pick dimensions appropriate to the request:
       slides:           1280 x 720
       A4 documents:      794 x 1123
       social cards:     1080 x 1080
       generic web:      1440 x 900
   Do NOT hardcode sizing for fitting the screen — author at natural dimensions
   and the client will scale.

canvas.json schema:
{
  "name": "...",
  "messages":  [{"role":"user"|"assistant", "content":"...", "ts":0}],
  "artifacts": [{"id":"a1","title":"Slide 1","file":"artifacts/a1.html","width":1280,"height":720}]
}

Use existing files in the canvas directory (images, docs, prior artifacts) as
context or assets where relevant. Keep spoken text brief — the artifacts are
the deliverable.
`

type genReq struct {
	Dir      string `json:"dir"`
	Provider string `json:"provider"`
	Prompt   string `json:"prompt"`
}

type runStats struct {
	finalText     string
	finalIsError  bool
	deniedTools   []string
	pendingWrites map[string]string
}

func handleGenerate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var req genReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	log.Printf("[generate] request provider=%s dir=%q prompt=%q",
		req.Provider, req.Dir, truncate(req.Prompt, 200))

	if strings.TrimSpace(req.Provider) == "" {
		httpErr(w, http.StatusBadRequest, "provider required")
		return
	}

	dir, err := normalizeDir(req.Dir)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	log.Printf("[generate] normalized dir=%q", dir)

	binPath := findBinary(req.Provider)
	if binPath == "" {
		httpErr(w, http.StatusBadRequest, "provider not found: "+req.Provider)
		return
	}
	log.Printf("[generate] resolved %s → %s", req.Provider, binPath)

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpErr(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	var sendMu sync.Mutex
	send := func(event, data string) {
		sendMu.Lock()
		defer sendMu.Unlock()
		fmt.Fprintf(w, "event: %s\n", event)
		for _, line := range strings.Split(data, "\n") {
			fmt.Fprintf(w, "data: %s\n", line)
		}
		fmt.Fprintln(w)
		flusher.Flush()
	}

	if err := appendMessage(dir, Message{
		Role: "user", Content: req.Prompt, Ts: time.Now().UnixMilli(),
	}); err != nil {
		send("error", err.Error())
		return
	}
	if m, err := readManifest(dir); err == nil {
		emitCanvas(send, dir, m)
	}

	args, stdinInput := buildInvocation(req.Provider, req.Prompt, dir)
	log.Printf("[generate] spawn bin=%s args=%v cmd.Dir=%s", binPath, args, dir)

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	cmd := exec.CommandContext(ctx, binPath, args...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "MAKER_CANVAS_DIR="+dir)
	cmd.Stdin = strings.NewReader(stdinInput)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		send("error", err.Error())
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		send("error", err.Error())
		return
	}
	if err := cmd.Start(); err != nil {
		log.Printf("[generate] spawn failed: %v", err)
		send("error", "spawn failed: "+err.Error())
		return
	}
	log.Printf("[generate] pid=%d started", cmd.Process.Pid)

	go func() {
		sc := bufio.NewScanner(stderr)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			log.Printf("[agent stderr] %s", sc.Text())
		}
	}()

	pollDone := make(chan struct{})
	var lastHash string
	go func() {
		t := time.NewTicker(600 * time.Millisecond)
		defer t.Stop()
		for {
			select {
			case <-pollDone:
				return
			case <-t.C:
				m, err := readManifest(dir)
				if err != nil {
					continue
				}
				h := manifestHash(m)
				if h != lastHash {
					lastHash = h
					emitCanvas(send, dir, m)
				}
			}
		}
	}()

	stats := &runStats{pendingWrites: map[string]string{}}
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" {
			continue
		}
		log.Printf("[agent stdout] %s", line)
		handleStdoutLine(req.Provider, line, dir, send, stats)
	}

	waitErr := cmd.Wait()
	close(pollDone)
	if waitErr != nil {
		log.Printf("[generate] process exited: %v", waitErr)
	} else {
		log.Printf("[generate] process completed")
	}

	if len(stats.deniedTools) > 0 {
		msg := "agent writes were denied (permission_denials): " +
			strings.Join(uniqueStrings(stats.deniedTools), ", ")
		log.Printf("[generate] %s", msg)
		send("error", msg)
	} else if stats.finalIsError {
		log.Printf("[generate] agent reported is_error:true")
		send("error", "agent reported is_error:true")
	}

	runSyncGuard(dir, send)

	if m, err := readManifest(dir); err == nil {
		emitCanvas(send, dir, m)
	}
	send("done", "")
	log.Printf("[generate] done")
}

// buildInvocation returns argv (excluding the binary path) and the stdin
// payload for the given provider. claude reads the prompt from stdin;
// opencode takes it as a positional arg. Both flags are non-interactive
// permission grants verified via each tool's --help.
func buildInvocation(provider, userPrompt, dir string) ([]string, string) {
	combined := systemPrompt + "\n\n--- User request ---\n" + userPrompt
	switch provider {
	case "claude":
		return []string{
			"-p",
			"--output-format", "stream-json",
			"--verbose",
			"--permission-mode", "acceptEdits",
		}, combined
	case "opencode":
		return []string{
			"run",
			"--dir", dir,
			"--format", "json",
			"--dangerously-skip-permissions",
			combined,
		}, ""
	}
	return []string{}, combined
}

func handleStdoutLine(provider, line, dir string, send func(string, string), stats *runStats) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		if provider == "opencode" {
			send("text", line)
		}
		return
	}

	typ, _ := raw["type"].(string)

	switch typ {
	case "assistant":
		if msg, ok := raw["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				var textBuf strings.Builder
				for _, c := range content {
					cm, ok := c.(map[string]any)
					if !ok {
						continue
					}
					ct, _ := cm["type"].(string)
					switch ct {
					case "text":
						if s, ok := cm["text"].(string); ok {
							textBuf.WriteString(s)
						}
					case "tool_use":
						handleToolUse(cm, dir, send, stats)
					}
				}
				if textBuf.Len() > 0 {
					send("text", textBuf.String())
				}
			}
		}
		return

	case "user":
		if msg, ok := raw["message"].(map[string]any); ok {
			if content, ok := msg["content"].([]any); ok {
				for _, c := range content {
					cm, ok := c.(map[string]any)
					if !ok {
						continue
					}
					if cm["type"] == "tool_result" {
						handleToolResult(cm, dir, send, stats)
					}
				}
			}
		}
		return

	case "result":
		if s, ok := raw["result"].(string); ok {
			stats.finalText = s
		}
		if b, ok := raw["is_error"].(bool); ok {
			stats.finalIsError = b
		}
		if denials, ok := raw["permission_denials"].([]any); ok {
			for _, d := range denials {
				if dm, ok := d.(map[string]any); ok {
					if name, ok := dm["tool_name"].(string); ok {
						stats.deniedTools = append(stats.deniedTools, name)
					}
				}
			}
		}
		return
	}

	handleGenericFallback(provider, raw, dir, send, stats)
}

func handleToolUse(cm map[string]any, dir string, send func(string, string), stats *runStats) {
	name, _ := cm["name"].(string)
	if !isWriteEditTool(name) {
		return
	}
	input, _ := cm["input"].(map[string]any)
	fp := pickFilePath(input)
	if fp == "" {
		return
	}
	rel := relToCanvas(dir, fp)
	title := titleFromFile(rel)
	log.Printf("[generate] working %s (%s) %s", name, title, rel)

	wp, _ := json.Marshal(map[string]string{"file": rel, "title": title})
	send("working", string(wp))

	if id, _ := cm["id"].(string); id != "" {
		stats.pendingWrites[id] = rel
	}
}

func handleToolResult(cm map[string]any, dir string, send func(string, string), stats *runStats) {
	useID, _ := cm["tool_use_id"].(string)
	isErr, _ := cm["is_error"].(bool)

	if isErr {
		msg := "tool error: " + contentAsString(cm["content"])
		log.Printf("[generate] %s", msg)
		send("error", msg)
	}

	if useID == "" {
		return
	}
	rel, pending := stats.pendingWrites[useID]
	if !pending {
		return
	}
	delete(stats.pendingWrites, useID)

	if isErr || !isArtifactPath(rel) {
		return
	}
	art, added, err := registerArtifact(dir, rel)
	if err != nil {
		log.Printf("[generate] live register %s: %v", rel, err)
		return
	}
	if !added {
		return
	}
	log.Printf("[generate] live registered artifact %s (%dx%d)", art.File, art.Width, art.Height)
	b, _ := json.Marshal(art)
	send("artifact", string(b))
}

// handleGenericFallback parses non-claude shapes by best-effort field names.
// Refine as the real opencode event format becomes known from server logs.
func handleGenericFallback(provider string, raw map[string]any, dir string, send func(string, string), stats *runStats) {
	if s, ok := raw["text"].(string); ok && s != "" {
		send("text", s)
	} else if d, ok := raw["delta"].(map[string]any); ok {
		if s, ok := d["text"].(string); ok && s != "" {
			send("text", s)
		}
	} else if c, ok := raw["content"].(string); ok && c != "" {
		send("text", c)
	}

	toolName := ""
	for _, k := range []string{"tool", "tool_name", "name", "action"} {
		if v, ok := raw[k].(string); ok && v != "" {
			toolName = v
			break
		}
	}
	if toolName == "" {
		for _, k := range []string{"tool_use", "use", "tool"} {
			if obj, ok := raw[k].(map[string]any); ok {
				for _, kk := range []string{"name", "tool", "tool_name"} {
					if v, ok := obj[kk].(string); ok && v != "" {
						toolName = v
						break
					}
				}
				if toolName != "" {
					break
				}
			}
		}
	}
	if toolName == "" || !isWriteEditTool(toolName) {
		return
	}

	fp := ""
	if input, ok := raw["input"].(map[string]any); ok {
		fp = pickFilePath(input)
	}
	if fp == "" {
		fp = pickFilePath(raw)
	}
	if fp == "" {
		return
	}

	rel := relToCanvas(dir, fp)
	title := titleFromFile(rel)
	log.Printf("[generate] working %s (%s) %s [fallback]", toolName, title, rel)
	wp, _ := json.Marshal(map[string]string{"file": rel, "title": title})
	send("working", string(wp))

	if !isArtifactPath(rel) {
		return
	}
	art, added, err := registerArtifact(dir, rel)
	if err != nil {
		return
	}
	if !added {
		return
	}
	log.Printf("[generate] registered %s (%dx%d) [fallback]", art.File, art.Width, art.Height)
	b, _ := json.Marshal(art)
	send("artifact", string(b))
}

func runSyncGuard(dir string, send func(string, string)) {
	log.Printf("[generate] sync guard: scanning artifacts/")
	artDir := filepath.Join(dir, "artifacts")
	entries, err := os.ReadDir(artDir)
	if err != nil {
		log.Printf("[generate] sync guard: %v", err)
		return
	}
	added := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(e.Name()), ".html") {
			continue
		}
		rel := "artifacts/" + e.Name()
		art, isNew, err := registerArtifact(dir, rel)
		if err != nil {
			log.Printf("[generate] sync guard: register %s: %v", rel, err)
			continue
		}
		if !isNew {
			continue
		}
		log.Printf("[generate] sync guard: registered %s (%dx%d)",
			art.File, art.Width, art.Height)
		b, _ := json.Marshal(art)
		send("artifact", string(b))
		added++
	}
	if added > 0 {
		if m, err := readManifest(dir); err == nil {
			emitCanvas(send, dir, m)
		}
	} else {
		log.Printf("[generate] sync guard: no new artifacts")
	}
}

var makerCommentRe = regexp.MustCompile(`<!--\s*maker:w=(\d+),\s*h=(\d+)\s*-->`)

func registerArtifact(dir, rel string) (Artifact, bool, error) {
	rel = filepath.ToSlash(rel)

	manifestMu.Lock()
	defer manifestMu.Unlock()

	m, err := readManifestLocked(dir)
	if err != nil {
		return Artifact{}, false, err
	}
	for _, a := range m.Artifacts {
		if filepath.ToSlash(a.File) == rel {
			return a, false, nil
		}
	}

	full := filepath.Join(dir, filepath.FromSlash(rel))
	body, err := os.ReadFile(full)
	if err != nil {
		return Artifact{}, false, err
	}
	w, h := dimensionsFromHTML(string(body))

	baseID := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	used := map[string]bool{}
	for _, a := range m.Artifacts {
		used[a.ID] = true
	}
	id := baseID
	for i := 2; used[id]; i++ {
		id = fmt.Sprintf("%s-%d", baseID, i)
	}

	art := Artifact{
		ID:     id,
		Title:  titleFromID(baseID),
		File:   rel,
		Width:  w,
		Height: h,
	}
	m.Artifacts = append(m.Artifacts, art)
	if err := writeManifestLocked(dir, m); err != nil {
		return Artifact{}, false, err
	}
	return art, true, nil
}

func dimensionsFromHTML(html string) (int, int) {
	if m := makerCommentRe.FindStringSubmatch(html); m != nil {
		w, _ := strconv.Atoi(m[1])
		h, _ := strconv.Atoi(m[2])
		if w > 0 && h > 0 {
			return w, h
		}
	}
	return 1280, 720
}

func emitCanvas(send func(string, string), dir string, m Manifest) {
	files, _ := listFiles(dir)
	b, err := json.Marshal(struct {
		Dir      string   `json:"dir"`
		Manifest Manifest `json:"manifest"`
		Files    []string `json:"files"`
	}{Dir: dir, Manifest: m, Files: files})
	if err != nil {
		return
	}
	send("canvas", string(b))
}

func manifestHash(m Manifest) string {
	b, _ := json.Marshal(m)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}

func isWriteEditTool(name string) bool {
	n := strings.ToLower(name)
	return n == "write" || n == "edit" || n == "multiedit" || n == "str_replace" ||
		strings.HasPrefix(n, "write_") || strings.HasPrefix(n, "edit_")
}

func pickFilePath(m map[string]any) string {
	for _, k := range []string{"file_path", "filePath", "path", "file", "filename", "target"} {
		if v, ok := m[k].(string); ok && v != "" {
			return v
		}
	}
	return ""
}

func relToCanvas(dir, fp string) string {
	if filepath.IsAbs(fp) {
		rel, err := filepath.Rel(dir, fp)
		if err != nil || strings.HasPrefix(rel, "..") {
			return filepath.ToSlash(fp)
		}
		return filepath.ToSlash(rel)
	}
	return filepath.ToSlash(filepath.Clean(fp))
}

func isArtifactPath(rel string) bool {
	rel = filepath.ToSlash(rel)
	return strings.HasPrefix(rel, "artifacts/") &&
		strings.HasSuffix(strings.ToLower(rel), ".html")
}

func titleFromFile(rel string) string {
	id := strings.TrimSuffix(filepath.Base(rel), filepath.Ext(rel))
	return titleFromID(id)
}

func titleFromID(id string) string {
	if id == "" {
		return "Untitled"
	}
	s := strings.NewReplacer("_", " ", "-", " ").Replace(id)
	return strings.ToUpper(s[:1]) + s[1:]
}

func contentAsString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	if arr, ok := v.([]any); ok {
		var b strings.Builder
		for _, item := range arr {
			if im, ok := item.(map[string]any); ok {
				if s, ok := im["text"].(string); ok {
					if b.Len() > 0 {
						b.WriteByte(' ')
					}
					b.WriteString(s)
				}
			}
		}
		return b.String()
	}
	return ""
}

func uniqueStrings(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
