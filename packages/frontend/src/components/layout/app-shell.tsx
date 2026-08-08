import { motion } from 'framer-motion';
import {
  Building2,
  CalendarClock,
  CalendarRange,
  ClipboardList,
  FileClock,
  FileText,
  LayoutDashboard,
  LogOut,
  ScrollText,
  Settings,
  ShieldCheck,
  TrendingUp,
  Users,
  UserCheck,
  UserCog,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { BrandLogo } from '@/components/ui/brand-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuth } from '@/contexts/auth-context';
import { cn, initials } from '@/lib/utils';
import { MockModeBanner } from '@/components/layout/mock-mode-banner';

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** capability key from the permission matrix */
  capability?:
    | 'manageOrg'
    | 'manageUsers'
    | 'viewAllEmployees'
    | 'viewDirectReports'
    | 'viewAuditLog'
    | 'manageOffboarding'
    | 'manageRecruitment'
    | 'manageRecruitmentDept'
    | 'viewTeamAttendance'
    | 'approveLeave'
    | 'conductReviews'
    | 'managePerformance'
    | 'viewOwnOffboarding'
    | 'viewFullAuditLog'
    | 'manageRetention'
    | 'manageDsar'
    | 'manageBreach'
    | 'manageConsentAndKeys'
    | 'viewGdprAdmin';
  /** fallback capability if primary capability is not granted */
  fallbackCapability?:
    | 'manageOrg'
    | 'manageUsers'
    | 'viewAllEmployees'
    | 'viewDirectReports'
    | 'viewAuditLog'
    | 'manageOffboarding'
    | 'manageRecruitment'
    | 'manageRecruitmentDept'
    | 'viewTeamAttendance'
    | 'approveLeave'
    | 'conductReviews'
    | 'managePerformance'
    | 'viewOwnOffboarding'
    | 'viewFullAuditLog'
    | 'manageRetention'
    | 'manageDsar'
    | 'manageBreach'
    | 'manageConsentAndKeys'
    | 'viewGdprAdmin';
  /** Always visible but scoped at runtime (e.g. employee sees self) */
  alwaysVisible?: boolean;
}

const navSections: { title?: string; items: NavItem[] }[] = [
  {
    items: [
      {
        to: '/app',
        label: 'Dashboard',
        icon: LayoutDashboard,
        alwaysVisible: true,
      },
    ],
  },
  {
    title: 'People',
    items: [
      {
        to: '/app/employees',
        label: 'Employees',
        icon: Users,
        alwaysVisible: true,
      },
      {
        to: '/app/attendance',
        label: 'Attendance & Leave',
        icon: CalendarClock,
        alwaysVisible: true,
      },
      {
        to: '/app/my-data',
        label: 'My Data & Privacy',
        icon: ShieldCheck,
        alwaysVisible: true,
      },
    ],
  },
  {
    title: 'Talent',
    items: [
      {
        to: '/app/recruitment',
        label: 'Recruitment',
        icon: UserPlus,
        capability: 'manageRecruitment',
        fallbackCapability: 'manageRecruitmentDept',
      },
      {
        to: '/app/recruitment/candidates',
        label: 'Candidates',
        icon: Users,
        capability: 'manageRecruitment',
        fallbackCapability: 'manageRecruitmentDept',
      },
      {
        to: '/app/recruitment/interviews',
        label: 'Interviews',
        icon: CalendarClock,
        capability: 'manageRecruitment',
        fallbackCapability: 'manageRecruitmentDept',
      },
      {
        to: '/app/recruitment/offers',
        label: 'Offer Letters',
        icon: FileText,
        // Offer Letters are HR-only — managers should not see this menu item.
        capability: 'manageRecruitment',
      },
      {
        to: '/app/recruitment/onboarding',
        label: 'Onboarding',
        icon: UserCheck,
        capability: 'manageRecruitment',
        fallbackCapability: 'manageRecruitmentDept',
      },
      {
        to: '/app/performance',
        label: 'Performance',
        icon: TrendingUp,
        alwaysVisible: true,
      },
    ],
  },
  {
    title: 'Organization',
    items: [
      {
        to: '/app/departments',
        label: 'Departments',
        icon: Building2,
        capability: 'manageOrg',
      },
      {
        to: '/app/positions',
        label: 'Positions',
        icon: ClipboardList,
        capability: 'manageOrg',
      },
      {
        to: '/app/leave-holidays',
        label: 'Leave & Holidays',
        icon: CalendarRange,
        alwaysVisible: true,
      },
      {
        to: '/app/users',
        label: 'User Management',
        icon: UserCog,
        capability: 'manageUsers',
      },
      {
        to: '/app/offboarding',
        label: 'Offboarding',
        icon: UserMinus,
        capability: 'manageOffboarding',
        fallbackCapability: 'viewOwnOffboarding',
      },
    ],
  },
  {
    title: 'Compliance',
    items: [
      {
        to: '/app/audit-log',
        label: 'Audit Log',
        icon: FileClock,
        capability: 'viewAuditLog',
      },
      {
        to: '/app/compliance/retention',
        label: 'Data Retention',
        icon: CalendarClock,
        capability: 'manageRetention',
      },
      {
        to: '/app/compliance/data-subject-rights',
        label: 'Data Subject Rights',
        icon: UserCheck,
        capability: 'manageDsar',
      },
      {
        to: '/app/compliance/dsar',
        label: 'DSAR Queue',
        icon: ClipboardList,
        capability: 'manageDsar',
      },
      {
        to: '/app/compliance/consent',
        label: 'Consent',
        icon: FileText,
        capability: 'manageConsentAndKeys',
      },
      {
        to: '/app/compliance/breach',
        label: 'Breach Register',
        icon: ShieldCheck,
        capability: 'manageBreach',
      },
      {
        to: '/app/compliance/keys',
        label: 'Encryption Keys',
        icon: UserCog,
        capability: 'manageConsentAndKeys',
      },
    ],
  },
];

