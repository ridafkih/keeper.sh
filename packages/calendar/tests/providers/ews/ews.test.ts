import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { describe, expect, it } from "vitest";
import { EwsClient, markerXml } from "../../../src/providers/ews/client";
import { parseEwsConfig } from "../../../src/providers/ews/config";
import type { EwsConfig } from "../../../src/providers/ews/config";
import {
  parseXml,
  descendants,
  escapeXml,
} from "../../../src/providers/ews/xml";
import {
  createEwsSyncProvider,
  createEwsSourceFetcher,
} from "../../../src/providers/ews/provider";
import { parseEwsEvent, eventXml } from "../../../src/providers/ews/events";
import { generateDeterministicEventUid } from "../../../src/core/events/identity";
import { createSourceIngestionPlan } from "../../../src/core/sync/sync-range";
import type { MaterializedSyncableEvent } from "../../../src/core/types";

const config = {
  serverUrl: "https://calendar.example.test/custom/service",
  auth: {
    type: "oauth2-client-credentials",
    tokenUrl: "https://identity.example.test/token",
    clientId: "application",
    clientSecret: "test-only-secret",
    scope: "test-scope",
  },
  minimumIntervalMs: 0,
} satisfies EwsConfig;
const source =
  '<t:CalendarItem><t:ItemId Id="item-1" ChangeKey="key-1"/><t:ParentFolderId Id="folder-1"/><t:UID>external-uid</t:UID><t:Subject>Planning &amp; review</t:Subject><t:Body>Join https://video.example.test/room</t:Body><t:Start>2026-09-10T10:00:00Z</t:Start><t:End>2026-09-10T11:00:00Z</t:End><t:IsAllDayEvent>false</t:IsAllDayEvent><t:LegacyFreeBusyStatus>Busy</t:LegacyFreeBusyStatus><t:IsMeeting>false</t:IsMeeting><t:CalendarItemType>Single</t:CalendarItemType><t:StartTimeZone Id="UTC"/></t:CalendarItem>';
const event: MaterializedSyncableEvent = {
  id: "logical-1",
  sourceEventUid: "original",
  startTime: new Date("2026-09-10T10:00:00Z"),
  endTime: new Date("2026-09-10T11:00:00Z"),
  summary: "Planning <review>",
  description: "Join https://video.example.test/room",
  calendarId: "local",
  calendarName: null,
  calendarUrl: null,
};
const uid = generateDeterministicEventUid(event.id);
const mirror = source.replace(
  "</t:CalendarItem>",
  `${markerXml(uid)}</t:CalendarItem>`,
);
const soap = (operation: string, content: string, code = "NoError") => {
  let responseClass = "Error";
  if (code === "NoError") {
    responseClass = "Success";
  }
  return `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body><m:${operation}Response><m:ResponseMessages><m:${operation}ResponseMessage ResponseClass="${responseClass}"><m:ResponseCode>${code}</m:ResponseCode>${content}</m:${operation}ResponseMessage></m:ResponseMessages></m:${operation}Response></s:Body></s:Envelope>`;
};
const xmlItem = (xml = source) => {
  const [item] = descendants(
    parseXml(soap("GetItem", `<m:Items>${xml}</m:Items>`)),
    "CalendarItem",
  );
  if (!item) {
    throw new Error("Missing test item");
  }
  return item;
};
const root = (items = "", complete = true) =>
  `<m:RootFolder IncludesLastItemInRange="${complete}"><t:Items>${items}</t:Items></m:RootFolder>`;
const itemId = '<t:CalendarItem><t:ItemId Id="item-1"/></t:CalendarItem>';
const mock = (responses: (string | Response)[], automaticToken = true) => {
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls,
    fetch: (url: string, init?: RequestInit): Promise<Response> => {
      if (automaticToken && url === config.auth.tokenUrl) {
        return Promise.resolve(
          Response.json({ access_token: "test-token", expires_in: 3600 }),
        );
      }
      calls.push({ url, init });
      const response = responses.shift();
      if (!response) {
        throw new Error("Unexpected request");
      }
      if (response instanceof Response) {
        return Promise.resolve(response);
      }
      return Promise.resolve(
        new Response(response, { headers: { "Content-Type": "text/xml" } }),
      );
    },
  };
};

