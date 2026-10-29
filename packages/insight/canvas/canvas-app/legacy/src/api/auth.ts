import { request } from './request';

export interface SmsCodeRequest {
  scene: 'LOGIN' | 'REGISTER' | 'UPDATE_PASSWORD' | 'CHANGE_PHONE';
  phoneNumber: string;
}

export interface PhoneCodeLoginRequest {
  type: 'PHONE_NUM';
  info: {
    phoneNo: string;
    code: string;
  };
  inviteCode?: string;
}

export interface PhonePasswordLoginRequest {
  type: 'PHONE_PASS';
  info: {
    phoneNo: string;
    password: string;
    uuid: string;
    imgCode: string;
  };
  inviteCode?: string;
}

export type LoginRequest = PhoneCodeLoginRequest | PhonePasswordLoginRequest;

export interface RegisterRequest {
  type: 'PHONE_PASS';
  inviteCode?: string;
  info: {
    phoneNo: string;
    code: string;
    password: string;
  };
}

export interface SetPasswordRequest {
  phoneNo: string;
  password: string;
  code: string;
}

export interface CaptchaImageData {
  img?: string;
  src?: string;
  uuid: string;
}

export interface VerifyPasswordSmsCodeRequest {
  phoneNo: string;
  code: string;
}

export interface CheckSmsCodeRequest {
  phoneNumber: string;
  scene: SmsCodeRequest['scene'];
  code: string;
}

export interface LoginResponse {
  code: string;
  msg: string;
  data: {
    accessTokenExpiredSeconds: number;
    accessToken: string;
  };
}

export interface InviteInfo {
  inviteCode: string;
  inviteLink: string;
  inviteCount: number;
}

export interface UserProfileData {
  user_id: number;
  user_name: string;
  avatar_url: string;
  signature: string;
  work_total: number;
  like_total: number;
  favorite_total: number;
  follower_total: number;
  following_total: number;
  followed: boolean;
}

const loginHeader = {
  headers: {
    extinfo: JSON.stringify({ client_type: 'PC' }),
  },
  credentials: 'include' as RequestCredentials,
};

/**
 * 发送短信验证码
 * @param params 短信请求参数
 */
export const sendSmsCode = (params: SmsCodeRequest) => {
  return request('user-server/mobile/getSmsCode', params, loginHeader);
};

/**
 * 手机号登录
 * @param params 登录请求参数
 */
export const phoneLogin = (params: LoginRequest) => {
  return request<LoginResponse>('user-server/loginV3', params, loginHeader);
};

export const getCaptchaImage = () => {
  return request<CaptchaImageData>('user-server/captcha/captchaImage', null, {
    ...loginHeader,
    method: 'get',
  });
};

export const register = (params: RegisterRequest) => {
  return request<LoginResponse>('user-server/register', params, {
    ...loginHeader,
    silentError: true,
  });
};

export const setPassword = (params: SetPasswordRequest) => {
  return request('user-server/setPassword', params, loginHeader);
};

export interface UpdateUserParams {
  avatarUrl: string;
  signature: string;
  id: number;
  userName: string;
}

// 编辑用户信息
export const updateUser = (params: UpdateUserParams) => {
  return request('user-server/updateUser', params);
};

export const checkSmsCode = (params: CheckSmsCodeRequest) => {
  return request<boolean>('user-server/mobile/checkSmsCode', params, {
    ...loginHeader,
    silentError: true,
  });
};

export const verifyPasswordSmsCode = async (params: VerifyPasswordSmsCodeRequest) => {
  return checkSmsCode({
    phoneNumber: params.phoneNo,
    scene: 'UPDATE_PASSWORD',
    code: params.code,
  });
};

/**
 * 刷新token
 */
export const refreshToken = () => {
  return request<LoginResponse>('user-server/refresh', null, Object.assign({}, loginHeader, { method: 'get' }));
};

/**
 * 用户登出
 */
export const logout = () => {
  return request(`user-server/logout`, null, {
    ...loginHeader,
    method: 'get',
    authRedirect: 'never',
  });
};

export const queryObsConfig = () => request<any>('multi-agent-center/iam/get/temp/key');

export const userDeregister = () => request<any>('user-server/deregister');

/**
 * 用户登出
 * @param token 用户token
 */
export const getUserInfo = () => {
  return request(`user-server/getUserDetail`, null, {
    method: 'get',
  });
};

export const getInviteInfo = () => {
  return request<InviteInfo>('/user-server/inviteInfo', null, {
    method: 'GET',
  });
};

export const getUserProfile = (userId: number | string) => {
  return request<UserProfileData>(`/community-service/api/users/${userId}/profile`, null, {
    method: 'GET',
  });
};

export interface SignInClockData {
  signedToday: boolean;
  canSignIn: boolean;
  signInRedDot: boolean;
  signInDay: number;
  nextSignInDay: number;
  serverDate: string;
}

export interface ApiResponse<T> {
  code?: string | number;
  msg?: string;
  message?: string;
  data?: T;
  body?: T;
  success?: boolean;
}

export const signInReward = () => {
  return request('user-server/signIn', undefined, {
    silentError: true,
    method: 'get',
  });
};

export const signInClock = () => {
  return request<SignInClockData>('user-server/signIn/status', undefined, {
    silentError: true,
    method: 'get',
  }) as Promise<ApiResponse<SignInClockData>>;
};

export const markInviteFriendClicked = () => {
  return request('user-server/inviteFriendClick', undefined, {
    silentError: true,
    method: 'get',
  });
};
