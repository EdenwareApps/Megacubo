<script>

  const {
    container,
    debug = false,
    onFocus = null,
    onXFocus = null,
    path = null,
    onNavigate = null,
  } = $props();

  const state = $state({
    layouts: [],
    className: "selected",
    parentClassName: "selected-parent",
    selectedIndex: 0,
    selectionMemory: {}, // Adicionado para armazenar memória por path
  });

  let lastSelected = null;

  function saveSelectionMemory() {
    const currentLayout = activeLayout().name;
    const currentPath = currentLayout === "default" ? path : "";
    if (state.selectionMemory[""]) {
      for (const layoutName in state.selectionMemory[""]) {
        if (layoutName === "default" || layoutName === currentLayout) continue;
        delete state.selectionMemory[""][layoutName];
      }
    }
    if (!state.selectionMemory[currentPath]) {
      state.selectionMemory[currentPath] = {};
    }
    
    // Ensure scrollTop is always a valid number
    let scrollTopValue = container.scrollTop;
    if (!isFinite(scrollTopValue) || scrollTopValue < 0) {
      console.warn('Invalid scrollTop in saveSelectionMemory:', scrollTopValue, 'using 0');
      scrollTopValue = 0;
    }
    
    state.selectionMemory[currentPath][currentLayout] = {
      selectedIndex: state.selectedIndex,
      scrollTop: scrollTopValue,
    };
  }

  export function memory() {
    return Object.assign({}, state.selectionMemory);
  }

  function dispatch(eventName, detail) {
    if (container) {
      container.dispatchEvent(new CustomEvent(eventName, { detail }));
    }
  }

  function selector(s, ignoreViewport) {
    if (!s || typeof s !== 'string') {
      console.warn('SpatialNavigation: Invalid selector', s);
      return [];
    }
    try {
      return [...document.querySelectorAll(s)].filter((e) =>
        isVisible(e, ignoreViewport),
      );
    } catch (error) {
      console.warn('SpatialNavigation: Error querying selector', s, error);
      return [];
    }
  }

  function isVisible(element, ignoreViewport) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    return (
      ignoreViewport ||
      (rect.top >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.left >= 0 &&
        rect.right <= window.innerWidth)
    );
  }

  function selectables(ignoreViewport) {
    const layout = activeLayout();
    return layout ? entries(true, ignoreViewport) : [];
  }

  function updateSelectedElementClasses(element) {
    if (element && element.classList) {
      try {
        document
          .querySelectorAll("." + state.className)
          .forEach((e) => e.classList.remove(state.className));
        document
          .querySelectorAll("." + state.parentClassName)
          .forEach((e) => e.classList.remove(state.parentClassName));
        element.classList.add(state.className);
        element.parentNode?.classList?.add(state.parentClassName);
      } catch (error) {
        console.warn('SpatialNavigation: Error updating element classes', error);
      }
    }
  }

  function selected(force, preventScroll, animate) {
    if (
      lastSelected &&
      lastSelected.name === activeLayout().name &&
      isVisible(lastSelected.element, true)
    ) {
      return lastSelected.element;
    }
    const selectablesList = selectables(true);
    let element =
      selectablesList.find((e) => e.classList.contains(state.className)) ||
      selectablesList[0] ||
      null;
    if (!element && force) {
      element = selectablesList[0];
    }
    element && focus(element, preventScroll, animate);
    return element;
  }

  export function focus(element, preventScroll, animate) {
    if (!element) return;
    const layout = activeLayout();
    const isDefault = layout.name === "default";
    if (
      element.classList.contains(state.className) &&
      isDefault &&
      state.selectedIndex == element.tabIndex
    )
      return;
    let emit = true;
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
    lastSelected = { element, name: layout.name };
    element.focus({ preventScroll: true });
    if (!preventScroll) {
      element.scrollIntoViewIfNeeded({
        behavior: animate ? "smooth" : "instant",
        block: "nearest",
        inline: "nearest",
      });
    }
    if (emit) {
      if (isDefault && typeof onFocus === "function") {
        onFocus({ index, element });
      } else if (!isDefault && typeof onXFocus === "function") {
        onXFocus({ index, element });
      }
    }
  }

  export function focusIndex(index) {
    const selectablesList = selectables(true);
    const element = inDefaultLayout()
      ? selectablesList.find((e) => e.tabIndex == index)
      : selectablesList[index];
    if (element) {
      focus(element, false, true);
    }
  }

  export function reset() {
    const currentPath = path;
    const currentLayout = activeLayout().name;
    const isDefault = currentLayout === "default";
    const memory = state.selectionMemory[currentPath]?.[currentLayout];
    if (memory) return memory;
    return {
      selectedIndex: path && isDefault ? 1 : 0,
      scrollTop: 0,
    };
  }

  function activeLayout() {
    const layout = state.layouts.find((layout) => layout.condition()) || {
      selector: "body",
      name: "default",
    };
    if (layout.name === "default") {
      for (const layoutName in state.selectionMemory[""]) {
        if (layoutName === "default" || layoutName === layout.name) continue;
        delete state.selectionMemory[""][layoutName];
      }
    }
    return layout;
  }

  export function inDefaultLayout() {
    return activeLayout().name === "default";
  }

  export function entries(noAsides, ignoreViewport) {
    let elements = [];
    const layout = activeLayout();
    if (!layout) return [];
    let sel = layout.selector;
    if (typeof sel === "function") sel = sel();
    if (typeof sel === "string") {
      elements.push(...selector(sel, ignoreViewport));
    } else if (Array.isArray(sel)) {
      elements.push(
        ...sel
          .map((s) => (typeof s === "string" ? selector(s, ignoreViewport) : s))
          .flat(),
      );
    } else {
      console.error("Bad layer selector");
    }
    elements = elements.filter(
      (e) => !e.className?.includes("menu-not-navigable"),
    );
    if (layout.default && noAsides) {
      const rgx = new RegExp("^svelte-virtual-grid-", "i");
      elements = elements.filter((e) => e.parentNode.tagName.match(rgx));
    }
    return elements;
  }

  export function addLayout(layout) {
    state.layouts = [...state.layouts, layout];
  }

  function angle(c, e) {
    let theta =
      (Math.atan2(e.top - c.top, e.left - c.left) * 180) / Math.PI + 90;
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
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }

  function distance(c, e) {
    if (!c || !e) return Infinity;

    // Check if rectangles overlap (distance = 0)
    const isOverlap =
      c.left <= e.right &&
      c.right >= e.left &&
      c.top <= e.bottom &&
      c.bottom >= e.top;

    if (isOverlap) return 0;

    // Calculate the minimum distance between the closest edges
    const dx =
      c.left > e.right
        ? c.left - e.right // c is to the right of e
        : e.left > c.right
          ? e.left - c.right // e is to the right of c
          : 0; // rects overlap horizontally

    const dy =
      c.top > e.bottom
        ? c.top - e.bottom // c is below e
        : e.top > c.bottom
          ? e.top - c.bottom // e is below c
          : 0; // rects overlap vertically

    // If one of dx or dy is 0, the rectangles are aligned along one axis,
    // so return the distance along the other axis
    if (dx === 0) return dy;
    if (dy === 0) return dx;

    // If both dx and dy are non-zero, the rectangles are diagonally separated,
    // so calculate the Euclidean distance between the closest corners
    return Math.hypot(dx, dy);
  }

  function hasOverlap(currentCoords, itemCoords, direction) {
    if (direction === "up" || direction === "down") {
      return itemCoords.left < currentCoords.right && itemCoords.right > currentCoords.left;
    } else if (direction === "left" || direction === "right") {
      return itemCoords.top < currentCoords.bottom && itemCoords.bottom > currentCoords.top;
    }
    return false;
  }

  function findNextElement(direction, notCyclic = false) {
    let closer, closerScore;
    let hasOverlappingElements = false; // Track if any elements have overlap
    const angleFactor = 2;
    const items = entries(true, true);
    const current = selected();
    const layout = activeLayout();
    if (!current) {
      if (debug) console.log("DEBUG: No current element selected, returning default selection");
      return selected(true, false, true);
    }

    let angleDest;
    switch (direction) {
      case "up":
        angleDest = 0;
        break;
      case "right":
        angleDest = 90;
        break;
      case "down":
        angleDest = 180;
        break;
      case "left":
        angleDest = 270;
        break;
    }

    const currentCoords = coords(current);
    if (!currentCoords) {
      if (debug) console.log("DEBUG: Current element has no valid coordinates");
      return null;
    }

    const normalizeFactor = Math.max(window.innerWidth, window.innerHeight) / 100;
    if (debug) {
      console.log(
        "DEBUG: Starting navigation from",
        current.title || current.id || current.className || "unnamed element",
        {
          direction,
          currentCoords: {
            left: currentCoords.left,
            right: currentCoords.right,
            top: currentCoords.top,
            bottom: currentCoords.bottom,
            width: currentCoords.width,
            height: currentCoords.height,
          },
          totalItems: items.length,
          normalizeFactor,
        }
      );
    }

    items.forEach((item) => {
      if (item !== current) {
        const itemCoords = coords(item);
        if (itemCoords) {
          const angleVal = angle(currentCoords, itemCoords);
          const angleDiffVal = angleDiff(angleVal, angleDest);
          const isVisibleItem = isVisible(item, true);
          if (debug) {
            console.log(
              "DEBUG: Evaluating item",
              item.title || item.id || item.className || "unnamed item",
              {
                itemCoords: {
                  left: itemCoords.left,
                  right: itemCoords.right,
                  top: itemCoords.top,
                  bottom: itemCoords.bottom,
                  width: itemCoords.width,
                  height: itemCoords.height,
                },
                angleVal,
                angleDiffVal,
                isVisible: isVisibleItem,
              }
            );
          }

          const angleThreshold = hasOverlap(currentCoords, itemCoords, direction) ? 90 : 45;
          if (angleDiffVal < angleThreshold && isVisibleItem) {
            const dist = distance(currentCoords, itemCoords);
            const normalizedDist = dist / normalizeFactor;
            let adjustedBy = "";
            let score = normalizedDist + angleFactor * angleDiffVal;
            const overlap = hasOverlap(currentCoords, itemCoords, direction);
            if (overlap) {
              hasOverlappingElements = true;
              const bonus = Math.max(currentCoords.width, currentCoords.height);
              score -= bonus;
              adjustedBy = `bonus (-${bonus})`;
              if (debug) console.log(`DEBUG: Overlap detected, applying bonus (-${bonus})`);
            } else {
              const penalty = Math.max(window.innerWidth, window.innerHeight) / 2;
              score += penalty;
              adjustedBy = `penalty (+${penalty})`;
              if (debug) console.log(`DEBUG: No overlap, applying penalty (+${penalty})`);
            }

            if (debug) {
              console.log(
                "DEBUG: Score for item",
                item.title || item.id || item.className || "unnamed item",
                {
                  score,
                  dist,
                  normalizedDist,
                  angleDiffVal,
                  angleThreshold,
                  adjustedBy,
                }
              );
            }

            if (!closer || score < closerScore) {
              closer = item;
              closerScore = score;
              if (debug) {
                console.log(
                  "DEBUG: New closest item",
                  item.title || item.id || item.className || "unnamed item",
                  { closerScore }
                );
              }
            }
          } else {
            if (debug) {
              console.log(
                "DEBUG: Item skipped",
                item.title || item.id || item.className || "unnamed item",
                {
                  reason:
                    angleDiffVal >= angleThreshold
                      ? `Angle difference too large (>= ${angleThreshold}°)`
                      : "Item not visible",
                  angleDiffVal,
                  angleThreshold,
                  isVisible: isVisibleItem,
                }
              );
            }
          }
        } else {
          if (debug) {
            console.log(
              "DEBUG: Item has no valid coordinates",
              item.title || item.id || item.className || "unnamed item"
            );
          }
        }
      }
    });

    if (hasOverlappingElements && closer && !hasOverlap(currentCoords, coords(closer), direction)) {
      if (debug) console.log("DEBUG: Discarding non-overlapping closer because overlapping elements exist");
      closer = null;
      closerScore = null;
      items.forEach((item) => {
        if (item !== current) {
          const itemCoords = coords(item);
          if (itemCoords && hasOverlap(currentCoords, itemCoords, direction)) {
            const angleVal = angle(currentCoords, itemCoords);
            const angleDiffVal = angleDiff(angleVal, angleDest);
            const isVisibleItem = isVisible(item, true);
            if (angleDiffVal < 90 && isVisibleItem) {
              const dist = distance(currentCoords, itemCoords);
              const normalizedDist = dist / normalizeFactor;
              const bonus = Math.max(currentCoords.width, currentCoords.height);
              let score = normalizedDist + angleFactor * angleDiffVal - bonus;
              if (debug) {
                console.log(
                  "DEBUG: Re-evaluating overlapping item",
                  item.title || item.id || item.className || "unnamed item",
                  { score, dist, normalizedDist, angleDiffVal }
                );
              }
              if (!closer || score < closerScore) {
                closer = item;
                closerScore = score;
                if (debug) {
                  console.log(
                    "DEBUG: New closest overlapping item",
                    item.title || item.id || item.className || "unnamed item",
                    { closerScore }
                  );
                }
              }
            }
          }
        }
      });
    }

    if (!closer && typeof layout.overScrollAction === "function" && !notCyclic) {
      if (debug) console.log("DEBUG: No closer element found, triggering overScrollAction", { direction, current });
      const result = layout.overScrollAction(direction, current);
      if (result === true) {
        if (debug) console.log("DEBUG: overScrollAction consumed", { direction, current });
        return null;
      }
    }

    if (debug && closer) {
      console.log(
        "DEBUG: Final selected element",
        closer.title || closer.id || closer.className || "unnamed element",
        { finalScore: closerScore }
      );
    } else if (debug && !closer) {
      console.log("DEBUG: No element selected for navigation");
    }

    return closer;
  }

  export function navigate(direction, notCyclic = false) {
    const closer = findNextElement(direction, notCyclic);
    if (closer) {
      if (debug) console.log("Navigating ", direction, closer);
      onNavigate(closer);
      focus(closer, false, true);
    }
  }
</script>
