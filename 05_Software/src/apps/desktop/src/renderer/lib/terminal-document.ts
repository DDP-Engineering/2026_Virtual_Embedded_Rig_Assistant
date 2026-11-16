/** Route xterm's generated CSS through CSSOM while retaining the application's strict style CSP. */
export function terminalDocument(source: Document): {
  document: Document;
  open(operation: () => void): void;
  dispose(): void;
} {
  const sheets = new Set<CSSStyleSheet>();
  const create = source.createElement.bind(source);
  const createElement = (name: string, options?: ElementCreationOptions) => {
    const element = create(name.toLowerCase() === "style" ? "span" : name, options);
    const attribute = element.setAttribute.bind(element);
    element.setAttribute = (key, value) => {
      if (key.toLowerCase() === "style") element.style.cssText = value;
      else attribute(key, value);
    };
    if (name.toLowerCase() === "style") {
      element.hidden = true;
      const sheet = new CSSStyleSheet();
      sheets.add(sheet);
      source.adoptedStyleSheets = [...source.adoptedStyleSheets, sheet];
      Object.defineProperty(element, "textContent", {
        get: () => "",
        set: (value: string | null) => sheet.replaceSync(value ?? ""),
      });
    }
    return element;
  };
  const document = new Proxy(source, {
    get(target, key) {
      if (key === "createElement") return createElement;
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return {
    document,
    open(operation) {
      // xterm 6's viewport uses the real document during synchronous open despite documentOverride.
      const original = source.createElement;
      source.createElement = createElement as Document["createElement"];
      try {
        operation();
      } finally {
        source.createElement = original;
      }
    },
    dispose: () => {
      source.adoptedStyleSheets = source.adoptedStyleSheets.filter((sheet) => !sheets.has(sheet));
      sheets.clear();
    },
  };
}
