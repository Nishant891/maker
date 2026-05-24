# Maker

Maker is a local-first AI workspace that lets you generate artifacts — slides, documents, HTML pages, social cards, and more — using your locally available AI agents with near-instant feedback.

Simply describe what you want, and Maker creates artifacts inside a real workspace directory on your machine.

No cloud dependency required.

---

## Features

- ⚡ Local-first architecture
- 🧠 Automatically discovers local AI providers
- 🎨 Generates HTML-based artifacts
- 📂 Real filesystem-backed canvases
- 🔄 Live updates while artifacts are generated
- 🖥 Interactive preview and editing
- 📎 Use existing files in your workspace as context
- 🚀 Near-instant startup

---

## How it works

A canvas is simply a directory on your machine.

Example:

```text
my-project/
├── artifacts/
│   ├── slide1.html
│   ├── slide2.html
│   └── slide3.html
└── canvas.json
```

Drop images, documents, PDFs, or existing assets into your canvas folder and the AI can use them as context.

---

## Prerequisites

Install:

- Go
- Node.js + npm
- Local AI provider(s)

Examples:

- Claude Code
- OpenCode
- Ollama

Maker automatically detects available local providers.

---

## Installation

Clone the repository:

```bash
git clone <repo-url>
cd maker
```

Install frontend dependencies:

```bash
cd client
npm install
```

---

## Running Maker

### Start the frontend

```bash
cd client
npm run dev
```

Astro will start locally.

---

### Start the backend

Open another terminal:

```bash
cd server
go run .
```

You should see:

```text
maker server listening on http://localhost:5174
```

---

## Usage

1. Open the app in your browser
2. Create or choose a canvas directory
3. Enter a prompt

Example:

```text
Create a 3-slide presentation about AI in gaming
```

4. Maker automatically:

- detects available local AI agents
- creates artifacts
- updates the workspace
- streams results into the UI

---

## Example prompts

### Presentation

```text
Create a 5-slide presentation on WebAssembly
```

### Social card

```text
Create an Instagram post for a game launch
```

### Web page

```text
Build a landing page for an AI game platform
```

### Document

```text
Create an A4 product requirements document
```

---

## Project structure

```text
maker/
├── client/          # Astro frontend
├── server/          # Go backend
└── canvas/          # User workspaces
```

---

## Architecture

```text
Astro UI
    ↓
Go backend
    ↓
Local AI Provider
(Claude / OpenCode / Ollama)
    ↓
Artifacts + canvas.json
    ↓
Live streaming back to UI
```

---

## Notes

- Canvases are real directories on your machine
- Artifacts are plain HTML files
- Generated files remain fully editable
- No cloud upload required
- Works entirely locally

---

Built for fast local creation workflows.
