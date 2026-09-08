/**
 * Core Pine Script logic — shared between MCP tools and CLI.
 * All functions accept plain options objects and return plain JS objects.
 * They throw on error (callers catch and format).
 */
import { evaluate, evaluateAsync, getClient } from '../connection.js';

// ── Monaco finder (injected into TV page) ──
const FIND_MONACO = `
  (function findMonacoEditor() {
    var container = document.querySelector('.monaco-editor.pine-editor-monaco');
    if (!container) return null;
    var el = container;
    var fiberKey;
    for (var i = 0; i < 20; i++) {
      if (!el) break;
      fiberKey = Object.keys(el).find(function(k) { return k.startsWith('__reactFiber$'); });
      if (fiberKey) break;
      el = el.parentElement;
    }
    if (!fiberKey) return null;
    var current = el[fiberKey];
    for (var d = 0; d < 15; d++) {
      if (!current) break;
      if (current.memoizedProps && current.memoizedProps.value && current.memoizedProps.value.monacoEnv) {
        var env = current.memoizedProps.value.monacoEnv;
        if (env.editor && typeof env.editor.getEditors === 'function') {
          var editors = env.editor.getEditors();
          if (editors.length > 0) return { editor: editors[0], env: env };
        }
      }
      current = current.return;
    }
    return null;
  })()
`;


// ── Save-target tracking ──
// TradingView keeps the Pine Editor bound to exactly one saved script.
// Injecting text with monaco.setValue() does NOT move that binding, so a save
// issued after pine_open or pine_new lands on whichever script was bound
// before — silently, and reported as success. The binding is not readable
// from the page, so instead we snapshot the saved-script list around every
// save and report which script actually changed. That turns a silent
// overwrite into a loud, named error.
// See https://github.com/tradesdontlie/tradingview-mcp/issues/513
let pendingOpen = null;

const SAVE_SETTLE_MS = 1200;

/**
 * Resolve a saved script by name.
 * Precedence: exact scriptName, exact scriptTitle, then substring on each.
 * Matching name and title with equal precedence let a script whose *title*
 * collided with the query win over the script actually *named* that.
 * Pure — exported for tests.
 */
export function resolveScriptMatch(scripts, name) {
  const target = String(name ?? '').trim().toLowerCase();
  if (!target || !Array.isArray(scripts)) return null;
  const lc = (v) => String(v ?? '').toLowerCase();
  const passes = [
    ['name (exact)', (sc) => lc(sc.name) === target],
    ['title (exact)', (sc) => lc(sc.title) === target],
    ['name (substring)', (sc) => lc(sc.name).includes(target)],
    ['title (substring)', (sc) => lc(sc.title).includes(target)],
  ];
  for (const [matched_on, pred] of passes) {
    const script = scripts.find(pred);
    if (script) return { script, matched_on };
  }
  return null;
}

/**
 * Which scripts differ between two snapshots of the saved-script list.
 * Newly created scripts sort ahead of updated ones.
 * Pure — exported for tests.
 */
export function diffScriptVersions(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const prev = new Map(before.map((sc) => [sc.id, sc]));
  const changed = [];
  for (const sc of after) {
    const was = prev.get(sc.id);
    if (!was) {
      changed.push({ ...sc, change: 'created' });
    } else if (String(was.version) !== String(sc.version) || String(was.modified) !== String(sc.modified)) {
      changed.push({ ...sc, change: 'updated', from_version: was.version });
    }
  }
  return changed.sort((a, b) => (a.change === 'created' ? -1 : 0) - (b.change === 'created' ? -1 : 0));
}

/**
 * The Pine Editor's title button shows the script the editor is actually
 * BOUND to — independent of what is in the text buffer. This is the binding
 * pine_open cannot move, so reading it lets us refuse a save before it
 * happens rather than reporting the damage afterwards.
 * Returns null if the control cannot be read.
 */
async function readBoundScriptName() {
  const name = await evaluate(`
    (function() {
      var btn = document.querySelector('[class*="nameButton"]');
      if (!btn) return null;
      var t = (btn.textContent || '').trim();
      return t || null;
    })()
  `);
  return name || null;
}

