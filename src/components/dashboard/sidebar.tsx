import { type Role } from "@/lib/auth/roles";
import { getDashboardNavGroups } from "@/lib/auth/dashboard-permissions.server";
import {
  MobileSidebarClient,
  SidebarClient,
  type ImpersonationInfo,
} from "./sidebar.client";

export async function Sidebar({
  role,
  isCeo = false,
  impersonation,
}: {
  role: Role;
  isCeo?: boolean;
  impersonation?: ImpersonationInfo | null;
}) {
  const navGroups = await getDashboardNavGroups();

  return (
    <SidebarClient
      role={role}
      isCeo={isCeo}
      navGroups={navGroups}
      impersonation={impersonation}
    />
  );
}

export async function MobileSidebar({
  role,
  isCeo = false,
  impersonation,
}: {
  role: Role;
  isCeo?: boolean;
  impersonation?: ImpersonationInfo | null;
}) {
  const navGroups = await getDashboardNavGroups();

  return (
    <MobileSidebarClient
      role={role}
      isCeo={isCeo}
      navGroups={navGroups}
      impersonation={impersonation}
    />
  );
}

export type { ImpersonationInfo } from "./sidebar.client";
