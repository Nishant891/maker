// Thin HTTP layer over the maker server. Every endpoint is a single function
// so the rest of the app never sees the SERVER constant or fetch boilerplate.

export const SERVER = 'http://localhost:5174';

export async function browse(path) {
  const url = SERVER + '/api/browse?path=' + encodeURIComponent(path);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data; // { path, parent, dirs, canUse, reason }
}

export async function selectDir(path, create) {
  const res = await fetch(SERVER + '/api/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, create: create || '' }),
  });
  return res.json(); // { path, ok, reason, created }
}

export function fileURL(dir, file) {
  return SERVER + '/api/file?dir=' + encodeURIComponent(dir) +
                  '&file=' + encodeURIComponent(file);
}

// saveArtifact writes the live (edited) HTML for `file` back to disk inside
// `dir`. The server scopes `file` to `dir` so this cannot escape the canvas.
export async function saveArtifact(dir, file, content) {
  const res = await fetch(SERVER + '/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dir, file, content }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(data.error || ('HTTP ' + res.status));
  }
  return data;
}

// streamGenerate POSTs to /api/generate and parses the SSE stream into
// UIEvent objects, calling onEvent for each one. Resolves when the stream
// ends. Throws if the HTTP call itself fails.
export async function streamGenerate(body, onEvent) {
  const stageW = Math.floor(window.innerWidth - 380);
  const stageH = Math.floor(window.innerHeight);
  const res = await fetch(SERVER + '/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stageW, stageH }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || ('HTTP ' + res.status));
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const MAX_BUF = 32 * 1024 * 1024; // file events carry full HTML
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = parseSSE(frame);
      if (ev) onEvent(ev);
    }
    if (buf.length > MAX_BUF) {
      reader.cancel().catch(() => {});
      throw new Error('SSE buffer overflow');
    }
  }
}

function parseSSE(frame) {
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (!dataLines.length) return null;
  try {
    return JSON.parse(dataLines.join('\n'));
  } catch (e) {
    console.warn('[maker] bad SSE payload', dataLines.join('\n'));
    return null;
  }
}
