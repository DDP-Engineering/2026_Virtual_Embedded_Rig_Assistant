// The package's own typings pull the browser DOM library into this Node-only workspace, so core
// imports the parser module directly with just the structure office extraction reads.
declare module "@xmldom/xmldom/lib/dom-parser.js" {
  export interface XmlAttr {
    name: string;
    localName: string | null;
    namespaceURI: string | null;
    value: string;
  }
  export interface XmlNode {
    nodeType: number;
    firstChild: XmlNode | null;
    nextSibling: XmlNode | null;
    textContent: string | null;
  }
  export interface XmlElement extends XmlNode {
    localName: string;
    namespaceURI: string | null;
    attributes: { length: number; item(index: number): XmlAttr | null };
  }
  export interface XmlDocument {
    documentElement: XmlElement | null;
  }
  export class DOMParser {
    constructor(options?: {
      errorHandler?: {
        warning?: (message: string) => void;
        error?: (message: string) => void;
        fatalError?: (message: string) => void;
      };
    });
    parseFromString(source: string, mimeType: string): XmlDocument;
  }
}
