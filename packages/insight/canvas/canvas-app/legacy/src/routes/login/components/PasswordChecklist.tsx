import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasPasswordLetterAndNumber, isValidPasswordLength } from '../schemas';

interface PasswordChecklistProps {
  password: string;
  confirmPassword?: string;
  showConfirm?: boolean;
}

function RuleItem({ passed, children }: { passed: boolean; children: React.ReactNode }) {
  const Icon = passed ? Check : X;
  return (
    <div className={cn('flex items-center gap-1 text-xs', passed ? 'text-emerald-500' : 'text-red-500')}>
      <Icon className='h-3 w-3' />
      <span>{children}</span>
    </div>
  );
}

export function PasswordChecklist({ password, confirmPassword = '', showConfirm = false }: PasswordChecklistProps) {
  return (
    <div className='mt-2 space-y-1'>
      <RuleItem passed={isValidPasswordLength(password)}>8-20位字符</RuleItem>
      <RuleItem passed={hasPasswordLetterAndNumber(password)}>包含字母和数字</RuleItem>
      {showConfirm && <RuleItem passed={Boolean(confirmPassword) && password === confirmPassword}>两次输入密码一致</RuleItem>}
    </div>
  );
}
