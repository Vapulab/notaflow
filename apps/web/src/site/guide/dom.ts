type Child = Node | string | null | false;

// A small builder for the guide scripts: text goes in as text nodes, never as HTML.
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children) if (child !== null && child !== false) element.append(child);
  return element;
}

// The text an error code gets on the public pages.
export const TOO_MANY = 'Muitas tentativas. Tente de novo mais tarde.';
