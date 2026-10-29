import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { checkSmsCode, setPassword } from '@/api/auth';
import { PasswordInput } from '@/routes/login/components/PasswordInput';
import { PasswordChecklist } from '@/routes/login/components/PasswordChecklist';
import { useSmsCountdown } from '@/routes/login/hooks/useSmsCountdown';
import { isValidPassword, isValidPhone, passwordSchema, phoneSchema } from '@/routes/login/schemas';
import { redirectToPasswordLoginAfterReset } from '@/routes/login/utils/passwordResetRedirect';

const verifySchema = z.object({
  phone: phoneSchema,
  verificationCode: z.string().min(1, { message: '请输入验证码' }),
});

const passwordSchemaObject = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, { message: '请再次确认新密码' }),
  })
  .refine(values => values.password === values.confirmPassword, {
    message: '两次输入密码不一致',
    path: ['confirmPassword'],
  });

type VerifyValues = z.infer<typeof verifySchema>;
type PasswordValues = z.infer<typeof passwordSchemaObject>;

interface PasswordSettingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultPhone?: string;
}

export function PasswordSettingDialog({ open, onOpenChange, defaultPhone = '' }: PasswordSettingDialogProps) {
  const [step, setStep] = useState<'verify' | 'password'>('verify');
  const [phone, setPhone] = useState(defaultPhone);
  const [verificationCode, setVerificationCode] = useState('');
  const [passwordFormKey, setPasswordFormKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const { countdown, sending, sendCode, reset: resetSmsCountdown } = useSmsCountdown('UPDATE_PASSWORD');
  const verifyForm = useForm<VerifyValues>({
    resolver: zodResolver(verifySchema),
    mode: 'onChange',
    defaultValues: {
      phone: defaultPhone,
      verificationCode: '',
    },
  });
  const passwordForm = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchemaObject),
    mode: 'onChange',
    defaultValues: {
      password: '',
      confirmPassword: '',
    },
  });
  const verifyValues = verifyForm.watch();
  const passwordValue = passwordForm.watch('password');
  const confirmPasswordValue = passwordForm.watch('confirmPassword');
  const hasDefaultPhone = Boolean(defaultPhone);
  const canContinue = isValidPhone(verifyValues.phone) && Boolean(verifyValues.verificationCode) && !loading;
  const canSubmitPassword = useMemo(() => isValidPassword(passwordValue) && passwordValue === confirmPasswordValue && !loading, [confirmPasswordValue, loading, passwordValue]);

  useEffect(() => {
    if (!open) {
      setStep('verify');
      setPhone(defaultPhone);
      setVerificationCode('');
      verifyForm.reset({ phone: defaultPhone, verificationCode: '' });
      passwordForm.reset({ password: '', confirmPassword: '' });
      resetSmsCountdown();
    }
  }, [defaultPhone, open, passwordForm, resetSmsCountdown, verifyForm]);

  const sendSms = async () => {
    const valid = await verifyForm.trigger('phone');
    if (valid) {
      await sendCode(verifyForm.getValues('phone'));
    }
  };

  const submitVerify = async (values: VerifyValues) => {
    verifyForm.clearErrors();
    setLoading(true);
    try {
      const response: any = await checkSmsCode({
        phoneNumber: values.phone,
        scene: 'UPDATE_PASSWORD',
        code: values.verificationCode,
      });
      if (response.code === 'SUCCESS') {
        setPhone(values.phone);
        setVerificationCode(values.verificationCode);
        passwordForm.reset({ password: '', confirmPassword: '' });
        setPasswordFormKey(prev => prev + 1);
        setStep('password');
        return;
      }
      verifyForm.setError('verificationCode', { message: response.msg || '请输入正确的验证码' });
    } catch (error: any) {
      if (error.code === 'INVALID_VERIFICATION_CODE') {
        verifyForm.setError('verificationCode', { message: error.msg || '请输入正确的验证码' });
        return;
      }
      verifyForm.setError('root', { message: error.msg || error.message || '验证码校验失败，请稍后重试' });
    } finally {
      setLoading(false);
    }
  };

  const submitPassword = async (values: PasswordValues) => {
    setLoading(true);
    try {
      const response: any = await setPassword({
        phoneNo: phone,
        password: values.password,
        code: verificationCode,
      });
      if (response.code === 'SUCCESS') {
        toast.success('密码重置成功');
        await redirectToPasswordLoginAfterReset(phone);
      }
    } catch (error) {
      console.error('密码重置失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className='sm:max-w-[360px] bg-popover'
        showCloseButton={false}
        onPointerDownOutside={event => event.preventDefault()}
        onEscapeKeyDown={event => event.preventDefault()}
      >
        <button
          type='button'
          className='absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2'
          onClick={() => onOpenChange(false)}
          aria-label='关闭'
        >
          <X className='h-6 w-6' />
        </button>
        <DialogHeader>
          <DialogTitle className='pb-5'>密码设置</DialogTitle>
        </DialogHeader>

        {step === 'verify' && (
          <Form {...verifyForm}>
            <form onSubmit={verifyForm.handleSubmit(submitVerify)} className='space-y-4'>
              {hasDefaultPhone ? (
                <div className='flex h-6 items-center justify-center gap-1.5 text-xs'>
                  <span className='text-muted-foreground'>手机号</span>
                  <span className='font-medium text-foreground'>{verifyValues.phone}</span>
                  <span className='text-muted-foreground'>验证</span>
                </div>
              ) : (
                <FormField
                  control={verifyForm.control}
                  name='phone'
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input className='h-10 border-none bg-white/10' placeholder='请输入手机号' maxLength={11} {...field} />
                      </FormControl>
                      {(field.value || verifyForm.formState.touchedFields.phone) && <FormMessage />}
                    </FormItem>
                  )}
                />
              )}
              <FormField
                control={verifyForm.control}
                name='verificationCode'
                render={({ field }) => (
                  <FormItem>
                    <div className='flex items-center gap-2'>
                      <FormControl>
                        <Input placeholder='请输入验证码' className='h-10 flex-1  border-none bg-white/10' maxLength={6} {...field} />
                      </FormControl>
                      <Button
                        className='h-10 shrink-0 px-3 font-normal bg-white/10 hover:bg-white/20'
                        type='button'
                        variant='outline'
                        onClick={sendSms}
                        disabled={!isValidPhone(verifyValues.phone) || sending || countdown > 0}
                      >
                        {countdown > 0 ? `${countdown}秒后重发` : '获取验证码'}
                      </Button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type='submit' className='block w-full btn ins-btn-primary' disabled={!canContinue}>
                <div className='flex items-center justify-center'>{loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}下一步</div>
              </Button>
              {verifyForm.formState.errors.root?.message && <p className='text-center text-xs text-destructive'>{verifyForm.formState.errors.root.message}</p>}
            </form>
          </Form>
        )}

        {step === 'password' && (
          <Form {...passwordForm}>
            <form key={passwordFormKey} onSubmit={passwordForm.handleSubmit(submitPassword)} className='space-y-4' autoComplete='off'>
              <div className='text-center text-xs text-muted-foreground'>
                为 <span className='font-medium text-foreground'>{phone}</span> 账号重置密码
              </div>
              <FormField
                control={passwordForm.control}
                name='password'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <PasswordInput
                        inputName='menu-reset-new-value'
                        inputClassName='h-10 border-none bg-white/10'
                        placeholder='密码8-20位，含字母、数字'
                        autoComplete='off'
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={passwordForm.control}
                name='confirmPassword'
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <PasswordInput
                        inputName='menu-reset-confirm-value'
                        inputClassName='h-10 border-none bg-white/10'
                        placeholder='请再次确认新密码'
                        autoComplete='off'
                        {...field}
                        value={field.value || ''}
                      />
                    </FormControl>
                    {(passwordValue || field.value || passwordForm.formState.touchedFields.confirmPassword) && (
                      <PasswordChecklist password={passwordValue} confirmPassword={field.value} showConfirm />
                    )}
                  </FormItem>
                )}
              />
              <Button type='submit' className='block w-full btn ins-btn-primary' disabled={!canSubmitPassword}>
                <div className='flex items-center justify-center'>{loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}下一步</div>
              </Button>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}
