import { useNavigate, useLocation } from '@tanstack/react-router';
import UserMenu from './auth/UserMenu';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Gem, Menu } from 'lucide-react';
import { useCallback, useEffect, useState, Fragment } from 'react';
import { reportClick } from '@/utils/report';
import { usePermissionStore } from '@/store/permissionStore';
import { getDeclaredRouteAccess } from '@/router/routeConfig';
import { InviteRewardDialog } from './InviteRewardDialog';
import { useAuth } from '@/contexts/AuthContext';
import { signInClock, type SignInClockData } from '@/api/auth';
import MessageCenter from '@/components/message/MessageCenter';
import { cn } from '@/lib/utils';
type TabItem = {
  key: string;
  label: string;
  disabled?: boolean;
  children: null;
  path?: string;
  hasLine?: boolean;
  permissions?: string[];
};

const inspirationPermissions = getDeclaredRouteAccess('/inspiration')?.permissions ?? [];
const HEADER_LOGO_URL = 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/svg/ai-110d2b05273b42e5.svg';
const INVITE_ENTRY_BG = 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/jpg/3bae24d59249e736.jpg?x-oss-process=image/format,webp';
const NO_ACTIVE_HEADER_TAB = '__NO_ACTIVE_HEADER_TAB__';

const items: TabItem[] = [
  {
    key: '1',
    label: '首页',
    children: null,
    path: '/home',
    hasLine: true,
  },
  // {
  //   key: '2',
  //   // disabled: true,
  //   label: 'AI员工',
  //   children: null,
  //   path: '/aichat',
  // },
  // {
  //   key: '3',
  //   label: 'AI群组',
  //   // disabled: true,
  //   children: null,
  //   path: '/aigroup',
  // },
  {
    key: '4',
    disabled: false,
    label: '创作空间',
    children: null,
    path: '/workflow',
  },
  {
    key: '5',
    disabled: true,
    label: 'InClaw',
    children: null,
    path: '/workflow',
    hasLine: true,
  },
  {
    key: '6',
    disabled: false,
    label: '探索社区',
    children: null,
    path: '/community',
  },
  {
    key: '8',
    disabled: false,
    label: '灵感库',
    children: null,
    path: '/inspiration',
    permissions: inspirationPermissions,
  },
  {
    key: '7',
    disabled: false,
    label: '资产库',
    children: null,
    path: '/asset',
  },
  // {
  //   key: '6',
  //   disabled: true,
  //   label: '工具库',
  //   children: null,
  // },
  // {
  //   key: '7',
  //   disabled: true,
  //   label: '知识库',
  //   children: null,
  // },
  // {
  //   key: '8',
  //   disabled: true,
  //   label: 'AI市场',
  //   children: null,
  // },
  // {
  //   key: '9',
  //   disabled: true,
  //   label: '项目中心',
  //   children: null,
  // },
];

const normalizeHeaderPath = (path: string) => {
  if (!path || path === '/') return '/';
  return path.endsWith('/') ? path.slice(0, -1) : path;
};

const isHeaderTabActive = (pathname: string, tabPath: string) => {
  const normalizedPathname = normalizeHeaderPath(pathname);
  const normalizedTabPath = normalizeHeaderPath(tabPath);

  return normalizedPathname === normalizedTabPath || normalizedPathname.startsWith(`${normalizedTabPath}/`);
};

