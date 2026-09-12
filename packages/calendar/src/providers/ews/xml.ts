import { XMLValidator } from "fast-xml-parser";
import { Parser } from "htmlparser2";

interface XmlNode {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
  text: string;
}
const escapeXml = (value: string): string =>
  value.replaceAll(/[<>&"']/gu, (char) => {
    const entities: Record<string, string> = {
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;",
      '"': "&quot;",
      "'": "&apos;",
    };
    return entities[char] ?? char;
  });
const children = (node: XmlNode, name: string): XmlNode[] =>
  node.children.filter((child) => child.name === name);
const child = (node: XmlNode, name: string): XmlNode | undefined =>
  children(node, name)[0];
const descendants = (node: XmlNode, name: string): XmlNode[] =>
  node.children.flatMap((item) => {
    const nested = descendants(item, name);
    if (item.name === name) {
      return [item, ...nested];
    }
    return nested;
  });
const textOf = (node: XmlNode, name: string): string =>
  child(node, name)?.text ?? "";

const parseXml = (xml: string): XmlNode => {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new Error("EWS XML declarations are not permitted");
  }
  if (XMLValidator.validate(xml) !== true) {
    throw new Error("Malformed EWS XML");
  }
  const root: XmlNode = {
    name: "root",
    attributes: {},
    children: [],
    text: "",
  };
  const stack = [root];
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (stack.length > 100) {
          throw new Error("EWS XML nesting limit exceeded");
        }
        const node: XmlNode = {
          name: name.split(":").at(-1) ?? name,
          attributes,
          children: [],
          text: "",
        };
        stack.at(-1)?.children.push(node);
        stack.push(node);
      },
      ontext(text) {
        const node = stack.at(-1);
        if (node) {
          node.text += text;
        }
      },
      onclosetag() {
        stack.pop();
      },
    },
    { xmlMode: true, decodeEntities: true },
  );
  parser.end(xml);
  if (
    stack.length !== 1 ||
    root.children.length !== 1 ||
    root.children[0]?.name !== "Envelope"
  ) {
    throw new Error("Invalid EWS SOAP envelope");
  }
  return root;
};

export { escapeXml, children, child, descendants, textOf, parseXml };
export type { XmlNode };
