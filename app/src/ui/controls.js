// Accessible radio groups (segmented control, chips) and the Low Lag switch.
// Radio groups use a roving tabindex: Tab enters the group, arrow keys move and select.
import { reducedMotion } from './motion.js';

export function radioGroup(root, onSelect) {
  const items = () => [...root.querySelectorAll('[role="radio"]')];
  let enabled = true;

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[role="radio"]');
    if (!btn || !enabled || btn.disabled) return;
    onSelect(btn.dataset.value, btn);
  });

  root.addEventListener('keydown', (e) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' };
    if (!(e.key in keys) || !enabled) return;
    e.preventDefault();
    const list = items();
    const i = list.indexOf(document.activeElement);
    let next = keys[e.key] === 'first' ? 0 : keys[e.key] === 'last' ? list.length - 1 : (i + keys[e.key] + list.length) % list.length;
    list[next].focus();
    onSelect(list[next].dataset.value, list[next]);
  });

  return {
    // Show the given value as checked. null clears the group.
    set(value) {
      const list = items();
      let index = -1;
      list.forEach((b, i) => {
        const on = b.dataset.value === value;
        b.setAttribute('aria-checked', String(on));
        if (on) index = i;
      });
      // roving tabindex: the checked item (or the first) is the tab stop
      list.forEach((b, i) => (b.tabIndex = i === (index < 0 ? 0 : index) ? 0 : -1));
      root.style.setProperty('--i', String(Math.max(0, index)));
      root.dataset.empty = String(index < 0);
    },
    setEnabled(on) {
      enabled = on;
      items().forEach((b) => (b.disabled = !on));
    },
  };
}

export function switchControl(btn, onToggle) {
  let enabled = true;
  btn.addEventListener('click', () => {
    if (!enabled) return;
    onToggle(btn.getAttribute('aria-checked') !== 'true');
  });
  return {
    set(on) { btn.setAttribute('aria-checked', String(!!on)); },
    setEnabled(on) { enabled = on; btn.disabled = !on; },
  };
}

// Short dot ripple from the centre of a chip.
export function dotRipple(el) {
  if (reducedMotion()) return;
  const span = document.createElement('span');
  span.className = 'ripple';
  el.append(span);
  const anim = span.animate(
    [
      { clipPath: 'circle(0% at 50% 50%)', opacity: 0.9 },
      { clipPath: 'circle(75% at 50% 50%)', opacity: 0 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
  );
  anim.onfinish = () => span.remove();
}
