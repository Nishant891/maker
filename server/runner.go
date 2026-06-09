package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
)

// DefaultModel — provider/model passed to opencode. "" uses opencode's own default.
const DefaultModel = "opencode-go/kimi-k2.6"

// systemPrompt steers opencode toward writing self-contained HTML artifacts in
// the working directory, each carrying an explicit pixel-size comment that the
// frontend uses to render at the correct dimensions without guessing.
const systemPrompt = `You are an HTML artifact generator.
Generate complete, self-contained HTML files for the user's request.

Rules:
- Write ONLY .html files. Name them artifact_01.html, artifact_02.html, and so
  on, in the current working directory (NOT in a subfolder).
- Each file must be a complete standalone HTML document
  (<!doctype html> ... </html>) with all CSS inline (use a <style> tag inside
  <head> — no external stylesheets, no JavaScript).
- The VERY FIRST LINE of every file must be a sizing comment in this exact
  form (choose appropriate pixel dimensions):

      <!-- maker:w=1280,h=720 -->

  The renderer reads these dimensions and renders the artifact at exactly that
  pixel size. Pick from these defaults:

      Presentation slide:        1280 x 720
      A4 document (portrait):     794 x 1123
      A4 document (landscape):   1123 x 794
      Social media card:         1080 x 1080
      Story / vertical:           1080 x 1920
      General web page:          1440 x 900
      Long-scroll web / blog:    1440 x 2400 (or taller as needed)

- Style the root container with FIXED pixel width and height matching the
  sizing comment (e.g. body { width: 1280px; height: 720px; }). Do NOT use
  100vw or 100vh — the artifact is rendered in a fixed-size frame, not a
  viewport.

Workflow:
1. First create a short todo list of the files you plan to write.
2. Web-search for any factual information you need.
3. Write the files one at a time, marking each todo done as you go.
4. Keep every status update to a single short sentence.
5. When all files are written, reply with exactly "Done." and nothing else.
   Do NOT write a closing summary, a recap, markdown tables, or descriptions
   of the files.

User request: `

// Options configures a single opencode run.
type Options struct {
	WorkingDir string
	Model      string
	Prompt     string
}

// Find returns the absolute path to the opencode binary, or an error.
func Find() (string, error) {
	return exec.LookPath("opencode")
}

// Run launches `opencode run --format json` inside opts.WorkingDir, translates
// each JSONL event into a UIEvent, and hands each UIEvent to onEvent. The
// caller decides what to do with them (CLI dump, SSE push, websocket fan-out,
// ...). Run blocks until opencode exits or ctx is cancelled.
func Run(ctx context.Context, opts Options, onEvent func(UIEvent)) error {
	if onEvent == nil {
		return fmt.Errorf("onEvent callback is required")
	}

	args := []string{"run", "--format", "json", "--dangerously-skip-permissions"}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	args = append(args, systemPrompt+opts.Prompt)

	cmd := exec.CommandContext(ctx, "opencode", args...)
	cmd.Dir = opts.WorkingDir
	cmd.Stderr = os.Stderr // opencode debug logs

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("pipe stdout: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start opencode: %w", err)
	}

	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 0, 256*1024), 16*1024*1024) // write events carry file content inline
	for sc.Scan() {
		var ev ocEvent
		if err := json.Unmarshal(sc.Bytes(), &ev); err != nil {
			continue
		}
		for _, ui := range translate(ev) {
			onEvent(ui)
		}
	}
	return cmd.Wait()
}
