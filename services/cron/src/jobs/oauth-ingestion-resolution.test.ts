import { describe, expect, test } from "bun:test";
import type { IngestionFetchEventsResult, OAuthRefreshResult, RedisRateLimiter } from "@keeper.sh/calendar";
import {
  OAuthIngestionResolutionStatus,
  resolveOAuthIngestionResolution,
  type OAuthIngestionResolutionDependencies,
} from "../lib/oauth-ingestion-resolution";

const createDependencies = (): OAuthIngestionResolutionDependencies => {
  const googleRateLimiter = {} as RedisRateLimiter;
  const outlookFetcher = {
    fetchEvents: (): Promise<IngestionFetchEventsResult> =>
      Promise.resolve({ events: [] }),
  };

  return {
    createGoogleFetcher: () => ({
      fetchEvents: (): Promise<IngestionFetchEventsResult> =>
        Promise.resolve({ events: [] }),
    }),
    createGoogleRateLimiter: () => googleRateLimiter,
    createGoogleTokenRefresher: () =>
      (): Promise<OAuthRefreshResult> => Promise.resolve({
        access_token: "google-access-token",
        expires_in: 3600,
        refresh_token: "google-refresh-token",
      }),
    createOutlookFetcher: () => outlookFetcher,
    createOutlookTokenRefresher: () =>
      (): Promise<OAuthRefreshResult> => Promise.resolve({
        access_token: "outlook-access-token",
        expires_in: 3600,
        refresh_token: "outlook-refresh-token",
      }),
  };
};

describe("resolveOAuthIngestionResolution", () => {
  test("resolves google runtime dependencies", () => {
    const resolution = resolveOAuthIngestionResolution({
      accessToken: "access-token",
      externalCalendarId: "calendar-1",
      oauthConfig: {
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      },
      provider: "google",
      syncToken: "sync-token",
      userId: "user-1",
    }, createDependencies());

    expect(resolution.status).toBe(OAuthIngestionResolutionStatus.RESOLVED);
    if (resolution.status !== OAuthIngestionResolutionStatus.RESOLVED) {
      throw new Error("Invariant violated: expected resolved status");
    }
    expect(typeof resolution.tokenRefresher).toBe("function");
    expect(typeof resolution.fetcher.fetchEvents).toBe("function");
    expect(resolution.rateLimiter).toBeDefined();
  });

  test("resolves outlook runtime dependencies without rate limiter", () => {
    const resolution = resolveOAuthIngestionResolution({
      accessToken: "access-token",
      externalCalendarId: "calendar-1",
      oauthConfig: {
        microsoftClientId: "microsoft-client-id",
        microsoftClientSecret: "microsoft-client-secret",
      },
      provider: "outlook",
      syncToken: "sync-token",
      userId: "user-1",
    }, createDependencies());

    expect(resolution.status).toBe(OAuthIngestionResolutionStatus.RESOLVED);
    if (resolution.status !== OAuthIngestionResolutionStatus.RESOLVED) {
      throw new Error("Invariant violated: expected resolved status");
    }
    expect(typeof resolution.tokenRefresher).toBe("function");
    expect(typeof resolution.fetcher.fetchEvents).toBe("function");
    expect(resolution.rateLimiter).toBeUndefined();
  });

  test("returns misconfigured status for google when oauth config is missing", () => {
    const resolution = resolveOAuthIngestionResolution({
      accessToken: "access-token",
      externalCalendarId: "calendar-1",
      oauthConfig: {
        googleClientId: "google-client-id",
      },
      provider: "google",
      syncToken: "sync-token",
      userId: "user-1",
    }, createDependencies());

    expect(resolution.status).toBe(OAuthIngestionResolutionStatus.MISCONFIGURED_PROVIDER);
  });

  test("returns missing credentials when external calendar id is absent", () => {
    const resolution = resolveOAuthIngestionResolution({
      accessToken: "access-token",
      externalCalendarId: null,
      oauthConfig: {
        googleClientId: "google-client-id",
        googleClientSecret: "google-client-secret",
      },
      provider: "google",
      syncToken: "sync-token",
      userId: "user-1",
    }, createDependencies());

    expect(resolution.status).toBe(OAuthIngestionResolutionStatus.MISSING_PROVIDER_CREDENTIALS);
  });

  test("returns unsupported provider for unknown oauth provider", () => {
    const resolution = resolveOAuthIngestionResolution({
      accessToken: "access-token",
      externalCalendarId: "calendar-1",
      oauthConfig: {},
      provider: "yahoo",
      syncToken: "sync-token",
      userId: "user-1",
    }, createDependencies());

    expect(resolution.status).toBe(OAuthIngestionResolutionStatus.UNSUPPORTED_PROVIDER);
  });
});
