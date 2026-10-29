import { useCallback } from 'react';

import type { UserMessage } from '@/api/message';
import UserPrivacy from '@/assets/aggrements/userPrivacy_zh_cn.html?url';
import UserService from '@/assets/aggrements/userService_zh_cn.html?url';
import { openGlobalDialog } from '@/components/popPay/payPop';

const STATIC_MESSAGE_ACTIONS = new Set(['user-service', 'privacy-policy', 'wallet-detail', 'work-detail', 'membership-subscription', 'membership-benefits', 'profile-self']);

export function useOfficialMessageAction(markOneRead: (message: UserMessage) => void | Promise<void>) {
  return useCallback(
    (message: UserMessage, element: HTMLAnchorElement) => {
      const action = element.getAttribute('insight-message-action');
      const value = element.getAttribute('insight-message-action-value') ?? undefined;

      if (!action || !STATIC_MESSAGE_ACTIONS.has(action)) {
        return;
      }

      void markOneRead(message);

      switch (action) {
        case 'user-service':
          window.open(UserService, '_blank', 'noopener,noreferrer');
          return;
        case 'privacy-policy':
          window.open(UserPrivacy, '_blank', 'noopener,noreferrer');
          return;
        case 'wallet-detail':
          void openGlobalDialog({ type: 'detail' });
          return;
        case 'membership-subscription':
        case 'membership-benefits':
          void openGlobalDialog({ type: 'subscription', fullScreen: true });
          return;
        case 'work-detail':
          window.open(`/community/works/${value}`, '_blank', 'noopener,noreferrer');
          return;
        case 'profile-self':
          window.open('/usercenter', '_blank', 'noopener,noreferrer');
      }
    },
    [markOneRead]
  );
}
