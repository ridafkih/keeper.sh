interface GoogleDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface PartialGoogleDateTime {
  date?: string;
  dateTime?: string;
}

interface GoogleApiError {
  code?: number;
  status?: string;
}

export type { GoogleDateTime, PartialGoogleDateTime, GoogleApiError };
