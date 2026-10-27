const REDIS_UNAVAILABLE_SLUG = "redis-unavailable";
const MAX_RETRIES_PER_REQUEST_ERROR_NAME = "MaxRetriesPerRequestError";
const CONNECTION_CLOSED_MESSAGE = "Connection is closed.";
const MAX_CAUSE_DEPTH = 8;

const isRedisUnavailableLink = (link: unknown): boolean =>
  link instanceof Error
  && (link.name === MAX_RETRIES_PER_REQUEST_ERROR_NAME || link.message === CONNECTION_CLOSED_MESSAGE);

const isRedisUnavailableError = (error: unknown): boolean => {
  let link = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && link instanceof Error; depth += 1) {
    if (isRedisUnavailableLink(link)) {
      return true;
    }
    link = link.cause;
  }
  return false;
};

export { REDIS_UNAVAILABLE_SLUG, isRedisUnavailableError };
