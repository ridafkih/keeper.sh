import { EwsError } from "./error";
import { ntlmRequest } from "./ntlm";
import { setTimeout as delay } from "node:timers/promises";
import { createSafeFetch } from "../../utils/safe-fetch";
import { parseEwsConfig } from "./config";
import type { EwsConfig, EwsRuntimeOptions } from "./config";
import {
  child,
  children,
  descendants,
  escapeXml as x,
  parseXml,
  textOf,
} from "./xml";
import type { XmlNode } from "./xml";

const MESSAGES_NS =
  "http://schemas.microsoft.com/exchange/services/2006/messages";
const TYPES_NS = "http://schemas.microsoft.com/exchange/services/2006/types";
const MARKER =
  '<t:ExtendedFieldURI DistinguishedPropertySetId="PublicStrings" PropertyName="KeeperSyncUid" PropertyType="String"/>';
const markerXml = (uid: string): string =>
  `<t:ExtendedProperty>${MARKER}<t:Value>${x(uid)}</t:Value></t:ExtendedProperty>`;
const markerOf = (node: XmlNode): string => {
  for (const property of children(node, "ExtendedProperty")) {
    const field = child(property, "ExtendedFieldURI");
    if (
      field?.attributes.PropertyName === "KeeperSyncUid" &&
      field.attributes.PropertyType === "String"
    ) {
      return textOf(property, "Value");
    }
  }
  return "";
};
interface EwsCalendar {
  id: string;
  name: string;
  canRead: boolean;
  canWrite: boolean;
}