/**
 * Pre-flight guard. Throws before any write if the editor is bound to a
 * different script than the caller opened. Returns the bound name when the
 * check passes, or null when the binding could not be read (in which case
 * verifySaveTarget still catches it after the fact).
 */
async function assertSaveTarget({ force = false } = {}) {
  if (force || !pendingOpen) return null;

  const bound = await readBoundScriptName();
  if (!bound) return null;

  if (pendingOpen.isNew) {
    throw new Error(
      `Refusing to save: pine_new only reset the editor buffer, it did not create a script. ` +
      `The editor is still bound to "${bound}", so saving would overwrite it. ` +
      `Use the Pine Editor's own Create new / Make a copy to create a script, or pass force:true ` +
      `to deliberately overwrite "${bound}".`
    );
  }

  if (pendingOpen.name && bound !== pendingOpen.name) {
    throw new Error(
      `Refusing to save: the editor is bound to "${bound}", not "${pendingOpen.name}". ` +
      `pine_open replaced the editor text but TradingView keeps the save target on the previously ` +
      `bound script, so this save would overwrite "${bound}" (issue #513). Switch scripts using the ` +
      `editor's own Open script… dialog, or pass force:true to write to "${bound}" on purpose.`
    );
  }

  return bound;
}

/** Snapshot the saved-script list. Returns null if it cannot be read. */
async function fetchSavedScriptIndex() {
  const data = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!Array.isArray(d)) return {error: 'Unexpected response from pine-facade'};
        return d.map(function(s) {
          return {
            id: s.scriptIdPart || null,
            name: s.scriptName || s.scriptTitle || 'Untitled',
            title: s.scriptTitle || null,
            version: s.version || null,
            modified: s.modified || null,
          };
        });
      })
      .catch(function(e) { return {error: e.message}; })
  `);
  return Array.isArray(data) ? data : null;
}

/**
 * Compare the saved-script list before and after a save and report which
 * script actually changed. Throws if it is not the one the caller opened.
 */
async function verifySaveTarget(before, { force = false } = {}) {
  const expected = pendingOpen;

  if (!before) {
    return { save_target: null, save_verified: false, note: 'Could not snapshot the saved-script list; save target unverified.' };
  }

  await new Promise((r) => setTimeout(r, SAVE_SETTLE_MS));
  const after = await fetchSavedScriptIndex();
  if (!after) {
    return { save_target: null, save_verified: false, note: 'Could not re-read the saved-script list; save target unverified.' };
  }

  const changed = diffScriptVersions(before, after);
  if (changed.length === 0) {
    return { save_target: null, save_verified: false, note: 'No saved script changed. The save may not have completed.' };
  }

  const hit = changed[0];
  const target = { id: hit.id, name: hit.name, title: hit.title, version: hit.version, change: hit.change };

  if (expected) {
    const wrongScript = expected.id && hit.id !== expected.id;
    const shouldHaveBeenNew = expected.isNew && hit.change === 'updated';
    if (wrongScript || shouldHaveBeenNew) {
      pendingOpen = null;
      if (!force) {
        const wanted = expected.isNew ? 'a newly created script' : `"${expected.name}" (${expected.id})`;
        throw new Error(
          `Save landed on the wrong script. Expected ${wanted}, but "${hit.name}" (${hit.id}) was overwritten ` +
          `and is now at version ${hit.version}. TradingView keeps the Pine Editor bound to one script, and ` +
          `pine_open / pine_new only replace the editor text — they do not move that binding (issue #513). ` +
          `Restore "${hit.name}" from its version history, then switch scripts using the editor's own ` +
          `Open / Save as. Pass force:true to skip this check.`
        );
      }
      return { save_target: target, save_verified: false, note: 'Save-target mismatch suppressed by force:true.' };
    }
  }

  pendingOpen = null;
  return { save_target: target, save_verified: true };
}

/**
 * Opens the Pine Editor panel and waits for Monaco to become available.
 * Returns true if editor is accessible, false on timeout.
 */
