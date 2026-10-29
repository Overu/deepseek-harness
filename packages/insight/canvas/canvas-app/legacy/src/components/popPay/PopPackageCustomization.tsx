import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { InflowRecord } from '@/api/portal';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface PopPackageCustomizationProps {
  open: boolean;
  onClose: () => void;
}

type FormValues = {
  userName: string;
  phoneNo: string;
  email: string;
  companyName: string;
  position: string;
  teamSize: string;
  requirementDesc: string;
};

type InflowRecordResponse = {
  code?: string | number;
  message?: string;
  msg?: string;
};

const TEAM_SIZE_OPTIONS = ['20人以下', '21-50人', '51-100人', '101-500人', '500人以上'];
const phoneRegex = /^1[3-9]\d{9}$/;
const emailRegex = /^[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

const INITIAL_FORM_VALUES: FormValues = {
  userName: '',
  phoneNo: '',
  email: '',
  companyName: '',
  position: '',
  teamSize: '',
  requirementDesc: '',
};

const packageCustomizationSchema = z.object({
  companyName: z.string().trim().max(100, { message: '公司名称不能超过100个字符' }),
  teamSize: z.string().trim().min(1, { message: '请选择企业规模' }),
  userName: z.string().trim().min(1, { message: '请输入联系人姓名' }).max(50, { message: '联系人姓名不能超过50个字符' }),
  phoneNo: z.string().trim().min(1, { message: '请输入手机号码' }).regex(phoneRegex, { message: '请输入正确的11位手机号码' }),
  position: z.string().trim().max(50, { message: '您的职位不能超过50个字符' }),
  email: z.string().trim().min(1, { message: '请输入联系邮箱' }).max(100, { message: '联系邮箱不能超过100个字符' }).regex(emailRegex, { message: '请输入正确的邮箱格式' }),
  requirementDesc: z.string().trim().min(1, { message: '请输入需求说明' }).max(500, { message: '需求说明不能超过500个字符' }),
});

export default function PopPackageCustomization({ open, onClose }: PopPackageCustomizationProps) {
  const [submitting, setSubmitting] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(packageCustomizationSchema),
    mode: 'onChange',
    reValidateMode: 'onChange',
    criteriaMode: 'all',
    defaultValues: INITIAL_FORM_VALUES,
  });
  const errors = form.formState.errors;
  const phoneField = form.register('phoneNo');

  const resetForm = () => {
    form.reset(INITIAL_FORM_VALUES);
  };

  const handleClose = () => {
    if (submitting) {
      return;
    }

    resetForm();
    onClose();
  };

  const handleSubmit = async (values: FormValues) => {
    const sanitizedValues: FormValues = {
      userName: values.userName.trim(),
      phoneNo: values.phoneNo.trim(),
      email: values.email.trim().toLowerCase(),
      companyName: values.companyName.trim(),
      position: values.position.trim(),
      teamSize: values.teamSize.trim(),
      requirementDesc: values.requirementDesc.trim(),
    };
    setSubmitting(true);
    try {
      const response = (await InflowRecord({
        ...sanitizedValues,
        userType: 3,
      })) as InflowRecordResponse;

      if (response?.code === 'SUCCESS') {
        toast.success('提交成功，我们将尽快与您联系');
        resetForm();
        onClose();
        return;
      }

      toast.error(response?.msg || response?.message || '提交失败，请稍后重试');
    } catch {
      toast.error('提交发生错误，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClassName = (field: keyof FormValues) =>
    cn(
      'mt-2 h-9 w-full rounded-md border bg-[#111418] px-3 text-sm text-white outline-none transition-all duration-200 placeholder:text-white/22 focus:border-[#5d82ff]/70 focus:bg-[#121820] focus:shadow-[0_0_0_3px_rgba(89,117,255,0.12)]',
      errors[field] ? 'border-[#ff6b6b]/70' : 'border-white/8'
    );

  const renderError = (field: keyof FormValues) => {
    const message = errors[field]?.message;
    if (!message) {
      return null;
    }

    return <p className='mt-1 text-[11px] leading-none text-[#ff8a8a]'>{message}</p>;
  };

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className='max-w-[560px] gap-0 overflow-hidden rounded-lg border border-white/12 bg-[#202020] p-0 text-white shadow-[0_24px_80px_rgba(0,0,0,0.55)] mobile:w-[calc(100vw-32px)]'
        overlayClassName='bg-black/80'
      >
        <motion.form
          className='relative bg-[linear-gradient(180deg,#222_0%,#222_42%,#29355f_100%)] px-5 pb-5 pt-4'
          onSubmit={form.handleSubmit(handleSubmit)}
          noValidate
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        >
          <button
            type='button'
            className='absolute right-5 top-4 rounded-md p-1 text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white'
            onClick={handleClose}
            disabled={submitting}
            aria-label='关闭'
          >
            <X size={20} />
          </button>

          <h3 className='m-0 text-base font-semibold leading-6 text-white'>套餐定制申请</h3>

          <div className='mt-6 grid grid-cols-2 gap-x-4 gap-y-3 mobile:grid-cols-1'>
            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              公司名称
              <input {...form.register('companyName')} placeholder='请输入' maxLength={100} className={inputClassName('companyName')} />
              {renderError('companyName')}
            </label>

            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              <span className='text-[#ff7f7f]'>* </span>企业规模
              <Select value={form.watch('teamSize')} onValueChange={value => form.setValue('teamSize', value, { shouldDirty: true, shouldTouch: true, shouldValidate: true })}>
                <SelectTrigger className={cn(inputClassName('teamSize'), 'justify-between data-placeholder:text-white/22')}>
                  <SelectValue placeholder='请选择' />
                </SelectTrigger>
                <SelectContent className='border-white/10 bg-[#171b22] text-white'>
                  {TEAM_SIZE_OPTIONS.map(option => (
                    <SelectItem key={option} value={option} className='focus:bg-[#2c385f] focus:text-white'>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {renderError('teamSize')}
            </label>

            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              <span className='text-[#ff7f7f]'>* </span>联系人姓名
              <input {...form.register('userName')} placeholder='请输入' maxLength={50} className={inputClassName('userName')} />
              {renderError('userName')}
            </label>

            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              <span className='text-[#ff7f7f]'>* </span>手机号码
              <input
                {...phoneField}
                type='tel'
                inputMode='numeric'
                placeholder='请输入'
                maxLength={11}
                onChange={event => {
                  event.target.value = event.target.value.replace(/\D/g, '').slice(0, 11);
                  void phoneField.onChange(event);
                }}
                className={inputClassName('phoneNo')}
              />
              {renderError('phoneNo')}
            </label>

            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              您的职位
              <input {...form.register('position')} placeholder='请输入' maxLength={50} className={inputClassName('position')} />
              {renderError('position')}
            </label>

            <label className='block text-xs mobile:text-sm font-semibold text-white/82'>
              <span className='text-[#ff7f7f]'>* </span>联系邮箱
              <input {...form.register('email')} type='text' inputMode='email' autoComplete='email' placeholder='请输入' maxLength={100} className={inputClassName('email')} />
              {renderError('email')}
            </label>

            <label className='col-span-2 block text-xs mobile:text-sm font-semibold text-white/82 mobile:col-span-1'>
              <span className='text-[#ff7f7f]'>* </span>需求说明
              <textarea {...form.register('requirementDesc')} placeholder='请输入' maxLength={500} className={cn(inputClassName('requirementDesc'), 'h-16 resize-none py-2')} />
              {renderError('requirementDesc')}
            </label>
          </div>

          <div className='mt-5 flex justify-end'>
            <Button
              type='submit'
              disabled={submitting}
              className='h-9 mobile:w-full rounded-md bg-[#4868ff] px-6 text-xs font-semibold text-white transition-all duration-200 hover:bg-[#5a78ff] hover:shadow-[0_8px_18px_rgba(72,104,255,0.32)] active:scale-[0.98]'
            >
              <AnimatePresence mode='wait' initial={false}>
                {submitting ? (
                  <motion.span
                    key='submitting'
                    className='inline-flex items-center gap-1.5'
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                  >
                    <Loader2 className='animate-spin' size={14} />
                    提交中
                  </motion.span>
                ) : (
                  <motion.span key='idle' initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                    确认提交
                  </motion.span>
                )}
              </AnimatePresence>
            </Button>
          </div>
        </motion.form>
      </DialogContent>
    </Dialog>
  );
}
