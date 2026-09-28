// Małe narzędzia DOM: tworzenie elementów i gotowe kontrolki formularzy inspektora.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Suwak z podglądem wartości. onInput – na żywo (bez historii), onChange – po puszczeniu (z historią).
export function slider(label, value, { min = 0, max = 1, step = 0.01, format = (v) => (+v).toFixed(2), onInput, onChange } = {}) {
  const out = h('output', {}, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      out.textContent = format(e.target.value);
      onInput?.(Number(e.target.value));
    },
    onchange: (e) => onChange?.(Number(e.target.value)),
  });
  return h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'range' }, input, out));
}

export function select(label, value, options, onChange, attrs = {}) {
  const opts = Array.isArray(options) ? options : Object.entries(options).map(([v, l]) => ({ value: v, label: typeof l === 'string' ? l : l.label }));
  const sel = h('select', { onchange: (e) => onChange(e.target.value), ...attrs }, opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
  sel.value = value;
  return label ? h('label', { class: 'field' }, h('span', {}, label), sel) : sel;
}

export function textInput(label, value, onChange, attrs = {}) {
  const input = h('input', { type: 'text', value: value ?? '', onchange: (e) => onChange(e.target.value), ...attrs });
  return label ? h('label', { class: 'field' }, h('span', {}, label), input) : input;
}

export function numberInput(label, value, onChange, { min, max, step = 0.1 } = {}) {
  const input = h('input', { type: 'number', value, min, max, step, onchange: (e) => onChange(Number(e.target.value)) });
  return h('label', { class: 'field' }, h('span', {}, label), input);
}

export function textArea(label, value, onChange, attrs = {}) {
  const ta = h('textarea', { onchange: (e) => onChange(e.target.value), ...attrs });
  ta.value = value ?? '';
  return label ? h('label', { class: 'field stack' }, h('span', {}, label), ta) : ta;
}

export function checkbox(label, value, onChange) {
  return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: value, onchange: (e) => onChange(e.target.checked) }), label);
}

export function colorInput(label, value, onChange) {
  return h('label', { class: 'field' }, h('span', {}, label), h('input', { type: 'color', value, onchange: (e) => onChange(e.target.value) }));
}

export function group(title, ...children) {
  return h('section', { class: 'group' }, h('h3', {}, title), ...children);
}

export function toast(message, kind = 'info', ms = 4200) {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${kind}` }, message);
  box.append(el);
  setTimeout(() => el.remove(), ms);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => {
      resolve(input.files[0] || null);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}
