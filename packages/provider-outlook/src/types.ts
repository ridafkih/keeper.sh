interface OutlookDateTime {
  dateTime: string;
  timeZone: string;
}

interface PartialOutlookDateTime {
  dateTime?: string;
  timeZone?: string;
}

interface MicrosoftApiError {
  code?: string;
}

export type { OutlookDateTime, PartialOutlookDateTime, MicrosoftApiError };
