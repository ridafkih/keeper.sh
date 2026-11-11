import useSWR from "swr";
import { apiFetch, fetcher } from "@/lib/fetcher";

interface AccountSettings {
  agentFeedbackEnabled: boolean;
}

const ACCOUNT_SETTINGS_URL = "/api/account/settings";

const saveAccountSettings = async (settings: AccountSettings): Promise<AccountSettings> => {
  const response = await apiFetch(ACCOUNT_SETTINGS_URL, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return response.json();
};

export const useAccountSettings = () => {
  const { data, mutate } = useSWR<AccountSettings>(ACCOUNT_SETTINGS_URL, fetcher);

  const setAgentFeedbackEnabled = (agentFeedbackEnabled: boolean) => {
    const settings = { agentFeedbackEnabled };
    void mutate(saveAccountSettings(settings), {
      optimisticData: settings,
      rollbackOnError: true,
      revalidate: false,
    });
  };

  return { settings: data, setAgentFeedbackEnabled };
};