describe("configurable EWS transport", () => {
  it("accepts arbitrary endpoints and account identifiers without provider defaults", async () => {
    const transport = mock([soap("FindItem", root())]);
    const client = new EwsClient(
      {
        ...config,
        serverUrl: "https://another.example.test/soap",
        mailbox: "person@example.test",
        impersonate: "delegate@example.test",
        anchorMailbox: "route@example.test",
        serverVersion: "Exchange2010_SP2",
      },
      transport,
    );
    await client.findMirror("folder & id", uid);
    expect(transport.calls[0]?.url).toBe("https://another.example.test/soap");
    expect(transport.calls[0]?.init?.redirect).toBe("manual");
    const body = String(transport.calls[0]?.init?.body);
    expect(body).toContain('Version="Exchange2010_SP2"');
    expect(body).toContain("delegate@example.test");
    expect(body).toContain("folder &amp; id");
    expect(transport.calls[0]?.init?.headers).toMatchObject({
      "X-AnchorMailbox": "route@example.test",
    });
  });
  it.each([
    "http://example.test/ews",
    "https://user:pass@example.test/ews",
    "file:///tmp/ews",
    "https://example.test/#secret",
  ])("rejects unsafe endpoint %s", (serverUrl) => {
    expect(() => parseEwsConfig({ ...config, serverUrl })).toThrow();
  });
  it("rejects unsupported authentication and invalid limits", () => {
    expect(() => parseEwsConfig({ ...config, auth: { type: "unsupported" } })).toThrow(
      "Unsupported EWS authentication",
    );
    expect(() => parseEwsConfig({ ...config, pageSize: 0 })).toThrow();
    expect(() =>
      parseEwsConfig({
        ...config,
        auth: { type: "bearer", accessToken: "a\r\nInjected: b" },
      }),
    ).toThrow();
  });
  it.each(["basic", "bearer"])(
    "rejects removed authentication mode %s",
    (type) => {
      expect(() => parseEwsConfig({ ...config, auth: { type } })).toThrow(
        "Unsupported EWS authentication",
      );
    },
  );
  it("obtains and caches OAuth credentials at the configured token endpoint", async () => {
    const transport = mock(
      [
        Response.json({ access_token: "token", expires_in: 3600 }),
        soap("FindItem", root()),
        soap("FindItem", root()),
      ],
      false,
    );
    const client = new EwsClient(
      {
        ...config,
        auth: {
          type: "oauth2-client-credentials",
          tokenUrl: "https://identity.example.test/token",
          clientId: "app",
          clientSecret: "secret",
          scope: "custom-scope",
        },
      },
      transport,
    );
    await client.findMirror("folder-1", uid);
    await client.findMirror("folder-1", uid);
    expect(transport.calls).toHaveLength(3);
    expect(transport.calls[0]?.url).toBe("https://identity.example.test/token");
    expect(String(transport.calls[0]?.init?.body)).toContain(
      "scope=custom-scope",
    );
  });
  it("rejects SOAP errors without echoing server or credential text", async () => {
    const transport = mock([
      soap(
        "FindItem",
        "<m:MessageText>private provider diagnostics</m:MessageText>",
        "ErrorAccessDenied",
      ),
    ]);
    await expect(
      new EwsClient(config, transport).findMirror("folder-1", uid),
    ).rejects.toThrow("EWS request failed (ErrorAccessDenied)");
  });
  it.each([401, 403, 429, 500])("rejects HTTP %s", async (status) => {
    const transport = mock([new Response("secret body", { status })]);
    await expect(
      new EwsClient(config, transport).findMirror("folder-1", uid),
    ).rejects.toMatchObject({ status });
  });
  it("rejects truncated and entity-bearing XML", () => {
    expect(() => parseXml("<s:Envelope><s:Body>")).toThrow();
    expect(() =>
      parseXml(
        '<!DOCTYPE a [<!ENTITY file SYSTEM "file:///private">]><s:Envelope/>',
      ),
    ).toThrow();
  });
  it("bounds response bytes and total requests", async () => {
    await expect(
      new EwsClient(
        { ...config, maxResponseBytes: 1024 },
        mock(["x".repeat(1025)]),
      ).findMirror("folder-1", uid),
    ).rejects.toThrow("ResponseLimitExceeded");
    const client = new EwsClient(
      { ...config, maxRequests: 1 },
      mock([soap("FindItem", root())]),
    );
    await client.findMirror("folder-1", uid);
    await expect(client.findMirror("folder-1", uid)).rejects.toThrow(
      "RequestBudgetExceeded",
    );
  });
});

