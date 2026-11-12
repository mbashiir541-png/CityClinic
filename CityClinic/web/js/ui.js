// Small DOM / UI helpers shared by all views.

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Tagged template that HTML-escapes interpolated values.
 * - raw(x) inserts x without escaping
 * - arrays are joined WITHOUT escaping (they are expected to be lists of
 *   html`` fragments, e.g. rows.map(r => html`<tr>...</tr>`))
 */
export function html(strings, ...values) {
  return strings.reduce((out, s, i) => {
    if (i >= values.length) return out + s;
    const v = values[i];
    const str = Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.v : String(x ?? ''))).join('')
      : v instanceof Raw ? v.v : esc(v);
    return out + s + str;
  }, '');
}
class Raw { constructor(v) { this.v = v; } }
export const raw = (v) => new Raw(v);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- Formatting ----------
export const todayISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
export const time = (t) => (t ? t.slice(0, 5) : '');
export function date(d, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, opts);
}
export function age(dob) {
  if (!dob) return '';
  const [y, m, d] = dob.split('-').map(Number);
  const now = new Date();
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a;
}
export const statusBadge = (s) => raw(`<span class="badge ${esc(s)}">${esc(s)}</span>`);
export const activeBadge = (on) => raw(on ? '<span class="badge active">Active</span>' : '<span class="badge inactive">Inactive</span>');

// ---------- Toasts ----------
export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}
export const toastError = (err) => toast(err.message || 'Something went wrong', 'error');

// ---------- Modal ----------
/**
 * Open a modal. Returns { el, close }.
 * `onSubmit(formData, ctx)` - if it resolves, the modal closes. If it throws an
 * ApiError, field errors are shown inline.
 */
export function modal({ title, body, submitLabel = 'Save', danger = false, onSubmit, onOpen, wide = false, footer = true }) {
  const root = $('#modal-root');
  root.innerHTML = html`
    <div class="modal-root" role="dialog" aria-modal="true" aria-label="${title}">
      <form class="modal" novalidate style="${wide ? 'max-width:760px' : ''}">
        <div class="modal-head">
          <h2>${title}</h2>
          <button type="button" class="icon-btn" data-close aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-error" hidden></div>
          ${raw(body)}
        </div>
        ${raw(footer ? html`<div class="modal-foot">
          <button type="button" class="btn secondary" data-close>Cancel</button>
          ${raw(onSubmit ? html`<button type="submit" class="btn ${danger ? 'danger' : ''}">${submitLabel}</button>` : '')}
        </div>` : '')}
      </form>
    </div>`;

  const form = $('form', root);
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', close));
  $('.modal-root', root).addEventListener('mousedown', (e) => { if (e.target.classList.contains('modal-root')) close(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return close();
    clearErrors(form);
    const btn = $('button[type=submit]', form);
    btn.disabled = true;
    try {
      await onSubmit(formData(form), { form, close });
      close();
    } catch (err) {
      showErrors(form, err);
    } finally {
      btn.disabled = false;
    }
  });

  const first = $('input:not([type=hidden]), select, textarea', form);
  if (first) setTimeout(() => first.focus(), 30);
  if (onOpen) onOpen(form, { close });
  return { el: form, close };
}

export function confirmDialog(title, message, label = 'Delete') {
  return new Promise((resolve) => {
    let ok = false;
    const m = modal({
      title, danger: true, submitLabel: label,
      body: html`<p>${message}</p>`,
      onSubmit: async () => { ok = true; },
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(m.el)) { observer.disconnect(); resolve(ok); }
    });
    observer.observe($('#modal-root'), { childList: true });
  });
}

// ---------- Forms ----------
export function formData(form) {
  const data = {};
  $$('input[name], select[name], textarea[name]', form).forEach((el) => {
    if (el.type === 'checkbox') {
      if (el.dataset.multi) {
        data[el.name] = data[el.name] || [];
        if (el.checked) data[el.name].push(el.value);
      } else data[el.name] = el.checked;
    } else data[el.name] = el.value.trim();
  });
  return data;
}

export function clearErrors(form) {
  $('.form-error', form).hidden = true;
  $$('.field.invalid', form).forEach((f) => f.classList.remove('invalid'));
  $$('.field .error', form).forEach((e) => e.remove());
}

export function showErrors(form, err) {
  const box = $('.form-error', form);
  let unplaced = [];
  Object.entries(err.errors || {}).forEach(([name, msg]) => {
    const input = $(`[name="${name}"]`, form);
    const field = input?.closest('.field');
    if (field) {
      field.classList.add('invalid');
      field.insertAdjacentHTML('beforeend', html`<div class="error">${msg}</div>`);
    } else unplaced.push(msg);
  });
  const text = [err.message, ...unplaced].filter(Boolean);
  if (!Object.keys(err.errors || {}).length || unplaced.length) {
    box.textContent = text.join(' ');
    box.hidden = false;
  }
  box.scrollIntoView?.({ block: 'nearest' });
}

/** Render a form field. */
export function field(name, label, { type = 'text', value = '', required = false, options = null, attrs = '', hint = '' } = {}) {
  const id = `f-${name}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  if (options) {
    input = html`<select id="${id}" name="${name}" ${raw(attrs)}>${options.map(([v, l]) =>
      raw(html`<option value="${v}" ${raw(String(v) === String(value ?? '') ? 'selected' : '')}>${l}</option>`))}</select>`;
  } else if (type === 'textarea') {
    input = html`<textarea id="${id}" name="${name}" rows="2" ${raw(attrs)}>${value}</textarea>`;
  } else {
    input = html`<input id="${id}" name="${name}" type="${type}" value="${value ?? ''}" ${raw(required ? 'required' : '')} ${raw(attrs)}>`;
  }
  return html`<div class="field"><label for="${id}">${label}${required ? ' *' : ''}</label>${raw(input)}${raw(hint ? html`<div class="small muted">${hint}</div>` : '')}</div>`;
}

export const spinner = () => '<div class="spinner"></div>';
export const empty = (text) => html`<div class="empty">${text}</div>`;
