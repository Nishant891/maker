// Central mutable app state, shared across modules via live ES-module binding.
// Functions in views.js / stream.js / dir-modal.js read+write this object.
// Keep state shape stable — adding fields is fine; renaming requires touching
// every consumer.

export const state = {
  dir: null,                  // selected working directory (absolute path)

  // Directory browser modal
  browsePath:  null,
  browseParent: null,
  browseCanUse: false,
  browseReason: '',

  // Live artifact list (one entry per file event)
  artifacts: [],              // [{ name, content, width, height }] (height<=0 = auto)
  activeName: null,           // which artifact is shown in the viewport
  activeAutoHeight: false,    // current viewport artifact uses h=auto

  // Edit dirty bookkeeping for the debounced disk save.
  dirtyFile: null,            // name of the artifact with unsaved edits
  saveTimer: 0,
  saveInFlight: false,
  pendingSave: false,

  todos: [],                  // [{ text, status: 'pending'|'active'|'done' }]
  userMsgs: [],               // mixed timeline of msg + tool entries

  streaming: false,           // generate request is in flight
  planning:  false,           // submitted but no event yet
  writingName: null,          // file currently being written, derived from todos

  zoom: 'fit',                // 'fit' or a numeric scale factor
};

// Track which todos we've already animated so re-renders don't replay the
// slide-in keyframe every time a status flips.
export const animatedTodoKeys = new Set();
