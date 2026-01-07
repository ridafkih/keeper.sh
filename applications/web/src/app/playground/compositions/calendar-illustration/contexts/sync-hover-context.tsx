"use client";

import type { FC, PropsWithChildren } from "react";
import { Provider, atom, useAtomValue, useSetAtom } from "jotai";

const syncHoverAtom = atom(false);

const useSyncHoverState = () => useAtomValue(syncHoverAtom);
const useSyncHoverSetter = () => useSetAtom(syncHoverAtom);

const SyncHoverProvider: FC<PropsWithChildren> = ({ children }) => <Provider>{children}</Provider>;

export { useSyncHoverState, useSyncHoverSetter, SyncHoverProvider };
