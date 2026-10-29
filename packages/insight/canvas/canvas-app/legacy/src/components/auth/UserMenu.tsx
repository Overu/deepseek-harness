import React, { useState, useEffect, useRef } from 'react';
import { Bell, Gift, LogOut, Sparkles, BadgeCheck, CreditCard, ClipboardList, KeyRound, Loader2, Ticket, User, UserPen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import AccountManagement from './AccountManagement';
import { cn } from '@/lib/utils';
import { communityApi, type CommunityUserProfile } from '@/api/community';
import { ProfileEditDialog, type ProfileEditValues } from '@/components/community/ProfileEditDialog';
import { InviteRewardDialog } from '@/components/InviteRewardDialog';
// import PayDialog from '../popPay/payDialog';
import { openGlobalDialog } from '@/components/popPay/payPop';
import PopPointV2 from '@/components/popPay/PopPointV2';
import PopPointDetail from '@/components/popPay/PopPointDetail';
import PointDisplay from './PointDisplay';
import { PasswordSettingDialog } from './PasswordSettingDialog';
import { RedeemCodeDialog } from './RedeemCodeDialog';
import { getAvailableCapacity } from '@/api/asset';
import { getCurrentMembershipPlan } from '@/api/order';
import { openDialog } from '@/components/globalDialog';
import { DesktopUnlockDialog } from '@/components/landing-entry/DesktopUnlockDialog';
import { isLandingMobile } from '@/components/landing-entry/landingEntry';
import { useUserStore } from '@/store/userStore';
import { Progress } from '@/components/ui/progress';
import { formatFileSize, compressImage } from '@/utils';
import { TUTORIAL_URL } from '@/constants';
import { openMessageCenterDialog } from '@/components/message/openMessageCenterDialog';
import { ResponsiveView } from '@/components/common/ResponsiveView';
import { queryUserInfo } from '@/utils/authResolver';

const userMenuItemClassName = 'cursor-pointer hover:bg-white/10 focus:bg-white/10 focus:text-white data-[highlighted]:bg-white/10 data-[highlighted]:text-white';

type ApiResponse<T> = {
  code?: string | number;
  msg?: string;
  data?: T;
  body?: T;
  success?: boolean;
};

const isSuccessResponse = <T,>(response: ApiResponse<T>) => {
  return response.success === true || response.code === 'SUCCESS' || response.code === 200 || String(response.code) === '0' || String(response.code) === '200';
};

const getResponseData = <T,>(response: ApiResponse<T>) => response.data || response.body;

const getErrorMessage = (error: unknown, fallback = '获取用户信息失败') => {
  if (error && typeof error === 'object') {
    const maybeError = error as { msg?: unknown; message?: unknown };
    if (typeof maybeError.msg === 'string') return maybeError.msg;
    if (typeof maybeError.message === 'string') return maybeError.message;
  }

  return fallback;
};

const UserMenu: React.FC = () => {
  const { userInfo, currentMembershipPlan } = useUserStore(state => state);
  const { setUserInfo, setCurrentMembershipPlan } = useUserStore(state => state.actions);
  const loading = useRef(false);
  const profileRequestRef = useRef<Promise<CommunityUserProfile | null> | null>(null);
  const [dialogShow, setDialogShow] = useState(false);
  const [passwordDialogShow, setPasswordDialogShow] = useState(false);
  const [profileDialogShow, setProfileDialogShow] = useState(false);
  const [profileEditLoading, setProfileEditLoading] = useState(false);
  const [profileForEdit, setProfileForEdit] = useState<CommunityUserProfile | null>(null);
  const [pointVisible, setPointVisible] = useState(false);
  const [pointDetailVisible, setPointDetailVisible] = useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { authStatus, logout } = useAuth();
  const location = useLocation();
  const [capacity, setCapacity] = useState<{
    usedCapacity: number;
    limitCapacity: number;
    highestCapacity: number;
  } | null>(null);

  const refreshCapacity = async () => {
    try {
      const res: any = await getAvailableCapacity();
      if (res.code === 'SUCCESS' && res.data) {
        setCapacity(res.data);
      }
    } catch (error) {
      console.error('获取资产库容量失败：', error);
    }
  };

  const refreshMembershipPlan = async () => {
    try {
      const res: any = await getCurrentMembershipPlan();
      setCurrentMembershipPlan(res.code === 'SUCCESS' && res.data ? res.data : null);
    } catch (error) {
      console.error('获取会员套餐失败：', error);
    }
  };

  const refreshProfileForEdit = (silent = false) => {
    if (!userInfo?.id) return Promise.resolve(null);
    if (profileForEdit?.user_id === userInfo.id) return Promise.resolve(profileForEdit);
    if (profileRequestRef.current) return profileRequestRef.current;

    const request = (async () => {
      setProfileEditLoading(true);
      try {
        const response = (await communityApi.users.getProfile(userInfo.id)) as ApiResponse<CommunityUserProfile>;
        const profileData = getResponseData(response);

        if (!isSuccessResponse(response) || !profileData) {
          if (!silent) toast.error(response.msg || '获取用户信息失败');
          return null;
        }

        setProfileForEdit(profileData);
        return profileData;
      } catch (error) {
        if (!silent) toast.error(getErrorMessage(error));
        return null;
      } finally {
        setProfileEditLoading(false);
        profileRequestRef.current = null;
      }
    })();

    profileRequestRef.current = request;
    return request;
  };

  const handleProfileEditClick = () => {
    setTimeout(async () => {
      if (!userInfo?.id) {
        toast.error('用户信息加载中，请稍后');
        return;
      }

      const profileData = await refreshProfileForEdit();
      if (profileData) {
        setProfileDialogShow(true);
      }
    }, 300);
  };

  const handleProfileSaved = (values: ProfileEditValues) => {
    if (userInfo) {
      setUserInfo({
        ...userInfo,
        avatarUrl: values.avatarUrl,
        userName: values.userName,
      });
    }

    setProfileForEdit(prev =>
      prev
        ? {
            ...prev,
            avatar_url: values.avatarUrl,
            user_name: values.userName,
            signature: values.signature,
          }
        : prev
    );
  };

  const handleLoginClick = () => {
    sessionStorage.setItem('redirectPath', location.pathname);
    navigate({ to: '/login' });
  };

  const getUser = async () => {
    try {
      const res: any = await queryUserInfo();
      if (res.code === 'SUCCESS') {
        setUserInfo(res.data);
      }
    } catch (error) {
      console.error('获取用户信息失败：', error);
    }
  };

  useEffect(() => {
    if (authStatus.status !== 'logged_in') {
      loading.current = false;
      return;
    }

    if (!loading.current) {
      const tasks = [];
      if (!userInfo) tasks.push(getUser());
      if (!currentMembershipPlan) tasks.push(refreshMembershipPlan());

      if (tasks.length > 0) {
        loading.current = true;
        Promise.all(tasks).finally(() => (loading.current = false));
      }
    }
  }, [authStatus.status, currentMembershipPlan, userInfo]);

  if (authStatus.status === 'logged_out') {
    return (
      <div className='flex items-center gap-4'>
        <Button onClick={handleLoginClick} variant='ghost' size='sm' className='btn ins-btn-primary'>
          登录/注册
        </Button>
      </div>
    );
  }

  const handlePoint = (type: string, fullScreen: boolean = false) => {
    // 延迟执行，等待 Radix UI 的 DropdownMenu 把焦点移出，防止 aria-hidden 报错
    setTimeout(async () => {
      if (type === 'point') {
        setPointVisible(true);
        return;
      }

      if (type === 'detail') {
        if (isLandingMobile()) {
          openDialog(DesktopUnlockDialog, {});
        } else {
          setPointDetailVisible(true);
        }
        return;
      }

      await openGlobalDialog({
        type,
        fullScreen,
      });
    }, 300);
  };

  const handleMobileInviteReward = () => {
    setTimeout(() => {
      if (isLandingMobile()) {
        openDialog(DesktopUnlockDialog, {});
      } else {
        setInviteDialogOpen(true);
      }
    }, 300);
  };

  const handleMobileMessageCenter = () => {
    setTimeout(() => {
      void openMessageCenterDialog();
    }, 300);
  };

  const avatarUrl = userInfo?.avatarUrl || 'https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/20260731-113037-3fb3f4def4432a80.png';
  const displayName = userInfo?.userName || `User_${userInfo?.phoneNo?.slice(-4) || '0000'}`;
  const isCapacityExceeded = Boolean(capacity && capacity.limitCapacity > 0 && capacity.usedCapacity > capacity.limitCapacity);
  const capacityPercent = capacity && capacity.limitCapacity > 0 ? Math.round((capacity.usedCapacity / capacity.limitCapacity) * 100) : 0;
  const capacityProgress = capacity && capacity.limitCapacity > 0 ? Math.min(100, (capacity.usedCapacity / capacity.limitCapacity) * 100) : 0;

  const refreshMenuData = () => {
    refreshCapacity();
    refreshMembershipPlan();
    void refreshProfileForEdit(true);
  };

  const renderAvatarTrigger = () => (
    <div className='cursor-pointer flex gap-2'>
      <Avatar className='w-8 h-8'>
        <AvatarImage className='rounded-full border-2 border-white/10 ' src={compressImage(avatarUrl, 64)} alt='user avatar' />
      </Avatar>
    </div>
  );

  const renderUserSummary = () => (
    <div className='flex items-center gap-2'>
      <Avatar className='w-8 h-8'>
        <AvatarImage src={compressImage(avatarUrl, 64)} alt='user avatar' />
      </Avatar>
      <div className='flex flex-col'>
        <div className='flex items-center gap-1'>
          <span className='text-sm font-bold text-[#fafafa]'>{displayName}</span>
          <span className='text-xs bg-white/25 text-white/95 px-2 rounded-lg border border-white/25'>{currentMembershipPlan?.membership_plan_name || '免费版'}</span>
        </div>
        <span className='text-xs text-white/65'>{userInfo?.phoneNo || '--'}</span>
      </div>
    </div>
  );

  const renderCapacity = () => (
    <div className='flex items flex-col gap-2'>
      <div className='flex flex-row justify-between w-[280px] max-w-full'>
        <div>
          资产库容量
          <span className={cn('text-xs font-normal pl-2', isCapacityExceeded ? 'text-[#F87171]' : 'text-white/65')}>已用{capacityPercent}%</span>
        </div>
        <div className={cn(isCapacityExceeded ? 'text-[#F87171]' : '')}>
          <span className='text-sm '>{capacity ? formatFileSize(capacity.usedCapacity, 1) : '0B'}</span>
          <span className='text-sm text-white/65 font-normal'>/{capacity ? formatFileSize(capacity.limitCapacity, 1) : '0B'}</span>
        </div>
      </div>
      <div className=''>
        <Progress
          value={capacityProgress}
          className='w-full h-[6px] bg-white/10'
          indicatorClassName={isCapacityExceeded ? 'bg-[linear-gradient(269deg,#FF5733_0%,#E33C64_97%)]' : 'bg-[linear-gradient(90deg,#3DA1FF_18%,#62EEFD_86%)]'}
        />
      </div>
    </div>
  );

  const renderFooter = () => (
    <div className='text-xs opacity-65 px-2 py-1 leading-5'>
      <p>AI功能由因赛AIGC大模型提供支持 | </p>
      <p>联系我们：dynsightaigc@gdinsight.com | </p>
      <p>ICP备案号：粤ICP备2022136248号 | </p>
      <p>网信算备：440113682565601240017号 | </p>
      <p>模型备案号：Guangdong-InsightAlGC-202507010058</p>
      <p className='flex items-center'>
        <img
          className='w-4 pr-1'
          src='https://web-gpt-assets-cdn.idealead.com/static-assets-tool/png/asset-8dfecad0dfcb3dc5.png?x-oss-process=image/auto-orient,1/resize,l_900,limit_1/format,webp'
        />
        <a href='https://beian.mps.gov.cn/#/query/webSearch?code=44011302005644' rel='noreferrer' target='_blank'>
          粤公网安备44011302005644号
        </a>
      </p>
    </div>
  );

  const menuItems: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    onSelect: () => void;
    mobileOnly?: boolean;
    hasTopDivider?: boolean;
  }> = [
    {
      key: 'profile',
      label: '个人主页',
      icon: <User className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => {
        navigate({ to: '/usercenter' });
      },
    },
    {
      key: 'points',
      label: t('auth.rechargePointsDescription'),
      icon: <Sparkles className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => handlePoint('point'),
    },
    {
      key: 'invite',
      label: '获取赛点',
      icon: <Gift className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: handleMobileInviteReward,
      mobileOnly: true,
    },
    {
      key: 'subscription',
      label: t('auth.rechargePointsTitle'),
      icon: <CreditCard className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => handlePoint('subscription', true),
    },
    {
      key: 'redeemCode',
      label: '活动兑换码',
      icon: <Ticket className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => setRedeemDialogOpen(true),
    },
    {
      key: 'detail',
      label: t('auth.purchaseDetails'),
      icon: <BadgeCheck className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => handlePoint('detail'),
    },
    {
      key: 'profileEdit',
      label: '用户信息',
      hasTopDivider: true,
      icon: profileEditLoading ? <Loader2 className='mr-2 h-4 w-4 animate-spin text-white/65' /> : <UserPen className='mr-2 h-4 w-4 text-white/65' />,
      onSelect: () => {
        void handleProfileEditClick();
      },
    },
    {
      key: 'message',
      label: '消息通知',
      icon: <Bell className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: handleMobileMessageCenter,
      mobileOnly: true,
    },
    {
      key: 'password',
      label: '密码设置',
      icon: <KeyRound className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => setPasswordDialogShow(true),
    },
    {
      key: 'tutorial',
      label: t('auth.tutorial'),
      icon: <ClipboardList className='mr-2 text-white/65 h-4 w-4' />,
      onSelect: () => window.open(TUTORIAL_URL, '_blank'),
    },
    {
      key: 'logout',
      label: t('auth.logout'),
      icon: <LogOut className='mr-2 text-red/65 h-4 w-4' />,
      onSelect: logout,
    },
  ];

  const renderDesktopDropdown = () => (
    <DropdownMenu
      onOpenChange={open => {
        if (open) {
          refreshMenuData();
        }
      }}
    >
      <DropdownMenuTrigger asChild>{renderAvatarTrigger()}</DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='border border-white/10'>
        <DropdownMenuLabel className='flex items-center gap-3 p-0 py-2 px-1'>{renderUserSummary()}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{renderCapacity()}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {menuItems
          .filter(item => !item.mobileOnly)
          .map(item => (
            <React.Fragment key={item.key}>
              {item.hasTopDivider && <DropdownMenuSeparator />}
              <DropdownMenuItem className={userMenuItemClassName} onSelect={item.onSelect}>
                {item.icon}
                <span>{item.label}</span>
              </DropdownMenuItem>
            </React.Fragment>
          ))}
        <DropdownMenuSeparator />
        {renderFooter()}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const renderMobileSheet = () => (
    <Sheet
      open={mobileMenuOpen}
      onOpenChange={open => {
        setMobileMenuOpen(open);
        if (open) {
          refreshMenuData();
        }
      }}
    >
      <SheetTrigger asChild>{renderAvatarTrigger()}</SheetTrigger>
      <SheetContent side='right' className='flex w-[86vw] max-w-[320px] flex-col border-l border-white/10 bg-popover p-0 text-popover-foreground'>
        <SheetTitle className='sr-only'>用户菜单</SheetTitle>
        <div className='border-b border-white/10 px-4 py-4'>{renderUserSummary()}</div>
        <div className='border-b border-white/10 px-4 py-4'>{renderCapacity()}</div>
        <div className='flex-1 overflow-y-auto p-2'>
          {menuItems.map(item => (
            <React.Fragment key={item.key}>
              {item.hasTopDivider && <div className='my-1 h-px bg-white/10' />}
              <button
                type='button'
                className='flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-2 text-sm outline-none transition-colors hover:bg-white/10 focus:bg-white/10 disabled:pointer-events-none disabled:opacity-50'
                onClick={() => {
                  setMobileMenuOpen(false);
                  item.onSelect();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className='border-t border-white/10 p-2'>{renderFooter()}</div>
      </SheetContent>
    </Sheet>
  );

  return (
    <div className='flex items-center gap-4'>
      {/* <Button variant='ghost' size='icon' onClick={toggleTheme}>
        <Sun className='h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0' />
        <Moon className='absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100' />
        <span className='sr-only'>Toggle theme</span>
      </Button> */}
      <PointDisplay
        isNormal={currentMembershipPlan?.membership_plan_code === 'NORMAL' || !currentMembershipPlan}
        planName={currentMembershipPlan?.membership_plan_name || '普通用户'}
      />
      <ResponsiveView mobileWrapper={renderMobileSheet} pcWrapper={renderDesktopDropdown} />
      <Dialog open={dialogShow} onOpenChange={setDialogShow}>
        <DialogContent className='sm:max-w-[600px]'>
          <DialogHeader>
            <DialogTitle>{t('auth.AccountManagement')}</DialogTitle>
          </DialogHeader>
          <AccountManagement></AccountManagement>
        </DialogContent>
      </Dialog>
      <PasswordSettingDialog open={passwordDialogShow} onOpenChange={setPasswordDialogShow} defaultPhone={userInfo?.phoneNo || ''} />
      <ProfileEditDialog open={profileDialogShow} profile={profileForEdit} userInfo={userInfo} onOpenChange={setProfileDialogShow} onSaved={handleProfileSaved} />
      <InviteRewardDialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen} />
      <RedeemCodeDialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen} />

      <Dialog open={pointDetailVisible} onOpenChange={setPointDetailVisible}>
        <DialogContent
          className='w-auto max-w-none gap-0 border-none bg-transparent p-0 shadow-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          overlayClassName='bg-black/80'
          showCloseButton={false}
        >
          <PopPointDetail onClose={() => setPointDetailVisible(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={pointVisible} onOpenChange={setPointVisible}>
        <DialogContent
          className='w-auto max-w-none gap-0 border-none bg-transparent p-0 shadow-none outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
          overlayClassName='bg-black/80'
          showCloseButton={false}
        >
          <PopPointV2 insufficientPoints={false} onClose={() => setPointVisible(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserMenu;
