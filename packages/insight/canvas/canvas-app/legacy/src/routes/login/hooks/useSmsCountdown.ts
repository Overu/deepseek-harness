import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { sendSmsCode, type SmsCodeRequest } from '@/api/auth';

export function useSmsCountdown(scene: SmsCodeRequest['scene']) {
  const [countdown, setCountdown] = useState(0);
  const [sending, setSending] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startCountdown = useCallback(() => {
    clearTimer();
    setCountdown(60);
    timerRef.current = window.setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [clearTimer]);

  const reset = useCallback(() => {
    clearTimer();
    setCountdown(0);
    setSending(false);
  }, [clearTimer]);

  const sendCode = useCallback(
    async (phoneNumber: string) => {
      if (countdown > 0 || sending) {
        return false;
      }

      setSending(true);
      try {
        await sendSmsCode({ scene, phoneNumber });
        startCountdown();
        toast.success('验证码已发送');
        return true;
      } catch (error) {
        console.error('发送验证码失败:', error);
        // toast.error('发送验证码失败，请稍后再试');
        return false;
      } finally {
        setSending(false);
      }
    },
    [countdown, scene, sending, startCountdown]
  );

  useEffect(() => clearTimer, [clearTimer]);

  return {
    countdown,
    sending,
    canSend: countdown === 0 && !sending,
    sendCode,
    reset,
  };
}