describe("EWS reading", () => {
  it("discovers paged calendars and effective read/write rights", async () => {
    const folder =
      '<t:CalendarFolder><t:FolderId Id="f1"/><t:DisplayName>Work</t:DisplayName><t:EffectiveRights><t:Read>true</t:Read><t:CreateContents>true</t:CreateContents><t:Modify>true</t:Modify><t:Delete>true</t:Delete></t:EffectiveRights></t:CalendarFolder>';
    const transport = mock([
      soap(
        "FindFolder",
        `<m:RootFolder IncludesLastItemInRange="false" IndexedPagingOffset="1">${folder}</m:RootFolder>`,
      ),
      soap("FindFolder", '<m:RootFolder IncludesLastItemInRange="true"/>'),
    ]);
    expect(await new EwsClient(config, transport).discoverCalendars()).toEqual([
      { id: "f1", name: "Work", canRead: true, canWrite: true },
    ]);
    expect(String(transport.calls[1]?.init?.body)).toContain('Offset="1"');
  });
  it("refuses a partial listing rather than treating it as an empty agenda", async () => {
    const transport = mock([soap("FindItem", root("", false))]);
    await expect(
      new EwsClient(config, transport).listItems(
        "folder-1",
        new Date(0),
        new Date(500),
      ),
    ).rejects.toThrow("CalendarViewOverflow");
  });
  it("splits saturated windows, deduplicates occurrences and hydrates descriptions", async () => {
    const transport = mock([
      soap("FindItem", root("", false)),
      soap("FindItem", root(itemId)),
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${source}</m:Items>`),
    ]);
    const events = await new EwsClient(config, transport).listItems(
      "folder-1",
      new Date("2026-09-10"),
      new Date("2026-09-11"),
    );
    expect(events).toHaveLength(1);
    expect(transport.calls).toHaveLength(4);
    if (!events[0]) {
      throw new Error("Missing event");
    }
    expect(parseEwsEvent(events[0])?.description).toContain(
      "https://video.example.test/room",
    );
  });
  it("covers a multi-year range with contiguous bounded requests and deduplicates boundaries", async () => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("FindItem", root(itemId)),
      soap("FindItem", root(itemId)),
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${source}</m:Items>`),
    ]);
    const start = new Date("2024-01-01");
    const end = new Date("2027-01-01");
    expect(
      await new EwsClient(config, transport).listItems("folder-1", start, end),
    ).toHaveLength(1);
    let cursor = start.getTime();
    for (const call of transport.calls.slice(0, 4)) {
      const body = String(call.init?.body);
      const from = Date.parse(/StartDate="([^"]+)"/u.exec(body)?.[1] ?? "");
      const to = Date.parse(/EndDate="([^"]+)"/u.exec(body)?.[1] ?? "");
      expect(from).toBe(cursor);
      expect(to - from).toBeGreaterThan(0);
      expect(to - from).toBeLessThanOrEqual(365 * 86_400_000);
      cursor = to;
    }
    expect(cursor).toBe(end.getTime());
    expect(transport.calls).toHaveLength(5);
  });
  it("bisects windows when the server reports a stricter range limit", async () => {
    const transport = mock([
      soap("FindItem", "", "ErrorCalendarViewRangeTooBig"),
      soap("FindItem", root(itemId)),
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${source}</m:Items>`),
    ]);
    expect(
      await new EwsClient(config, transport).listItems(
        "folder-1",
        new Date("2026-01-01"),
        new Date("2026-02-01"),
      ),
    ).toHaveLength(1);
    expect(transport.calls).toHaveLength(4);
  });
  it("fails the complete snapshot if a later yearly window fails", async () => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("FindItem", "", "ErrorAccessDenied"),
    ]);
    await expect(
      new EwsClient(config, transport).listItems(
        "folder-1",
        new Date("2024-01-01"),
        new Date("2027-01-01"),
      ),
    ).rejects.toThrow("ErrorAccessDenied");
  });
  it("bounds recursive splitting of permanently rejected windows", async () => {
    const transport = mock([
      soap("FindItem", "", "ErrorCalendarViewRangeTooBig"),
    ]);
    await expect(
      new EwsClient(config, transport).listItems(
        "folder-1",
        new Date(0),
        new Date(500),
      ),
    ).rejects.toThrow("CalendarViewOverflow");
  });
  it("explicitly requests time zones excluded from the AllProperties response shape", async () => {
    const transport = mock([soap("GetItem", `<m:Items>${source}</m:Items>`)]);
    await new EwsClient(config, transport).getItem("item-1");
    expect(String(transport.calls[0]?.init?.body)).toContain('FieldURI="calendar:StartTimeZone"');
    expect(String(transport.calls[0]?.init?.body)).toContain('FieldURI="calendar:EndTimeZone"');
  });
  it("fails on an item disappearing during a full snapshot", async () => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("GetItem", "", "ErrorItemNotFound"),
    ]);
    await expect(
      new EwsClient(config, transport).listItems(
        "folder-1",
        new Date("2026-09-10"),
        new Date("2026-09-11"),
      ),
    ).rejects.toThrow("ErrorItemNotFound");
  });
  it("preserves titles and excludes mirrors and cancellations", () => {
    expect(parseEwsEvent(xmlItem())?.title).toBe("Planning & review");
    expect(parseEwsEvent(xmlItem(mirror))).toBeNull();
    expect(
      parseEwsEvent(
        xmlItem(
          source.replace(
            "<t:UID>",
            "<t:IsCancelled>true</t:IsCancelled><t:UID>",
          ),
        ),
      ),
    ).toBeNull();
  });
  it("distinguishes recurring occurrences and preserves exception identity", () => {
    const recurring = source.replace(
      "<t:CalendarItemType>Single",
      "<t:RecurrenceId>2026-09-01T10:00:00Z</t:RecurrenceId><t:CalendarItemType>Exception",
    );
    expect(parseEwsEvent(xmlItem(recurring))?.uid).toBe(
      "external-uid/2026-09-01T10:00:00.000Z",
    );
  });
  it("normalizes all-day dates from the event timezone", () => {
    const allDay = source
      .replace("2026-09-10T10:00:00Z", "2026-09-09T22:00:00Z")
      .replace("2026-09-10T11:00:00Z", "2026-09-10T22:00:00Z")
      .replace("<t:IsAllDayEvent>false", "<t:IsAllDayEvent>true")
      .replace('Id="UTC"', 'Id="Romance Standard Time"');
    expect(parseEwsEvent(xmlItem(allDay))?.startTime.toISOString()).toBe(
      "2026-09-10T00:00:00.000Z",
    );
  });
  it.each([mirror, source.replace("</t:CalendarItem>", `<t:Categories><t:String>${KEEPER_CATEGORY}</t:String></t:Categories></t:CalendarItem>`)])("excludes EWS and Graph copies from ingestion", async (copy) => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${copy}</m:Items>`),
    ]);
    const plan = createSourceIngestionPlan("1_month", "1_month");
    const result = await createEwsSourceFetcher({
      connection: config,
      calendarId: "folder-1",
      plan,
      ...transport,
    }).fetchEvents();
    expect(result.events).toEqual([]);
    expect(result.selfAuthoredEventCount).toBe(1);
    expect(result.coverage?.window).toEqual(plan.window);
  });
});

