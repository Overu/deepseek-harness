import { create } from 'zustand';

export interface UserData {
  id: number;
  userName: string;
  avatarUrl: string;
  phoneNo: string;
  email: string;
  inviteCode: string;
}

export interface MembershipPlan {
  user_membership_id: number;
  user_id: number;
  membership_plan_id: number;
  membership_plan_code: string;
  membership_plan_name: string;
  membership_plan_rank: number;
  plan_type: string;
  duration_type: string;
  duration_value: number;
  role_id: number;
  period_start: string;
  period_end: string;
  auto_renew: number;
  original_price: number;
  original_price_image_url: string;
  sale_price: number;
  sale_price_image_url: string;
  first_sub_price: number;
  first_sub_price_image_url: string;
  display_config: string;
  benefit_descriptions: {
    content: {
      desc: string;
      label: string;
    }[];
    sort_order: number;
    content_type: string;
  }[];
  ai_model_groups: {
    group_id: number;
    group_type: string;
    sort_order: number;
    remark: string;
  }[];
  ai_tool_groups: {
    group_id: number;
    group_type: string;
    sort_order: number;
    remark: string;
  }[];
  benefits: {
    benefit_code: string;
    benefit_name: string;
    string_value: string;
    effective_rule: string;
    expire_rule: string;
    remark: string;
  }[];
  status: string;
}

interface userStore {
  userInfo: UserData | null; // 积分值
  currentMembershipPlan: MembershipPlan | null; // 当前会员套餐
  actions: {
    setUserInfo: (info: UserData) => void; // 更新赛点的方法
    setCurrentMembershipPlan: (plan: MembershipPlan | null) => void; // 更新当前会员套餐的方法
  };
}

export const useUserStore = create<userStore>(set => ({
  userInfo: null,
  currentMembershipPlan: null,
  actions: {
    setUserInfo: (info: UserData) => set({ userInfo: info }),
    setCurrentMembershipPlan: (plan: MembershipPlan | null) => set({ currentMembershipPlan: plan }),
  },
}));
