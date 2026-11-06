(() => {
  const indicator = document.querySelector('#action-indicator');
  const label = document.querySelector('#action-label');
  if (!indicator || !label || !window.corvidActionIndicator) return;
  window.corvidActionIndicator.onState(state => {
    if (!state?.visible) {
      indicator.hidden = true;
      indicator.removeAttribute('data-operation');
      indicator.removeAttribute('aria-label');
      return;
    }
    if (![state.x, state.y].every(Number.isFinite)) return;
    indicator.dataset.operation = state.operation;
    indicator.style.left = `${state.x}px`;
    indicator.style.top = `${state.y}px`;
    indicator.setAttribute('aria-label', state.ariaLabel || '');
    label.textContent = state.label || '';
    indicator.hidden = false;
  });
})();