export function AppShell() {
  const { user, employee, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) return null;

  const displayName = employee ? `${employee.firstName} ${employee.lastName}` : user.email;

  return (
    <div className="flex h-screen overflow-hidden bg-ink-50">
      {/* Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r border-ink-200 bg-white transition-[width] duration-300 ease-out',
          collapsed ? 'w-[68px]' : 'w-64',
        )}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-2.5 border-b border-ink-200 px-4">
          <BrandLogo />
          {!collapsed && (
            <div className="overflow-hidden">
              <div className="font-display text-base leading-none font-semibold tracking-tight text-ink-900">
                Peoplevate
              </div>
              <div className="mt-1 truncate text-[10px] tracking-wider text-ink-400 uppercase">
                Employee Lifecycle
              </div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {navSections.map((section, si) => {
            const visibleItems = section.items.filter((item) => {
              if (item.alwaysVisible) return true;
              if (item.capability && hasPermission(item.capability)) return true;
              if (item.fallbackCapability && hasPermission(item.fallbackCapability)) return true;
              return false;
            });
            if (visibleItems.length === 0) return null;
            return (
              <div key={si}>
                {section.title && !collapsed && (
                  <div className="mb-2 px-3 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
                    {section.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {visibleItems.map((item) => (
                    <SidebarLink key={item.to} item={item} collapsed={collapsed} />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-ink-200 p-3">
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-700',
              collapsed && 'justify-center',
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!collapsed && <span>Collapse sidebar</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <MockModeBanner />
        {/* Header */}
        <header className="flex h-16 items-center justify-between border-b border-ink-200 bg-white px-6">
          <div className="flex items-center gap-3">
            <h1 className="font-display text-lg font-semibold tracking-tight text-ink-900">
              {headerTitle()}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-1.5 rounded-full border border-ink-200 px-2.5 py-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-accent-600" />
                    <span className="text-xs font-medium text-ink-600">{user.role}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Role-based access control is active</TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <Separator orientation="vertical" className="h-6" />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2.5 rounded-full py-1 pr-3 pl-1 transition-colors hover:bg-ink-100">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-ink-900 text-xs text-ink-50">
                      {initials(displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <div className="text-xs leading-tight font-medium text-ink-900">
                      {displayName}
                    </div>
                    <div className="text-[11px] leading-tight text-ink-500">{user.email}</div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="font-medium text-ink-900">{displayName}</div>
                  <div className="mt-0.5 text-xs font-normal text-ink-500">{user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/app/profile')}>
                  <Users className="h-4 w-4" />
                  My profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/app/settings')}>
                  <ScrollText className="h-4 w-4" />
                  Account settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-700"
                  onClick={handleLogout}
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="mx-auto max-w-7xl p-6 lg:p-8"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.to}
      end={item.to === '/app'}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all',
          collapsed && 'justify-center',
          isActive
            ? 'bg-ink-900 text-ink-50 shadow-sm'
            : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </NavLink>
  );
  if (collapsed) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{link}</TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return link;
}

function headerTitle(): ReactNode {
  const path = location.pathname;
  if (path === '/app') return 'Dashboard';
  if (path.startsWith('/app/recruitment/candidates')) return 'Candidates';
  if (path.startsWith('/app/recruitment/interviews')) return 'Interviews';
  if (path.startsWith('/app/recruitment/offers')) return 'Offer Letters';
  if (path.startsWith('/app/recruitment/onboarding')) return 'Onboarding';
  const seg = path.split('/app/')[1]?.split('/')[0];
  const map: Record<string, string> = {
    employees: 'Employees',
    departments: 'Departments',
    positions: 'Positions',
    'leave-holidays': 'Leave & Holidays',
    'audit-log': 'Audit Log',
    recruitment: 'Recruitment',
    attendance: 'Attendance & Leave',
    performance: 'Performance',
    offboarding: 'Offboarding',
    users: 'User Management',
    profile: 'My Profile',
    settings: 'Account Settings',
    'my-data': 'My Data & Privacy',
  };
  if (path.startsWith('/app/compliance/')) {
    const page = path.split('/app/compliance/')[1]?.split('/')[0];
    const complianceMap: Record<string, string> = {
      retention: 'Data Retention',
      breach: 'Breach Register',
      dsar: 'DSAR Queue',
      consent: 'Consent',
      keys: 'Encryption Keys',
      'data-subject-rights': 'Data Subject Rights',
    };
    return complianceMap[page ?? ''] ?? 'Compliance';
  }
  return map[seg ?? ''] ?? 'ELMS';
}
