"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@base-ui/react/button";
import { Separator } from "@base-ui/react/separator";
import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/card";
import { Toast } from "@/components/toast-provider";
import {
  EditNameDialog,
  ChangePasswordDialog,
  DeleteAccountDialog,
} from "@/components/settings-dialogs";
import { PageContent } from "@/components/page-content";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import {
  FieldLabel,
  FieldValue,
  DangerFieldLabel,
  DangerFieldValue,
} from "@/components/typography";
import { updateUser, changePassword, deleteAccount, signOut } from "@/lib/auth";
import { button } from "@/styles";

export default function SettingsPage() {
  const { user, refresh } = useAuth();
  const router = useRouter();
  const toastManager = Toast.useToastManager();

  const [isEditingName, setIsEditingName] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleUpdateName = async (name: string) => {
    await updateUser({ name });
    await refresh();
    toastManager.add({ title: "Name updated" });
  };

  const handleChangePassword = async (
    currentPassword: string,
    newPassword: string,
  ) => {
    await changePassword(currentPassword, newPassword);
    toastManager.add({ title: "Password changed" });
  };

  const handleDeleteAccount = async (password: string) => {
    await deleteAccount(password);
    await signOut();
    router.push("/");
  };

  return (
    <PageContent>
      <Section>
        <SectionHeader
          title="Profile"
          description="Manage your personal information"
        />

        <Card padding="sm" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <FieldLabel as="div">Display Name</FieldLabel>
              <FieldValue as="div">{user?.name || "Not set"}</FieldValue>
            </div>
            <Button
              onClick={() => setIsEditingName(true)}
              className={button({ variant: "secondary", size: "xs" })}
            >
              Edit
            </Button>
          </div>
          <Separator className="bg-border h-px" />
          <div>
            <FieldLabel as="div">Username</FieldLabel>
            <FieldValue as="div">{user?.username}</FieldValue>
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

      <EditNameDialog
        open={isEditingName}
        onOpenChange={setIsEditingName}
        initialName={user?.name ?? ""}
        onSave={handleUpdateName}
      />

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
