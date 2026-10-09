import { FileText, MessageSquareText, Server, Settings, type LucideIcon } from "lucide-react";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

const ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: "/testbenches", label: "Testbenches", icon: Server },
  { to: "/sessions", label: "Sessions", icon: MessageSquareText },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function NavRail() {
  return (
    <nav
      aria-label="Main"
      className="row-span-2 flex flex-col items-center gap-1 border-r bg-card py-2.5 max-[860px]:sticky max-[860px]:top-0 max-[860px]:z-10 max-[860px]:row-span-1 max-[860px]:flex-row max-[860px]:justify-around max-[860px]:border-r-0 max-[860px]:border-b max-[860px]:px-2 max-[860px]:py-1.5"
    >
      <div
        aria-hidden="true"
        className="mb-3 grid size-9 place-items-center max-[860px]:mb-0 max-[860px]:size-[30px] rounded-[9px] bg-primary text-[13px] font-semibold tracking-wide text-primary-foreground"
      >
        BP
      </div>
      {ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            cn(
              "flex w-14 flex-col items-center max-[860px]:w-auto max-[860px]:px-2 gap-0.5 rounded-lg pt-[7px] pb-[5px] text-[10.5px] leading-tight text-muted-foreground transition-colors",
              "hover:bg-accent hover:text-foreground",
              isActive && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
            )
          }
        >
          <Icon className="size-5" strokeWidth={1.7} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