export default function HeaderBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissionStore();
  const { authStatus } = useAuth();

  // 根据权限过滤菜单选项
  const filteredItems = items.filter(item => {
    if (!item.path) return false;
    if (item.permissions?.length) {
      return item.permissions.every(permission => hasPermission(permission));
    }
    return true;
  });

  // 根据 URL 路径自动匹配当前的 Tab
  // 使用 derived state 而不是 useState + useEffect，确保 activeKey 始终与 location 同步 (single source of truth)
  const activeKey = filteredItems.find(item => item.path && isHeaderTabActive(location.pathname, item.path))?.key;
  const activeTabValue = activeKey ?? NO_ACTIVE_HEADER_TAB;

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [hasSignInRedDot, setHasSignInRedDot] = useState(false);

  const onValueChange = (key: string) => {
    const item = filteredItems.find(item => item.key === key);
    if (!item || item.disabled) {
      return;
    }
    // 注意：这里移除了 setActiveKey(key)，因为 activeKey 现在是根据 location 动态计算的。
    // 点击导航后，路由变化会触发组件重渲染，进而更新 activeKey。

    // 工作流点击事件上报
    if (item.path == '/workflow') {
      reportClick(null, 'workflow');
    }
    if (item.path) {
      navigate({ to: item.path });
    }
    setIsMobileMenuOpen(false);
  };

  const handleOpenInviteReward = useCallback(() => {
    setInviteDialogOpen(true);
  }, []);

  const handlePriceClick = useCallback(() => {
    navigate({ to: '/price' as string });
    setIsMobileMenuOpen(false);
  }, [navigate]);

  const handleSignInStatusChange = useCallback((status: SignInClockData) => {
    setHasSignInRedDot(Boolean(status.signInRedDot && !status.signedToday));
  }, []);

  useEffect(() => {
    if (authStatus.status !== 'logged_in') {
      setHasSignInRedDot(false);
      return;
    }

    let cancelled = false;
    void signInClock()
      .then((response: any) => {
        if (cancelled) return;
        const nextData = response.code === 'SUCCESS' ? response.data || response.body : null;
        setHasSignInRedDot(Boolean(nextData?.signInRedDot && !nextData?.signedToday));
      })
      .catch(() => {
        if (!cancelled) {
          setHasSignInRedDot(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authStatus.status]);

  return (
    <div className='sticky top-0 z-50 grid h-16 w-full grid-cols-2 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center border-b border-border bg-background px-4 select-none'>
      <div className='flex min-w-0 items-center'>
        <button
          type='button'
          className='flex h-10 items-center rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60'
          onClick={() => {
            navigate({ to: '/home' as string });
          }}
          aria-label='返回首页'
        >
          <img src={HEADER_LOGO_URL} alt='DynSight 掂商' className='h-8 w-auto max-w-[120px]' draggable={false} />
        </button>
      </div>
      <div className='hidden items-center justify-center gap-4 md:flex'>
        <Tabs value={activeTabValue} onValueChange={onValueChange} className='w-full'>
          <TabsList className='bg-transparent h-16 p-0 border-b-0 space-x-6'>
            {filteredItems.map(item => (
              <Fragment key={item.key}>
                <TabsTrigger
                  key={item.key}
                  value={item.key}
                  // disabled={item.disabled}
                  className={`
                  relative h-full px-2 pb-3 pt-3 text-sm font-medium transition-all rounded-none shadow-none text-muted-foreground bg-transparent
                  data-[state=active]:text-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:font-semibold
                  after:content-[''] after:absolute after:bottom-0 after:left-0 after:w-full after:h-[2px] after:bg-[#4155F0] after:scale-x-0 data-[state=active]:after:scale-x-100 after:transition-transform
                  ${item.disabled ? 'text-muted-foreground/50' : 'hover:text-primary'}
                `}
                >
                  {item.label}
                  {item.disabled && (
                    <div className='absolute top-[7px] left-9 px-1 bg-[#4155f080] border border-[#4155F0] rounded-lg text-[8px] leading-3 text-primary'>敬请期待</div>
                  )}
                </TabsTrigger>
                {item.hasLine && <Separator orientation='vertical' className='ml-6 h-6 bg-[#ffffff40]' />}
              </Fragment>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className='flex min-w-0 items-center justify-end gap-2'>
        <MessageCenter className='mobile:hidden' />
        {authStatus.status === 'logged_out' && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className={cn(
              'mobile:hidden rounded-full border text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary/60',
              'hover:border-primary/60 hover:bg-accent hover:text-foreground',
              isHeaderTabActive(location.pathname, '/price') ? 'border-primary/60 bg-accent text-foreground' : 'border-border/70 text-foreground/90'
            )}
            onClick={handlePriceClick}
          >
            <Gem className='h-4 w-4' />
            价格
          </Button>
        )}
        {authStatus.status === 'logged_in' && (
          <div
            className='relative mobile:hidden rounded-full min-w-fit bg-cover'
            style={{
              backgroundImage: `url("${INVITE_ENTRY_BG}")`,
            }}
          >
            <button
              type='button'
              aria-haspopup='dialog'
              aria-expanded={inviteDialogOpen}
              onClick={handleOpenInviteReward}
              className='relative h-8 rounded-full bg-cover bg-center border-[2px] border-[rgba(255,255,255,0.25)] px-4 py-1 text-sm  leading-normal text-white/90 shadow-sm transition-opacity hover:text-white focus:outline-none'
            >
              获取赛点
              {hasSignInRedDot && <span className='absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border border-background bg-[#ff5d5d]' />}
            </button>
          </div>
        )}

        <div className='w-auto flex justify-end'>
          <UserMenu />
        </div>

        {/* Mobile Menu */}
        <div className='md:hidden'>
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger asChild>
              <Button variant='ghost' size='icon'>
                <Menu className='h-5 w-5' />
              </Button>
            </SheetTrigger>
            <SheetContent side='right' className='w-[240px] pt-10'>
              <div className='flex flex-col gap-2'>
                {filteredItems.map(item => (
                  <Button
                    key={item.key}
                    variant={activeKey === item.key ? 'secondary' : 'ghost'}
                    disabled={item.disabled}
                    className='justify-start w-full'
                    onClick={() => onValueChange(item.key)}
                  >
                    {item.label}
                  </Button>
                ))}
                {authStatus.status === 'logged_out' && (
                  <Button variant={isHeaderTabActive(location.pathname, '/price') ? 'secondary' : 'ghost'} className='justify-start w-full' onClick={handlePriceClick}>
                    价格
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <InviteRewardDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} onSignInStatusChange={handleSignInStatusChange} />
    </div>
  );
}
