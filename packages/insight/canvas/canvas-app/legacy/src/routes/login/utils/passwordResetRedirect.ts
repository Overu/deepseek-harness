import { logout as apiLogout } from '@/api/auth';
import { clearStoredAccessToken } from '@/utils/authSession';

const PASSWORD_RESET_LOGIN_PHONE_KEY = 'passwordResetLoginPhone';

const preserveLocalStorage = () => {
  const theme = localStorage.getItem('theme');
  const announcementCache = localStorage.getItem('insight_announcement_cache');

  localStorage.clear();

  if (theme) {
    localStorage.setItem('theme', theme);
  }
  if (announcementCache) {
    localStorage.setItem('insight_announcement_cache', announcementCache);
  }
};

const clearBrowserCookies = () => {
  document.cookie.split(';').forEach(cookie => {
    const [name] = cookie.split('=');
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  });
};

export const redirectToPasswordLoginAfterReset = async (phone: string) => {
  try {
    await apiLogout();
  } catch (error) {
    console.warn('密码重置后退出登录失败，继续清理本地登录态:', error);
  } finally {
    clearStoredAccessToken();
    preserveLocalStorage();
    clearBrowserCookies();

    const searchParams = new URLSearchParams({
      tab: 'password',
    });

    if (phone) {
      sessionStorage.setItem(PASSWORD_RESET_LOGIN_PHONE_KEY, phone);
    }

    window.location.href = `/login?${searchParams.toString()}`;
  }
};

export const consumePasswordResetLoginPhone = () => {
  const phone = sessionStorage.getItem(PASSWORD_RESET_LOGIN_PHONE_KEY) || '';
  sessionStorage.removeItem(PASSWORD_RESET_LOGIN_PHONE_KEY);
  return phone;
};
