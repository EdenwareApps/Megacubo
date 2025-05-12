<script>
  const { container, debug = false, onFocus = null, onXFocus = null, path = null } = $props();

  // Estado reativo
  const state = $state({
    layouts: [],
    angleWeight: 0.2,
    className: 'selected',
    parentClassName: 'selected-parent',
    selectedIndex: 0,
    selectionMemory: {} // Adicionado para armazenar memória por path
  });

  // Função para salvar o estado da seleção
  function saveSelectionMemory() {
    const currentPath = path;
    const currentLayout = activeLayout().level;
    if (!state.selectionMemory[currentPath]) {
      state.selectionMemory[currentPath] = {};
    }
    state.selectionMemory[currentPath][currentLayout] = {
      selectedIndex: state.selectedIndex,
      scrollTop: container.scrollTop
    };
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
    const selectablesList = selectables(false);
    let element = selectablesList.find(e => e.classList.contains(state.className)) || selectablesList[0] || null;
    if (!element && force) {
      element = selectablesList[0];
    }
    element && focus(element, preventScroll, animate);
    return element;
  }

  export function focus(element, preventScroll, animate) {
    if (!element || element.classList.contains(state.className)) return;
    let emit = true;
    const isDefault = inDefaultLayout();
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
    const element = selectablesList.find(e => e.tabIndex == index);
    console.error('focusIndex', index, {selectablesList, element})
    if (element) {
      focus(element, false, true);
    }
  }

  export function reset() {
    const currentPath = path;
    const currentLayout = activeLayout().level;
    const memory = state.selectionMemory[currentPath]?.[currentLayout];
    if (memory) return memory;
    return {
      selectedIndex: path ? 1 : 0,
      scrollTop: 0
    }
  }

  function activeLayout() {
    return state.layouts.find(layout => layout.condition()) || { selector: 'body', level: 'default' };
  }

  export function inDefaultLayout() {
    return activeLayout().level === 'default';
  }

  export function entries(noAsides, ignoreViewport) {
    let elements = [];
    const layout = activeLayout();
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

  function distance(c, e, m) {
    let r = Math.hypot(e.left - c.left, e.top - c.top);
    if (m) r += r * (state.angleWeight * m);
    return r;
  }

  function angle(c, e) {
    let theta = Math.atan2(e.top - c.top, e.left - c.left) * 180 / Math.PI + 90;
    return theta < 0 ? 360 + theta : theta;
  }

  function isAngleWithinRange(angle, start, end) {
    return end > start ? angle >= start && angle <= end : angle < end || angle > start;
  }

  function coords(element) {
    if (!element) return null;
    const c = element.getBoundingClientRect();
    return { left: c.left + c.width / 2, top: c.top + c.height / 2 };
  }

  function arrowMap(direction, notCyclic=false) {
    let closer, closerDist;
    const items = entries(true, true);
    const current = selected();
    const layout = activeLayout();
    if (!current) return selected(true, false, true);

    let directionAngleStart, directionAngleEnd;
    switch (direction) {
      case 'up': directionAngleStart = 270; directionAngleEnd = 90; break;
      case 'right': directionAngleStart = 0; directionAngleEnd = 180; break;
      case 'down': directionAngleStart = 90; directionAngleEnd = 270; break;
      case 'left': directionAngleStart = 180; directionAngleEnd = 360; break;
    }

    const currentCoords = coords(current);
    if (!currentCoords) return null;

    items.forEach(item => {
      if (item !== current) {
        const itemCoords = coords(item);
        if (itemCoords) {
          if (['up', 'down'].includes(direction) && itemCoords.top === currentCoords.top && item.offsetHeight === current.offsetHeight) return;
          if (['left', 'right'].includes(direction) && itemCoords.left === currentCoords.left && item.offsetWidth === current.offsetWidth) return;
          const angleVal = angle(currentCoords, itemCoords);
          if (isAngleWithinRange(angleVal, directionAngleStart, directionAngleEnd)) {
            const dist = distance(currentCoords, itemCoords, 0);
            if (!closer || dist < closerDist) {
              closer = item;
              closerDist = dist;
            }
          }
        }
      }
    });

    if (!closer && typeof layout.overScrollAction === 'function' && !notCyclic) {
      const result = layout.overScrollAction(direction, current);
      if (result === true) {
        return null; // overScrollAction consumiu a ação
      }
    }

    return closer;
  }

  export function arrow(direction, notCyclic=false) {
    const closer = arrowMap(direction, notCyclic);
    if (closer) {
      if (debug) console.log('Navigating ', direction, closer);
      focus(closer, false, true);
    }
  }

  window.SpatialNavigation = {
    focus,
    focusIndex,
    arrow,
    addLayout,
    activeLayout,
    inDefaultLayout,
    selectables,
    updateSelectedElementClasses,
    selected,
    distance,
    angle,
    isAngleWithinRange,
    coords,
    arrowMap,
    state,
    reset // Exposto para uso externo
  };
</script>