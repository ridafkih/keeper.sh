interface User {
  id: string;
  username: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface CredentialAccount {
  id: string;
  userId: string;
  accountId: string;
  providerId: "credential";
  password: string;
  createdAt: Date;
  updatedAt: Date;
}

export type { User, CredentialAccount };
