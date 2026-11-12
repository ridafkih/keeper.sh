interface MappingToggle {
  calendarId: string;
  enabled: boolean;
}

interface MappingToggleOptions {
  currentIds: string[];
  onError: (toggle: MappingToggle, error: unknown) => void;
  publish: (calendarIds: string[]) => void;
  send: (toggle: MappingToggle) => Promise<string[]>;
}

interface MappingToggleQueue {
  confirmedIds: string[];
  options: MappingToggleOptions;
  pending: MappingToggle[];
}

const queues = new Map<string, MappingToggleQueue>();

const applyMappingToggle = (calendarIds: string[], toggle: MappingToggle): string[] => {
  if (toggle.enabled) {
    return [...new Set([...calendarIds, toggle.calendarId])];
  }
  return calendarIds.filter((calendarId) => calendarId !== toggle.calendarId);
};

const resolveDisplayedIds = (queue: MappingToggleQueue): string[] =>
  queue.pending.reduce(applyMappingToggle, queue.confirmedIds);

const drainMappingToggles = async (key: string, queue: MappingToggleQueue): Promise<void> => {
  for (let toggle = queue.pending[0]; toggle; toggle = queue.pending[0]) {
    try {
      queue.confirmedIds = await queue.options.send(toggle);
    } catch (error) {
      queue.options.onError(toggle, error);
    }
    queue.pending.shift();
    queue.options.publish(resolveDisplayedIds(queue));
  }
  queues.delete(key);
};

const enqueueMappingToggle = (
  key: string,
  toggle: MappingToggle,
  options: MappingToggleOptions,
): void => {
  const existing = queues.get(key);
  const queue = existing ?? { confirmedIds: options.currentIds, options, pending: [] };
  queue.options = options;
  queue.pending.push(toggle);
  options.publish(resolveDisplayedIds(queue));
  if (existing) {
    return;
  }
  queues.set(key, queue);
  void drainMappingToggles(key, queue);
};

export { applyMappingToggle, enqueueMappingToggle };
export type { MappingToggle, MappingToggleOptions };
