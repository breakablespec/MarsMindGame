// Minimal DOM builder.

type Leaf = Node | string | number | null | undefined | false;
type Child = Leaf | Child[];
type Attrs = Record<string, string | number | boolean | ((e: any) => void) | undefined>;

export function h(tag: string, attrs: Attrs | null = null, ...kids: Child[]): HTMLElement {
  const el = document.createElement(tag);
  if (attrs)
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  for (const kid of (kids as unknown[]).flat(Infinity) as Leaf[]) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export function $(sel: string): HTMLElement {
  return document.querySelector(sel) as HTMLElement;
}

export function img(src: string, cls = 'ico', alt = ''): HTMLElement {
  return h('img', { src, class: cls, alt, draggable: 'false' });
}

/** replaceChildren that skips null/false entries. */
export function fill(el: HTMLElement, ...kids: (Node | string | null | undefined | false)[]) {
  el.replaceChildren(...(kids.filter((k) => k !== null && k !== undefined && k !== false) as (Node | string)[]));
}
