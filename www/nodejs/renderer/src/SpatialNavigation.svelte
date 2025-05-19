<script>
  const { container, debug = false, onFocus = null, onXFocus = null, path = null, onNavigate = null } = $props();

  // Estado reativo
  const state = $state({
    layouts: [],
    className: 'selected',
    parentClassName: 'selected-parent',
    selectedIndex: 0,
    selectionMemory: {} // Adicionado para armazenar memória por path
  });

  let lastSelected = null;

  // Função para salvar o estado da seleção
  function saveSelectionMemory() {
    const currentLayout = activeLayout().name;
    const currentPath = currentLayout === 'default' ? path : '';
    if (state.selectionMemory['']) {
      for (const layoutName in state.selectionMemory['']) {
        if (layoutName === 'default' || layoutName === currentLayout) continue;
        delete state.selectionMemory[''][layoutName];
      }
    }
    if (!state.selectionMemory[currentPath]) {
      state.selectionMemory[currentPath] = {};
    }
    state.selectionMemory[currentPath][currentLayout] = {
      selectedIndex: state.selectedIndex,
      scrollTop: container.scrollTop
    };
  }

  export function memory() {
    return Object.assign({}, state.selectionMemory);
  }

  // Função para disparar eventos personalizados
  function dispatch(eventName, detail) {
    if (container) {
      container.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  }

  function selector(s, ignoreViewport) {
    return [...document.querySelectorAll(s)].filter(e => isVisible(e, ignoreViewport));
  }

  function isVisible(element, ignoreViewport) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    return ignoreViewport || (rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth);
  }

  function selectables(ignoreViewport) {
    const layout = activeLayout();
    return layout ? entries(true, ignoreViewport) : [];
  }

  function updateSelectedElementClasses(element) {
    if (element && element.classList) {
      document.querySelectorAll('.' + state.className).forEach(e => e.classList.remove(state.className));
      document.querySelectorAll('.' + state.parentClassName).forEach(e => e.classList.remove(state.parentClassName));
      element.classList.add(state.className);
      element.parentNode?.classList?.add(state.parentClassName);
    }
  }

  function selected(force, preventScroll, animate) {
    if (lastSelected && lastSelected.name === activeLayout().name && isVisible(lastSelected.element, true)) {
      return lastSelected.element;
    }
    const selectablesList = selectables(true);
    let element = selectablesList.find(e => e.classList.contains(state.className)) || selectablesList[0] || null;
    if (!element && force) {
      element = selectablesList[0];
    }
    element && focus(element, preventScroll, animate);
    return element;
  }

  export function focus(element, preventScroll, animate) {
    if (!element) return;
    if (element.classList.contains(state.className) && (isDefault && state.selectedIndex == element.tabIndex)) return;
    let emit = true;
    const layout = activeLayout();
    const isDefault = layout.name === 'default';
    updateSelectedElementClasses(element);
    const index = element.tabIndex;
    if (index !== -1) {
      if (isDefault && state.selectedIndex == index) {
        emit = false;
      } else {
        state.selectedIndex = index;
        saveSelectionMemory(); // Salva o estado da seleção
      }
    }
    lastSelected = {element, name: layout.name};
    element.focus({ preventScroll: true });
    if (!preventScroll) {
      element.scrollIntoViewIfNeeded({
        behavior: animate ? 'smooth' : 'instant',
        block: 'nearest',
        inline: 'nearest'
      });
    }
    if (emit) {
      if (isDefault && typeof onFocus === 'function') {
        onFocus({ index, element });
      } else if (!isDefault && typeof onXFocus === 'function') {
        onXFocus({ index, element });
      }
    }
  }

  export function focusIndex(index) {
    const selectablesList = selectables(true);
    const element = inDefaultLayout() ? selectablesList.find(e => e.tabIndex == index) : selectablesList[index];
    if (element) {
      focus(element, false, true);
    }
  }

  export function reset() {
    const currentPath = path;
    const currentLayout = activeLayout().name;
    const isDefault = currentLayout === 'default';
    const memory = state.selectionMemory[currentPath]?.[currentLayout];
    if (memory) return memory;
    return {
      selectedIndex: (path && isDefault) ? 1 : 0,
      scrollTop: 0
    }
  }

  function activeLayout() {
    const layout = state.layouts.find(layout => layout.condition()) || { selector: 'body', name: 'default' }
    if (layout.name === 'default') {
      for (const layoutName in state.selectionMemory['']) {
        if (layoutName === 'default' || layoutName === layout.name) continue;
        delete state.selectionMemory[''][layoutName];
      }
    }
    return layout;
  }

  export function inDefaultLayout() {
    return activeLayout().name === 'default';
  }

  export function entries(noAsides, ignoreViewport) {
    let elements = [];
    const layout = activeLayout();
    if (!layout) return [];
    let sel = layout.selector;
    if (typeof sel === 'function') sel = sel();
    if (typeof sel === 'string') {
      elements.push(...selector(sel, ignoreViewport));
    } else if (Array.isArray(sel)) {
      elements.push(...sel.map(s => typeof s === 'string' ? selector(s, ignoreViewport) : s).flat());
    } else {
      console.error('Bad layer selector');
    }
    elements = elements.filter(e => !e.className?.includes('menu-not-navigable'));
    if (layout.default && noAsides) {
      const rgx = new RegExp('^svelte-virtual-grid-', 'i');
      elements = elements.filter(e => e.parentNode.tagName.match(rgx));
    }
    return elements;
  }

  export function addLayout(layout) {
    state.layouts = [...state.layouts, layout];
  }

  function distance(c, e) {
    return Math.hypot(e.left - c.left, e.top - c.top);
  }

  function angle(c, e) {
    let theta = Math.atan2(e.top - c.top, e.left - c.left) * 180 / Math.PI + 90;
    return theta < 0 ? 360 + theta : theta;
  }

  function angleDiff(angle, dest) {
    let diff = (angle - dest) % 360;
    if (diff < -180) diff += 360;
    if (diff > 180) diff -= 360;
    return Math.abs(diff);
  }

  function coords(element) {
    if (!element) return null;
    const c = element.getBoundingClientRect();
    return { left: c.left + c.width / 2, top: c.top + c.height / 2 };
  }

  function findNextElement(direction, notCyclic=false) {
    let closer, closerScore;
    const items = entries(true, true);
    const current = selected();
    const layout = activeLayout();
    if (!current) return selected(true, false, true);

    let angleDest;
    switch (direction) {
      case 'up': angleDest = 0; break;
      case 'right': angleDest = 90; break;
      case 'down': angleDest = 180; break;
      case 'left': angleDest = 270; break;
    }

    const currentCoords = coords(current);
    if (!currentCoords) return null;

    if (debug) console.log('scores from', current.title || current.id || current.className, current);
    items.forEach(item => {
      if (item !== current) {
        const itemCoords = coords(item);
        if (itemCoords) {
          if (['up', 'down'].includes(direction) && itemCoords.top === currentCoords.top && item.offsetHeight === current.offsetHeight) return;
          if (['left', 'right'].includes(direction) && itemCoords.left === currentCoords.left && item.offsetWidth === current.offsetWidth) return;
          const angleVal = angle(currentCoords, itemCoords);
          const angleDiffVal = angleDiff(angleVal, angleDest);
          if (angleDiffVal < 60 && isVisible(item, true)) {
            const dist = distance(currentCoords, itemCoords);
            const score = dist + angleDiffVal
            if (debug) console.log('score', item.title || item.id || item.className || item, score, {dist, angleDiffVal, closerScore});
            if (!closer || score < closerScore) {
              closer = item;
              closerScore = score;
            }
          }
        }
      }
    });

    if (!closer && typeof layout.overScrollAction === 'function' && !notCyclic) {
      if (debug) console.log('overScrollAction', direction, current);
      const result = layout.overScrollAction(direction, current);
      if (result === true) {
        if (debug) console.log('overScrollAction consumed', direction, current);
        return null; // overScrollAction consumiu a ação
      }
    }

    return closer;
  }

  export function navigate(direction, notCyclic=false) {
    const closer = findNextElement(direction, notCyclic);
    if (closer) {
      if (debug) console.log('Navigating ', direction, closer);
      onNavigate(closer);
      focus(closer, false, true);
    }
  }

</script>