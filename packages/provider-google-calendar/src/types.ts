interface GoogleDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface PartialGoogleDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

interface GoogleApiError {
  code?: number;
  message?: string;
  status?: string;
}

export type { GoogleDateTime, PartialGoogleDateTime, GoogleApiError };