describe("EWS mirror writes", () => {
  it("creates a simple appointment with no participants and an ownership marker", async () => {
    const transport = mock([
      soap("FindItem", root()),
      soap(
        "CreateItem",
        '<m:Items><t:CalendarItem><t:ItemId Id="created"/></t:CalendarItem></m:Items>',
      ),
    ]);
    const result = await createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...transport,
    }).pushEvents([event]);
    expect(result[0]).toMatchObject({
      success: true,
      remoteId: uid,
      deleteId: "created",
    });
    const body = String(transport.calls[1]?.init?.body);
    expect(body).toContain('SendMeetingInvitations="SendToNone"');
    expect(body).toContain("KeeperSyncUid");
    expect(body).not.toContain("Attendees");
    expect(body).not.toContain("Organizer");
    expect(body).toContain("Planning &lt;review&gt;");
  });
  it("recovers a previous successful create without duplicating it", async () => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${mirror}</m:Items>`),
      soap(
        "UpdateItem",
        '<m:Items><t:CalendarItem><t:ItemId Id="item-1" ChangeKey="key-2"/></t:CalendarItem></m:Items>',
      ),
    ]);
    const result = await createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...transport,
    }).pushEvents([event]);
    expect(result[0]).toMatchObject({ success: true, conflictResolved: true });
    const body = String(transport.calls[2]?.init?.body);
    expect(body).toContain('ConflictResolution="NeverOverwrite"');
    expect(body).toContain('ChangeKey="key-1"');
  });
  it.each([
    source,
    mirror.replace('Id="folder-1"', 'Id="other-folder"'),
    mirror.replace("<t:IsMeeting>false", "<t:IsMeeting>true"),
  ])("refuses foreign items or meetings", async (item) => {
    const transport = mock([soap("GetItem", `<m:Items>${item}</m:Items>`)]);
    const result = await createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...transport,
    }).deleteEvents(["item-1"]);
    expect(result[0]).toMatchObject({
      success: false,
      errorType: "ForeignItem",
    });
    expect(transport.calls).toHaveLength(1);
  });
  it("moves owned copies to deleted items without cancellation messages", async () => {
    const transport = mock([
      soap("GetItem", `<m:Items>${mirror}</m:Items>`),
      soap("DeleteItem", ""),
    ]);
    expect(
      await createEwsSyncProvider({
        connection: config,
        calendarId: "folder-1",
        ...transport,
      }).deleteEvents(["item-1"]),
    ).toEqual([{ success: true }]);
    expect(String(transport.calls[1]?.init?.body)).toContain(
      'DeleteType="MoveToDeletedItems"',
    );
    expect(String(transport.calls[1]?.init?.body)).toContain(
      'SendMeetingCancellations="SendToNone"',
    );
  });
  it("clears fields on update and supports all-day/private appointments", () => {
    const xml = eventXml(
      {
        ...event,
        description: "",
        location: "",
        isAllDay: true,
        isPrivate: true,
        startTime: new Date("2026-09-10"),
        endTime: new Date("2026-09-11"),
      },
      uid,
    );
    expect(xml).toContain('<t:Body BodyType="Text"></t:Body>');
    expect(xml).toContain("<t:Location></t:Location>");
    expect(xml).toContain("<t:IsAllDayEvent>true</t:IsAllDayEvent>");
    expect(xml).toContain("<t:Sensitivity>Private</t:Sensitivity>");
  });
  it("escapes XML metacharacters", () => {
    expect(escapeXml("<&\"'")).toBe("&lt;&amp;&quot;&apos;");
  });
});

describe("EWS OAuth2 and content regression cases", () => {
  it("renews short-lived OAuth2 tokens before the next request", async () => {
    const transport = mock(
      [
        Response.json({ access_token: "first", expires_in: 1 }),
        soap("FindItem", root()),
        Response.json({ access_token: "second", expires_in: 3600 }),
        soap("FindItem", root()),
      ],
      false,
    );
    const client = new EwsClient(config, transport);
    await client.findMirror("folder-1", uid);
    await client.findMirror("folder-1", uid);
    expect(transport.calls).toHaveLength(4);
    expect(transport.calls[3]?.init?.headers).toMatchObject({
      Authorization: "Bearer second",
    });
  });
  it("does not contact EWS when OAuth2 refuses credentials", async () => {
    const transport = mock(
      [new Response("private token diagnostic", { status: 400 })],
      false,
    );
    await expect(
      new EwsClient(config, transport).findMirror("folder-1", uid),
    ).rejects.toMatchObject({ authRequired: true, code: "OAuthTokenRejected" });
    expect(transport.calls).toHaveLength(1);
  });
  it.each([
    {},
    { access_token: "", expires_in: 3600 },
    { access_token: "valid", expires_in: -1 },
  ])("rejects malformed OAuth2 token responses", async (body) => {
    const transport = mock([Response.json(body)], false);
    await expect(
      new EwsClient(config, transport).findMirror("folder-1", uid),
    ).rejects.toThrow("InvalidOAuthResponse");
  });
  it("preserves URLs hidden behind HTML anchor labels", () => {
    const html =
      '<p>Join <a href="https://meeting.example.test/room?a=1&amp;b=2">the meeting</a></p>';
    const htmlItem = source.replace(
      "<t:Body>Join https://video.example.test/room</t:Body>",
      `<t:Body BodyType="HTML">${escapeXml(html)}</t:Body>`,
    );
    expect(parseEwsEvent(xmlItem(htmlItem))?.description).toContain(
      "https://meeting.example.test/room?a=1&b=2",
    );
  });
  it("updates the same owned copy and clears a removed description", async () => {
    const transport = mock([
      soap("GetItem", `<m:Items>${mirror}</m:Items>`),
      soap(
        "UpdateItem",
        '<m:Items><t:CalendarItem><t:ItemId Id="item-1" ChangeKey="key-2"/></t:CalendarItem></m:Items>',
      ),
    ]);
    const provider = createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...transport,
    });
    expect(
      await provider.updateEvents?.([
        {
          deleteId: "item-1",
          event: { ...event, description: "", location: "" },
        },
      ]),
    ).toMatchObject([{ success: true, deleteId: "item-1" }]);
    expect(String(transport.calls[1]?.init?.body)).toContain(
      '<t:Body BodyType="Text"></t:Body>',
    );
  });
  it("normalizes unsupported availability before hashing and reconciliation", () => {
    const provider = createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...mock([]),
    });
    expect(
      provider.normalizeEvent?.({
        ...event,
        availability: "workingElsewhere",
        startTimeZone: "Europe/Paris",
      }),
    ).toMatchObject({ availability: "busy", startTimeZone: "UTC" });
  });
  it("rejects duplicate mirrors instead of choosing an arbitrary event", async () => {
    const transport = mock([soap("FindItem", root(itemId + itemId))]);
    await expect(
      new EwsClient(config, transport).findMirror("folder-1", uid),
    ).rejects.toThrow("DuplicateMirror");
  });
  it("returns owned remote events with editable content for reconciliation", async () => {
    const transport = mock([
      soap("FindItem", root(itemId)),
      soap("GetItem", `<m:Items>${mirror}</m:Items>`),
    ]);
    const provider = createEwsSyncProvider({
      connection: config,
      calendarId: "folder-1",
      ...transport,
    });
    expect(
      await provider.listRemoteEvents({
        timeMin: new Date("2026-09-10"),
        timeMax: new Date("2026-09-11"),
      }),
    ).toMatchObject([
      {
        uid,
        deleteId: "item-1",
        isKeeperEvent: true,
        editableContent: { summary: "Planning & review" },
      },
    ]);
  });
});
