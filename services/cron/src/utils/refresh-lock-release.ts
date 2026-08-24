import { widelog } from "@/utils/logging";

interface RefreshLockReleaser {
  release: (key: string) => Promise<void>;
}

const releaseRefreshLock = async (
  store: RefreshLockReleaser,
  key: string,
): Promise<void> => {
  try {
    await store.release(key);
  } catch (error) {
    widelog.set("calendar_refresh.lock_release_failed_key", key);
    widelog.errorFields(error, { slug: "refresh-lock-release-failed", retriable: true });
  }
};

export { releaseRefreshLock };