class EwsClient {
  readonly config: EwsConfig;
  private readonly fetch: NonNullable<EwsRuntimeOptions["fetch"]>;
  private token = "";
  private expiresAt = 0;
  private requests = 0;
  private lastRequest = 0;
  private readonly options: EwsRuntimeOptions;
  constructor(config: EwsConfig, options: EwsRuntimeOptions = {}) {
    this.options = options;
    this.config = parseEwsConfig(config);
    this.fetch =
      options.fetch ??
      createSafeFetch({
        blockPrivateResolution: true,
        ...options.safeFetchOptions,
        timeoutMs: this.config.timeoutMs ?? 30_000,
      });
  }
  private async readBody(response: Response): Promise<string> {
    const max = this.config.maxResponseBytes ?? 8_388_608;
    const reader = response.body?.getReader();
    if (!reader) {
      throw new EwsError("EmptyResponse");
    }
    const decoder = new TextDecoder();
    let result = "";
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.length;
        if (size > max) {
          throw new EwsError("ResponseLimitExceeded");
        }
        result += decoder.decode(value, { stream: true });
      }
      return result + decoder.decode();
    } finally {
      await reader.cancel();
    }
  }
  private async authorization(): Promise<string> {
    const { auth } = this.config;
    if (auth.type === "ntlm") {
      throw new EwsError("UnexpectedNtlmAuthorization");
    }
    if (auth.type === "oauth2-user") {
      if (!this.options.getAccessToken) {
        throw new EwsError("UserTokenStoreRequired");
      }
      return `Bearer ${await this.options.getAccessToken(this.config)}`;
    }
    if (!this.token || Date.now() >= this.expiresAt) {
      const response = await this.fetch(auth.tokenUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: auth.clientId,
          client_secret: auth.clientSecret,
          scope: auth.scope,
        }),
        signal: this.options.safeFetchOptions?.signal,
      });
      if (!response.ok) {
        throw new EwsError("OAuthTokenRejected", response.status);
      }
      const data = JSON.parse(await this.readBody(response)) as Record<
        string,
        unknown
      >;
      if (
        typeof data.access_token !== "string" ||
        !data.access_token ||
        /[\r\n]/u.test(data.access_token) ||
        typeof data.expires_in !== "number" ||
        data.expires_in <= 0
      ) {
        throw new EwsError("InvalidOAuthResponse");
      }
      this.token = data.access_token;
      this.expiresAt = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    }
    return `Bearer ${this.token}`;
  }
  private async send(headers: Record<string, string>, body: string): Promise<Response> {
    if (this.config.auth.type === "ntlm") {
      return ntlmRequest(this.config, headers, body, this.options);
    }
    headers.Authorization = await this.authorization();
    return this.fetch(this.config.serverUrl, {
      method: "POST", redirect: "manual", headers, body,
      signal: this.options.safeFetchOptions?.signal,
    });
  }
  async request(
    operation: string,
    content: string,
    attributes = "",
  ): Promise<XmlNode> {
    this.requests += 1;
    if (this.requests > (this.config.maxRequests ?? 1000)) {
      throw new EwsError("RequestBudgetExceeded");
    }
    await this.options.onBeforeRequest?.();
    const wait =
      (this.config.minimumIntervalMs ?? 100) - (Date.now() - this.lastRequest);
    if (wait > 0) {
      await delay(wait, null, {
        signal: this.options.safeFetchOptions?.signal,
      });
    }
    this.lastRequest = Date.now();
    const headers: Record<string, string> = {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: `${MESSAGES_NS}/${operation}`,
    };
    if (this.config.anchorMailbox) {
      headers["X-AnchorMailbox"] = this.config.anchorMailbox;
    }
    let impersonation = "";
    if (this.config.impersonate) {
      impersonation = `<t:ExchangeImpersonation><t:ConnectingSID><t:PrimarySmtpAddress>${x(this.config.impersonate)}</t:PrimarySmtpAddress></t:ConnectingSID></t:ExchangeImpersonation>`;
    }
    let attributeText = "";
    if (attributes) {
      attributeText = ` ${attributes}`;
    }
    const body = `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="${MESSAGES_NS}" xmlns:t="${TYPES_NS}"><s:Header><t:RequestServerVersion Version="${this.config.serverVersion ?? "Exchange2013"}"/><t:TimeZoneContext><t:TimeZoneDefinition Id="UTC"/></t:TimeZoneContext>${impersonation}</s:Header><s:Body><m:${operation}${attributeText}>${content}</m:${operation}></s:Body></s:Envelope>`;
    const response = await this.send(headers, body);
    if (!response.ok) {
      this.token = "";
      throw new EwsError("HttpError", response.status);
    }
    const xml = parseXml(await this.readBody(response));
    if (descendants(xml, "Fault").length > 0) {
      throw new EwsError("SoapFault");
    }
    const messages = descendants(xml, `${operation}ResponseMessage`);
    if (messages.length === 0) {
      throw new EwsError("MissingResponseMessage");
    }
    for (const message of messages) {
      const code = textOf(message, "ResponseCode");
      if (
        message.attributes.ResponseClass !== "Success" ||
        code !== "NoError"
      ) {
        let safeCode = "InvalidResponseCode";
        if (/^[A-Za-z0-9]+$/u.test(code)) {
          safeCode = code;
        }
        throw new EwsError(safeCode);
      }
    }
    return xml;
  }
  static folder(id: string): string {
    if (!id) {
      throw new EwsError("MissingCalendarId");
    }
    return `<t:FolderId Id="${x(id)}"/>`;
  }
  private distinguished(id: string): string {
    let mailbox = "";
    if (this.config.mailbox) {
      mailbox = `<t:Mailbox><t:EmailAddress>${x(this.config.mailbox)}</t:EmailAddress></t:Mailbox>`;
    }
    return `<t:DistinguishedFolderId Id="${id}">${mailbox}</t:DistinguishedFolderId>`;
  }
  async discoverCalendars(): Promise<EwsCalendar[]> {
    const result: EwsCalendar[] = [];
    let offset = 0;
    while (true) {
      const xml = await this.request(
        "FindFolder",
        `<m:FolderShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="folder:EffectiveRights"/></t:AdditionalProperties></m:FolderShape><m:IndexedPageFolderView MaxEntriesReturned="${this.config.pageSize ?? 100}" Offset="${offset}" BasePoint="Beginning"/><m:ParentFolderIds>${this.distinguished("msgfolderroot")}</m:ParentFolderIds>`,
        'Traversal="Deep"',
      );
      for (const folder of descendants(xml, "CalendarFolder")) {
        const id = child(folder, "FolderId")?.attributes.Id;
        const rights = child(folder, "EffectiveRights");
        if (!id || !rights) {
          throw new EwsError("IncompleteFolder");
        }
        result.push({
          id,
          name: textOf(folder, "DisplayName"),
          canRead: textOf(rights, "Read") === "true",
          canWrite:
            textOf(rights, "CreateContents") === "true" &&
            textOf(rights, "Modify") === "true" &&
            textOf(rights, "Delete") === "true",
        });
      }
      const [root] = descendants(xml, "RootFolder");
      if (root?.attributes.IncludesLastItemInRange === "true") {
        return result;
      }
      const next = Number(root?.attributes.IndexedPagingOffset);
      if (!Number.isInteger(next) || next <= offset) {
        throw new EwsError("IncompleteFolderListing");
      }
      offset = next;
    }
  }
  async getItem(id: string): Promise<XmlNode> {
    const xml = await this.request(
      "GetItem",
      `<m:ItemShape><t:BaseShape>AllProperties</t:BaseShape><t:BodyType>HTML</t:BodyType><t:AdditionalProperties>${MARKER}<t:FieldURI FieldURI="calendar:StartTimeZone"/><t:FieldURI FieldURI="calendar:EndTimeZone"/></t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${x(id)}"/></m:ItemIds>`,
    );
    const [item] = descendants(xml, "CalendarItem");
    if (!item || child(item, "ItemId")?.attributes.Id !== id) {
      throw new EwsError("IncompleteCalendarItem");
    }
    return item;
  }
  async listItems(
    folderId: string,
    start: Date,
    end: Date,
  ): Promise<XmlNode[]> {
    if (
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end <= start
    ) {
      throw new EwsError("InvalidTimeWindow");
    }
    const ids = new Set<string>();
    const scan = async (from: Date, to: Date): Promise<void> => {
      const split = async (): Promise<void> => {
        const middle = Math.floor((from.getTime() + to.getTime()) / 2);
        if (middle <= from.getTime() || to.getTime() - from.getTime() < 1000) {
          throw new EwsError("CalendarViewOverflow");
        }
        await scan(from, new Date(middle));
        await scan(new Date(middle), to);
      };
      let xml: XmlNode | null = null;
      try {
        xml = await this.request(
          "FindItem",
          `<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:CalendarView MaxEntriesReturned="${this.config.pageSize ?? 100}" StartDate="${from.toISOString()}" EndDate="${to.toISOString()}"/><m:ParentFolderIds>${EwsClient.folder(folderId)}</m:ParentFolderIds>`,
          'Traversal="Shallow"',
        );
      } catch (error) {
        if (
          !(error instanceof EwsError) ||
          error.code !== "ErrorCalendarViewRangeTooBig"
        )
          {throw error;}
        await split();
        return;
      }
      const [root] = descendants(xml, "RootFolder");
      if (!root) {
        throw new EwsError("IncompleteCalendarListing");
      }
      if (root.attributes.IncludesLastItemInRange !== "true") {
        await split();
        return;
      }
      for (const item of descendants(root, "CalendarItem")) {
        const id = child(item, "ItemId")?.attributes.Id;
        if (!id) {
          throw new EwsError("MissingItemId");
        }
        ids.add(id);
      }
    };
    // Use one-year requests to stay below the EWS two-year CalendarView limit.
    // Preserve complete snapshot coverage, including leap years.
    const maximumWindowMs = 365 * 24 * 60 * 60 * 1000;
    for (let cursor = start.getTime(); cursor < end.getTime(); ) {
      const next = Math.min(cursor + maximumWindowMs, end.getTime());
      await scan(new Date(cursor), new Date(next));
      cursor = next;
    }
    const items: XmlNode[] = [];
    for (const id of ids) {
      items.push(await this.getItem(id));
    }
    return items;
  }
  async findMirror(folderId: string, uid: string): Promise<XmlNode | null> {
    const xml = await this.request(
      "FindItem",
      `<m:ItemShape><t:BaseShape>IdOnly</t:BaseShape></m:ItemShape><m:Restriction><t:IsEqualTo>${MARKER}<t:FieldURIOrConstant><t:Constant Value="${x(uid)}"/></t:FieldURIOrConstant></t:IsEqualTo></m:Restriction><m:ParentFolderIds>${EwsClient.folder(folderId)}</m:ParentFolderIds>`,
      'Traversal="Shallow"',
    );
    const [root] = descendants(xml, "RootFolder");
    if (root?.attributes.IncludesLastItemInRange !== "true") {
      throw new EwsError("IncompleteMirrorLookup");
    }
    const items = descendants(root, "CalendarItem");
    if (items.length > 1) {
      throw new EwsError("DuplicateMirror");
    }
    const [item] = items;
    if (!item) {
      return null;
    }
    const id = child(item, "ItemId")?.attributes.Id;
    if (!id) {
      throw new EwsError("MissingItemId");
    }
    return this.getItem(id);
  }
}

export { MARKER, markerXml, markerOf, EwsError, EwsClient };
export type { EwsCalendar };
