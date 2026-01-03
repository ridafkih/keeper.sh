"use client";

import type { FC } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Button } from "@base-ui/react/button";
import { Fingerprint, Trash2 } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/card";
import { Toast } from "@/components/toast-provider";
import { ChangePasswordDialog, DeleteAccountDialog } from "@/components/settings-dialogs";
import { PageContent } from "@/components/page-content";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { EmptyState } from "@/components/empty-state";
import { ListSkeleton } from "@/components/list-skeleton";
import {
  FieldLabel,
  FieldValue,
  DangerFieldLabel,
  DangerFieldValue,
  TextLabel,
  TextCaption,
} from "@/components/typography";
import { changePassword, deleteAccount, signOut } from "@/lib/auth";
import { isCommercialMode } from "@/config/mode";
import { authClient } from "@/lib/auth-client";
import { button } from "@/styles";
import { track } from "@/lib/analytics";

const fetchPasskeys = async () => {
  const { data, error } = await authClient.passkey.listUserPasskeys();
  if (error) throw error;
  return data ?? [];
};

type Passkey = Awaited<ReturnType<typeof fetchPasskeys>>[number];

interface PasskeysListProps {
  passkeys: Passkey[] | undefined;
  isLoading: boolean;
  onDelete: (id: string) => void;
}

const PasskeysList: FC<PasskeysListProps> = ({
  passkeys,
  isLoading,
  onDelete,
}) => {
  if (isLoading) {
    return <ListSkeleton rows={1} />;
  }

  if (!passkeys || passkeys.length === 0) {
    return (
      <EmptyState
        icon={<Fingerprint className="size-5 text-foreground-subtle" />}
        message="No passkeys added yet"
      />
    );
  }

  return (
    <Card padding="none">
      <div className="divide-y divide-border">
        {passkeys.map(({ id, name, createdAt }) => {
          return (
            <div
              key={id}
              className="flex items-center justify-between px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <Fingerprint className="size-4 text-foreground-muted" />
                <div className="flex flex-col">
                  <TextLabel as="div">{name ?? "Passkey"}</TextLabel>
                  <TextCaption>
                    Added on {createdAt.toLocaleDateString()} at{" "}
                    {createdAt.toLocaleTimeString()}
                  </TextCaption>
                </div>
              </div>
              <Button
                onClick={() => onDelete(id)}
                className={button({ variant: "ghost", size: "xs" })}
              >
                <Trash2 className="size-4 text-foreground-muted" />
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const toastManager = Toast.useToastManager();

  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [isAddingPasskey, setIsAddingPasskey] = useState(false);

  const {
    data: passkeys,
    isLoading: isLoadingPasskeys,
    mutate: mutatePasskeys,
  } = useSWR(isCommercialMode ? "passkeys" : null, fetchPasskeys);

  const handleChangePassword = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    await changePassword(currentPassword, newPassword);
    track("password_changed");
    toastManager.add({ title: "Password changed" });
  };

  const handleDeleteAccount = async (password: string) => {
    await deleteAccount(password);
    await signOut();
    router.push("/");
  };

  const handleAddPasskey = async () => {
    setIsAddingPasskey(true);
    try {
      const { error } = await authClient.passkey.addPasskey();
      if (error) {
        toastManager.add({ title: error.message ?? "Failed to add passkey" });
        return;
      }
      await mutatePasskeys();
      track("passkey_added");
      toastManager.add({ title: "Passkey added" });
    } finally {
      setIsAddingPasskey(false);
    }
  };

  const handleDeletePasskey = async (id: string) => {
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) {
      toastManager.add({ title: error.message ?? "Failed to delete passkey" });
      return;
    }
    await mutatePasskeys();
    track("passkey_deleted");
    toastManager.add({ title: "Passkey deleted" });
  };

  return (
    <PageContent>
      <Section>
        <SectionHeader
          title="Profile"
          description="Manage your personal information"
        />

        <Card padding="sm">
          <div>
            <FieldLabel as="div">
              {isCommercialMode ? "Email" : "Username"}
            </FieldLabel>
            <FieldValue as="div">
              {isCommercialMode ? user?.email : user?.username}
            </FieldValue>
          </div>
        </Card>
      </Section>

      <Section>
        <SectionHeader
          title="Security"
          description="Manage your password and account security"
        />

        <Card padding="sm" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <FieldLabel as="div">Password</FieldLabel>
              <FieldValue as="div">••••••••</FieldValue>
            </div>
            <Button
              onClick={() => setIsChangingPassword(true)}
              className={button({ variant: "secondary", size: "xs" })}
            >
              Change
            </Button>
          </div>
        </Card>
      </Section>

      {isCommercialMode && (
        <Section>
          <SectionHeader
            title="Passkeys"
            description="Manage passkeys for passwordless sign-in"
            action={
              <Button
                onClick={handleAddPasskey}
                disabled={isAddingPasskey}
                className={button({ variant: "secondary", size: "xs" })}
              >
                Add passkey
              </Button>
            }
          />

          <PasskeysList
            passkeys={passkeys}
            isLoading={isLoadingPasskeys}
            onDelete={handleDeletePasskey}
          />
        </Section>
      )}

      <Section>
        <SectionHeader
          title="Danger Zone"
          description="Irreversible actions for your account"
        />

        <Card variant="danger" padding="sm" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <DangerFieldLabel as="div">Delete Account</DangerFieldLabel>
              <DangerFieldValue as="div">
                Permanently delete your account and all data
              </DangerFieldValue>
            </div>
            <Button
              onClick={() => setIsDeletingAccount(true)}
              className={button({ variant: "danger", size: "xs" })}
            >
              Delete
            </Button>
          </div>
        </Card>
      </Section>

      <ChangePasswordDialog
        open={isChangingPassword}
        onOpenChange={setIsChangingPassword}
        onSave={handleChangePassword}
      />

      <DeleteAccountDialog
        open={isDeletingAccount}
        onOpenChange={setIsDeletingAccount}
        onDelete={handleDeleteAccount}
      />
    </PageContent>
  );
}
