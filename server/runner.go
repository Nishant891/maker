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

// BuildSystemPrompt returns the opencode system prompt for one generation
// request. stageW / stageH are the host UI's canvas frame in pixels — the
// agent uses them to pick an artifact type and dimensions that fit.
func BuildSystemPrompt(stageW, stageH int) string {
	return fmt.Sprintf(`You are an HTML artifact generator. Generate complete, self-contained HTML files.

DEVICE CONTEXT:
  Canvas area : %d × %d px  ← the frame your artifact renders inside

Step 1 — pick an artifact TYPE:

  document       A4 printable page.             Fixed  794 × 1123
  presentation   Slide deck (16:9).             Fixed  1920 × 1080
  webpage        Landing page / website.        1440 × auto
  multipage-web  Long-scroll page + anchors.    1440 × auto
  mobile         Mobile screen mockup.          Fixed  390 × 844
  poster         Print poster.                  A4 794×1123  A3 1123×1587  A2 1587×2245
  whiteboard     Free-form canvas.              3200 × 2000
  universal      Generic canvas.                1600 × auto

Step 2 — pick the artifact COUNT:

  presentation  → one file PER SLIDE, default 3 if user did not specify.
  everything else → exactly ONE file.
  A multi-page website is ONE long HTML file with anchor-linked sections, not multiple files.

Step 3 — write the files.

RULES (non-negotiable):

  Naming    : artifact_01.html, artifact_02.html … in the current working
              directory, never in a subfolder.

  First line: the VERY FIRST LINE of every file must be exactly:
                <!-- maker:w=<W>,h=<H> -->
              Use a number for H when type is presentation/document/mobile/poster.
              Use "auto" for H when type is webpage/multipage-web/universal/whiteboard.

  Structure : complete standalone document — <!doctype html> … </html>.
              NO <style> tags. NO <link> stylesheets. NO CSS classes whatsoever.
              ALL styling via inline style attributes only, on every single element.
              NO external fetches for fonts, images, or icons — embed or omit everything.
              JavaScript is allowed for interactive behaviour.

  Sizing    : set the root element width to match W exactly:
                <body style="margin:0;padding:0;width:<W>px;...">
              If H is a number: also set height:<H>px and overflow:hidden on body.
              If H is auto: omit height, set a sensible min-height instead.
              Never use 100vw or 100vh — this is a fixed-size frame, not a viewport.

  Layout    : for fixed-height artifacts (slides, documents, posters, mobile)
              use position:absolute with explicit top/left/width/height on every element.
              For auto-height artifacts use normal document flow with explicit widths.

WORKFLOW:
  1. Write a short todo list — include chosen type and dimensions in item 1.
  2. Web-search for any facts you need.
  3. Write files one at a time, mark each todo done as you go.
  4. Keep every status update to one short sentence.
  5. When all files are written, reply with exactly "Done." and nothing else.
     No summary, no recap, no markdown, no descriptions.

User request:
`, stageW, stageH)
}

// Options configures a single opencode run.
type Options struct {
	WorkingDir string
	Model      string
	Prompt     string
	StageW     int
	StageH     int
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
	args = append(args, BuildSystemPrompt(opts.StageW, opts.StageH)+opts.Prompt)

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