export async function ensurePineEditorOpen() {
  const already = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      return m !== null;
    })()
  `);
  if (already) return true;

  await evaluate(`
    (function() {
      var bwb = window.TradingView && window.TradingView.bottomWidgetBar;
      if (!bwb) return;
      if (typeof bwb.activateScriptEditorTab === 'function') bwb.activateScriptEditorTab();
      else if (typeof bwb.showWidget === 'function') bwb.showWidget('pine-editor');
    })()
  `);

  await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Pine"]')
        || document.querySelector('[data-name="pine-dialog-button"]');
      if (btn) btn.click();
    })()
  `);

  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 200));
    const ready = await evaluate(`(function() { return ${FIND_MONACO} !== null; })()`);
    if (ready) return true;
  }
  return false;
}

// ── Pure / offline functions ──

export function analyze({ source }) {
  const lines = source.split('\n');
  const diagnostics = [];

  let isV6 = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//@version=6')) { isV6 = true; break; }
    if (trimmed.startsWith('//@version=')) break;
    if (trimmed === '' || trimmed.startsWith('//')) continue;
    break;
  }

  const arrays = new Map();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fromMatch = line.match(/(\w+)\s*=\s*array\.from\(([^)]*)\)/);
    if (fromMatch) {
      const name = fromMatch[1].trim();
      const args = fromMatch[2].trim();
      const size = args === '' ? 0 : args.split(',').length;
      arrays.set(name, { name, size, line: i + 1 });
      continue;
    }
    const newMatch = line.match(/(\w+)\s*=\s*array\.new(?:<\w+>|_\w+)\((\d+)?/);
    if (newMatch) {
      const name = newMatch[1].trim();
      const size = newMatch[2] !== undefined ? parseInt(newMatch[2], 10) : null;
      arrays.set(name, { name, size, line: i + 1 });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const pattern = /array\.(get|set)\(\s*(\w+)\s*,\s*(-?\d+)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const method = match[1];
      const arrName = match[2];
      const idx = parseInt(match[3], 10);
      const info = arrays.get(arrName);
      if (!info || info.size === null) continue;
      if (idx < 0 || idx >= info.size) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `array.${method}(${arrName}, ${idx}) — index ${idx} out of bounds (array size is ${info.size})`,
          severity: 'error',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const firstLastPattern = /(\w+)\.(first|last)\(\)/g;
    let match;
    while ((match = firstLastPattern.exec(line)) !== null) {
      const arrName = match[1];
      if (arrName === 'array') continue;
      const info = arrays.get(arrName);
      if (info && info.size === 0) {
        diagnostics.push({
          line: i + 1, column: match.index + 1,
          message: `${arrName}.${match[2]}() called on possibly empty array (declared with size 0)`,
          severity: 'warning',
        });
      }
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.includes('strategy.entry') || trimmed.includes('strategy.close')) {
      let hasStrategyDecl = false;
      for (const l of lines) {
        if (l.trim().startsWith('strategy(')) { hasStrategyDecl = true; break; }
      }
      if (!hasStrategyDecl) {
        diagnostics.push({
          line: i + 1, column: 1,
          message: 'strategy.entry/close used but no strategy() declaration found — did you mean to use indicator()?',
          severity: 'error',
        });
        break;
      }
    }
  }

  if (!isV6 && source.includes('//@version=')) {
    const vMatch = source.match(/\/\/@version=(\d+)/);
    if (vMatch && parseInt(vMatch[1]) < 5) {
      diagnostics.push({
        line: 1, column: 1,
        message: `Script uses Pine v${vMatch[1]} — consider upgrading to v6 for latest features`,
        severity: 'info',
      });
    }
  }

  return {
    success: true,
    issue_count: diagnostics.length,
    diagnostics,
    note: diagnostics.length === 0 ? 'No static analysis issues found. Use pine_compile or pine_smart_compile for full server-side compilation check.' : undefined,
  };
}

export async function check({ source }) {
  const formData = new URLSearchParams();
  formData.append('source', source);

  const response = await fetch(
    'https://pine-facade.tradingview.com/pine-facade/translate_light?user_name=Guest&pine_id=00000000-0000-0000-0000-000000000000',
    {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://www.tradingview.com/',
      },
      body: formData,
    }
  );

  if (!response.ok) {
    throw new Error(`TradingView API returned ${response.status}: ${response.statusText}`);
  }

  const result = await response.json();
  const errors = [];
  const warnings = [];
  const inner = result?.result;

  if (inner) {
    if (inner.errors2 && inner.errors2.length > 0) {
      for (const e of inner.errors2) {
        errors.push({
          line: e.start?.line, column: e.start?.column,
          end_line: e.end?.line, end_column: e.end?.column,
          message: e.message,
        });
      }
    }
    if (inner.warnings2 && inner.warnings2.length > 0) {
      for (const w of inner.warnings2) {
        warnings.push({ line: w.start?.line, column: w.start?.column, message: w.message });
      }
    }
  }

  if (result.error && typeof result.error === 'string') {
    errors.push({ message: result.error });
  }

  const compiled = errors.length === 0;
  return {
    success: true,
    compiled,
    error_count: errors.length,
    warning_count: warnings.length,
    errors: errors.length > 0 ? errors : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
    note: compiled ? 'Pine Script compiled successfully.' : undefined,
  };
}

