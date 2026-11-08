import { RoleName } from "@prisma/client";
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: RoleName;
      phone?: string | null;
      /** Admin-created account with a temporary password: must change before using the app */
      mustChangePassword?: boolean;
      /** Store owner has at least one APPROVED store (false while pending/rejected). */
      storeApproved?: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: RoleName;
    phone?: string | null;
    mustChangePassword?: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    role?: RoleName;
    phone?: string | null;
    mustChangePassword?: boolean;
    /** Store owner has at least one APPROVED store (false while pending/rejected). */
    storeApproved?: boolean;
  }
}
