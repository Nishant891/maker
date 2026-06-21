package main

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// ---- opencode JSONL event shapes (from `opencode run --format json`) ----
// Reference: https://takopi.dev/reference/runners/opencode/stream-json-cheatsheet/

type ocEvent struct {
	Type  string   `json:"type"` // step_start | tool_use | text | step_finish | error
	Part  ocPart   `json:"part"`
	Error *ocError `json:"error"`
}

type ocPart struct {
	Type   string  `json:"type"`
	Text   string  `json:"text"`   // for type=="text"
	Tool   string  `json:"tool"`   // for type=="tool"
	State  ocState `json:"state"`  // for tool_use
	Reason string  `json:"reason"` // for step-finish: "stop" | "tool-calls"
}

type ocState struct {
	Status string          `json:"status"` // "completed"
	Title  string          `json:"title"`
	Input  json.RawMessage `json:"input"` // tool-specific; decoded per tool
}

type ocError struct {
	Name string `json:"name"`
	Data struct {
		Message string `json:"message"`
	} `json:"data"`
}

// ---- clean UI events we stream to the browser ----

type UIEvent struct {
	Type    string `json:"type"`              // text | todos | file | tool | done | error
	Text    string `json:"text,omitempty"`    // type=="text"
	Todos   []Todo `json:"todos,omitempty"`   // type=="todos"
	Name    string `json:"name,omitempty"`    // type=="file"
	Content string `json:"content,omitempty"` // type=="file"
	Status  string `json:"status,omitempty"`  // file status: writing | done
	Width   int    `json:"width,omitempty"`   // type=="file" (parsed from maker comment)
	Height  int    `json:"height,omitempty"`  // type=="file"
	Tool    string `json:"tool,omitempty"`    // type=="tool"
	Title   string `json:"title,omitempty"`   // type=="tool"
	Message string `json:"message,omitempty"` // type=="error"
}

type Todo struct {
	Text   string `json:"text"`
	Status string `json:"status"` // pending | active | done
}

// toolsToShow are the only tools we surface in the UI as a "tool" event.
// write/todowrite get their own dedicated event types below.
var toolsToShow = map[string]bool{
	"websearch": true,
	"webfetch":  true,
}

// translate converts one opencode event into zero or more UI events.
func translate(ev ocEvent) []UIEvent {
	switch ev.Type {
	case "text":
		t := strings.TrimSpace(ev.Part.Text)
		if t == "" {
			return nil
		}
		return []UIEvent{{Type: "text", Text: t}}

	case "tool_use":
		return translateTool(ev.Part)

	case "step_finish":
		if ev.Part.Reason == "stop" {
			return []UIEvent{{Type: "done"}}
		}
		return nil

	case "error":
		msg := "unknown error"
		if ev.Error != nil {
			if ev.Error.Data.Message != "" {
				msg = ev.Error.Data.Message
			} else if ev.Error.Name != "" {
				msg = ev.Error.Name
			}
		}
		return []UIEvent{{Type: "error", Message: msg}}
	}
	return nil
}

func translateTool(p ocPart) []UIEvent {
	switch p.Tool {
	case "write":
		var in struct {
			FilePath string `json:"filePath"`
			Path     string `json:"path"`
			Content  string `json:"content"`
		}
		_ = json.Unmarshal(p.State.Input, &in)
		name := in.FilePath
		if name == "" {
			name = in.Path
		}
		if name == "" {
			return nil
		}
		w, h := dimensionsFromHTML(in.Content)
		return []UIEvent{{
			Type:    "file",
			Name:    baseName(name),
			Content: in.Content,
			Status:  "done",
			Width:   w,
			Height:  h,
		}}

	case "todowrite":
		var in struct {
			Todos []struct {
				Content string `json:"content"`
				Text    string `json:"text"`
				Status  string `json:"status"`
			} `json:"todos"`
		}
		if err := json.Unmarshal(p.State.Input, &in); err != nil || len(in.Todos) == 0 {
			return nil
		}
		todos := make([]Todo, 0, len(in.Todos))
		for _, t := range in.Todos {
			text := t.Content
			if text == "" {
				text = t.Text
			}
			todos = append(todos, Todo{Text: text, Status: normalizeStatus(t.Status)})
		}
		return []UIEvent{{Type: "todos", Todos: todos}}

	default:
		if toolsToShow[p.Tool] {
			title := p.State.Title
			if title == "" {
				title = p.Tool
			}
			return []UIEvent{{Type: "tool", Tool: p.Tool, Title: title}}
		}
		return nil // bash, grep, glob, read, edit, skill, etc. are hidden
	}
}

// normalizeStatus maps opencode's various status strings to pending|active|done.
func normalizeStatus(s string) string {
	switch strings.ToLower(strings.ReplaceAll(s, "_", "-")) {
	case "in-progress", "active", "running":
		return "active"
	case "completed", "done", "complete":
		return "done"
	default:
		return "pending"
	}
}

// makerCommentRe matches the per-artifact sizing comment the system prompt
// requires on the first line of every generated HTML file. Height may be a
// number or the literal "auto":
//   <!-- maker:w=1280,h=720 -->
//   <!-- maker:w=1440,h=auto -->
var makerCommentRe = regexp.MustCompile(`<!--\s*maker:w=(\d+)\s*,\s*h=(auto|\d+)\s*-->`)

// dimensionsFromHTML returns the (width, height) carried in a maker sizing
// comment. Height of -1 signals "auto" — the renderer will measure the
// rendered body and grow the stage to fit. Falls back to 1920x1080 (16:9
// presentation default) when the comment is missing or malformed.
func dimensionsFromHTML(html string) (int, int) {
	if m := makerCommentRe.FindStringSubmatch(html); m != nil {
		w, _ := strconv.Atoi(m[1])
		if w <= 0 {
			return 1920, 1080
		}
		if m[2] == "auto" {
			return w, -1
		}
		h, _ := strconv.Atoi(m[2])
		if h > 0 {
			return w, h
		}
		return w, -1
	}
	return 1920, 1080
}

func baseName(p string) string {
	p = strings.ReplaceAll(p, "\\", "/")
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