// ── Functions requiring TradingView connection ──

export async function getSource() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor or Monaco not found in React fiber tree.');

  const source = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return null;
      return m.editor.getValue();
    })()
  `);

  if (source === null || source === undefined) {
    throw new Error('Monaco editor found but getValue() returned null.');
  }

  return { success: true, source, line_count: source.split('\n').length, char_count: source.length };
}

export async function setSource({ source }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const escaped = JSON.stringify(source);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco found but setValue() failed.');
  return { success: true, lines_set: source.split('\n').length };
}

export async function compile() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const clicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var fallback = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!fallback && /^(Add to chart|Update on chart)/i.test(text)) {
          fallback = btns[i];
        }
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) {
          saveBtn = btns[i];
        }
      }
      if (fallback) { fallback.click(); return fallback.textContent.trim(); }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!clicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2000));
  return { success: true, button_clicked: clicked || 'keyboard_shortcut', source: 'dom_fallback' };
}

export async function getErrors() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  return {
    success: true,
    has_errors: errors?.length > 0,
    error_count: errors?.length || 0,
    errors: errors || [],
  };
}

export async function save({ force = false } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const boundName = await assertSaveTarget({ force });
  const before = await fetchSavedScriptIndex();

  const c = await getClient();
  await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 's', code: 'KeyS', windowsVirtualKeyCode: 83 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 's', code: 'KeyS' });
  await new Promise(r => setTimeout(r, 800));

  // Handle "Save Script" name dialog that appears for new/unsaved scripts
  const dialogHandled = await evaluate(`
    (function() {
      var saveBtn = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (text === 'Save' && btns[i].offsetParent !== null) {
          // Check if it's in a dialog (not the Pine Editor save button)
          var parent = btns[i].closest('[class*="dialog"], [class*="modal"], [class*="popup"], [role="dialog"]');
          if (parent) { saveBtn = btns[i]; break; }
        }
      }
      if (saveBtn) { saveBtn.click(); return true; }
      return false;
    })()
  `);

  if (dialogHandled) await new Promise(r => setTimeout(r, 500));

  const verdict = await verifySaveTarget(before, { force });

  return { success: true, action: dialogHandled ? 'saved_with_dialog' : 'Ctrl+S_dispatched', bound_script: boundName, ...verdict };
}

export async function getConsole() {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const entries = await evaluate(`
    (function() {
      var results = [];
      var rows = document.querySelectorAll('[class*="consoleRow"], [class*="log-"], [class*="consoleLine"]');
      if (rows.length === 0) {
        var bottomArea = document.querySelector('[class*="layout__area--bottom"]')
          || document.querySelector('[class*="bottom-widgetbar-content"]');
        if (bottomArea) {
          rows = bottomArea.querySelectorAll('[class*="message"], [class*="log"], [class*="console"]');
        }
      }
      if (rows.length === 0) {
        var pinePanel = document.querySelector('.pine-editor-container')
          || document.querySelector('[class*="pine-editor"]')
          || document.querySelector('[class*="layout__area--bottom"]');
        if (pinePanel) {
          var allSpans = pinePanel.querySelectorAll('span, div');
          for (var s = 0; s < allSpans.length; s++) {
            var txt = allSpans[s].textContent.trim();
            if (/^\\d{2}:\\d{2}:\\d{2}/.test(txt) || /error|warning|info/i.test(allSpans[s].className)) {
              rows = Array.from(rows || []);
              rows.push(allSpans[s]);
            }
          }
        }
      }
      for (var i = 0; i < rows.length; i++) {
        var text = rows[i].textContent.trim();
        if (!text) continue;
        var ts = null;
        var tsMatch = text.match(/^(\\d{4}-\\d{2}-\\d{2}\\s+)?\\d{2}:\\d{2}:\\d{2}/);
        if (tsMatch) ts = tsMatch[0];
        var type = 'info';
        var cls = rows[i].className || '';
        if (/error/i.test(cls) || /error/i.test(text.substring(0, 30))) type = 'error';
        else if (/compil/i.test(text.substring(0, 40))) type = 'compile';
        else if (/warn/i.test(cls)) type = 'warning';
        results.push({ timestamp: ts, type: type, message: text });
      }
      return results;
    })()
  `);

  return { success: true, entries: entries || [], entry_count: entries?.length || 0 };
}

export async function smartCompile({ force = false } = {}) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  // smartCompile clicks the editor's own Save button, so it writes to the same
  // bound script pine_save does and needs the same guard (issue #513).
  const boundName = await assertSaveTarget({ force });
  const savedBefore = await fetchSavedScriptIndex();

  const studiesBefore = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const buttonClicked = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button');
      var addBtn = null;
      var updateBtn = null;
      var saveBtn = null;
      for (var i = 0; i < btns.length; i++) {
        var text = btns[i].textContent.trim();
        if (/save and add to chart/i.test(text)) {
          btns[i].click();
          return 'Save and add to chart';
        }
        if (!addBtn && /^add to chart$/i.test(text)) addBtn = btns[i];
        if (!updateBtn && /^update on chart$/i.test(text)) updateBtn = btns[i];
        if (!saveBtn && btns[i].className.indexOf('saveButton') !== -1 && btns[i].offsetParent !== null) saveBtn = btns[i];
      }
      if (addBtn) { addBtn.click(); return 'Add to chart'; }
      if (updateBtn) { updateBtn.click(); return 'Update on chart'; }
      if (saveBtn) { saveBtn.click(); return 'Pine Save'; }
      return null;
    })()
  `);

  if (!buttonClicked) {
    const c = await getClient();
    await c.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 2, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  }

  await new Promise(r => setTimeout(r, 2500));

  const errors = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return [];
      var model = m.editor.getModel();
      if (!model) return [];
      var markers = m.env.editor.getModelMarkers({ resource: model.uri });
      return markers.map(function(mk) {
        return { line: mk.startLineNumber, column: mk.startColumn, message: mk.message, severity: mk.severity };
      });
    })()
  `);

  const studiesAfter = await evaluate(`
    (function() {
      try {
        var chart = window.TradingViewApi._activeChartWidgetWV.value();
        if (chart && typeof chart.getAllStudies === 'function') return chart.getAllStudies().length;
      } catch(e) {}
      return null;
    })()
  `);

  const studyAdded = (studiesBefore !== null && studiesAfter !== null) ? studiesAfter > studiesBefore : null;

  const verdict = await verifySaveTarget(savedBefore, { force });

  return {
    success: true,
    button_clicked: buttonClicked || 'keyboard_shortcut',
    has_errors: errors?.length > 0,
    errors: errors || [],
    study_added: studyAdded,
    bound_script: boundName,
    ...verdict,
  };
}

export async function newScript({ type }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const typeMap = { indicator: 'indicator', strategy: 'strategy', library: 'library' };
  const templates = {
    indicator: '//@version=6\nindicator("My script")\nplot(close)',
    strategy: '//@version=6\nstrategy("My strategy", overlay=true)\n',
    library: '//@version=6\n// @description TODO: add library description here\nlibrary("MyLibrary")\n',
  };

  const template = templates[type] || templates.indicator;

  // Simply set the source to a new template — this is the most reliable approach
  const escaped = JSON.stringify(template);
  const set = await evaluate(`
    (function() {
      var m = ${FIND_MONACO};
      if (!m) return false;
      m.editor.setValue(${escaped});
      return true;
    })()
  `);

  if (!set) throw new Error('Monaco editor not found. Ensure Pine Editor is open.');

  // This only replaces the editor buffer. TradingView still has the editor
  // bound to the previously open script, so the next save would overwrite that
  // script rather than create a new one. Flag it so verifySaveTarget can catch
  // the overwrite instead of letting it through silently (issue #513).
  pendingOpen = { id: null, name: null, isNew: true };

  return {
    success: true,
    type,
    action: 'editor_buffer_reset',
    template: typeMap[type],
    warning: 'This replaced the editor text only — no new script was created and the save target has NOT changed. '
      + 'Saving now would overwrite the previously open script; the save is verified and will fail loudly if it does. '
      + "Use the Pine Editor's own New / Save as to genuinely create a script.",
  };
}

export async function openScript({ name }) {
  const editorReady = await ensurePineEditorOpen();
  if (!editorReady) throw new Error('Could not open Pine Editor.');

  const scripts = await fetchSavedScriptIndex();
  if (!scripts) throw new Error('Could not read the saved script list from pine-facade.');

  const hit = resolveScriptMatch(scripts, name);
  if (!hit) {
    throw new Error(`Script "${name}" not found. Use pine_list_scripts to see available scripts.`);
  }

  const { script, matched_on } = hit;
  const idLit = JSON.stringify(String(script.id));
  const verLit = JSON.stringify(String(script.version || 1));

  const result = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/get/' + ${idLit} + '/' + ${verLit}, { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var source = data.source || '';
        if (!source) return {error: 'Script source is empty'};
        var m = ${FIND_MONACO};
        if (!m) return {error: 'Monaco editor not found to inject source'};
        m.editor.setValue(source);
        return {success: true, lines: source.split('\\n').length};
      })
      .catch(function(e) { return {error: e.message}; })
  `);

  if (result?.error) throw new Error(result.error);

  const wanted = script.name || script.title;

  // Injecting text does not move TradingView's save binding. Read the binding
  // back so the caller is told the truth rather than being handed a script_id
  // that implies a rebind that never happened.
  const bound = await readBoundScriptName();
  const boundMoved = bound !== null && bound === wanted;

  // Nothing to guard against if the editor was already bound to this script.
  pendingOpen = boundMoved ? null : { id: script.id, name: wanted, isNew: false };

  return {
    success: true,
    name: wanted,
    title: script.title,
    script_id: script.id,
    matched_on,
    lines: result.lines,
    source: 'internal_api',
    opened: true,
    editor_bound_to: bound,
    save_target_moved: boundMoved,
    ...(boundMoved ? {} : {
      warning: `Editor text replaced, but TradingView's save target is still "${bound ?? 'unknown'}", not `
        + `"${wanted}". Saving now would overwrite that script, so pine_save and pine_smart_compile will `
        + 'refuse until you switch scripts with the editor\'s own Open script\u2026 dialog (issue #513).',
    }),
  };
}

export async function listScripts() {
  const scripts = await evaluateAsync(`
    fetch('https://pine-facade.tradingview.com/pine-facade/list/?filter=saved', { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) return {scripts: [], error: 'Unexpected response from pine-facade'};
        return {
          scripts: data.map(function(s) {
            return {
              id: s.scriptIdPart || null,
              name: s.scriptName || s.scriptTitle || 'Untitled',
              title: s.scriptTitle || null,
              version: s.version || null,
              modified: s.modified || null,
            };
          })
        };
      })
      .catch(function(e) { return {scripts: [], error: e.message}; })
  `);

  return {
    success: true,
    scripts: scripts?.scripts || [],
    count: scripts?.scripts?.length || 0,
    source: 'internal_api',
    error: scripts?.error,
  };
}
