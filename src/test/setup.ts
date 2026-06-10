import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

const fallbackRect = {
  bottom: 0,
  height: 0,
  left: 0,
  right: 0,
  top: 0,
  width: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

function createRectList(): DOMRectList {
  return {
    0: fallbackRect,
    [Symbol.iterator]: function* () {
      yield fallbackRect;
    },
    item: (index: number) => (index === 0 ? fallbackRect : null),
    length: 1,
  } as unknown as DOMRectList;
}

document.elementFromPoint ??= () => document.body;

Element.prototype.getBoundingClientRect ??= () => fallbackRect;
Element.prototype.getClientRects ??= createRectList;
Range.prototype.getBoundingClientRect ??= () => fallbackRect;
Range.prototype.getClientRects ??= createRectList;
