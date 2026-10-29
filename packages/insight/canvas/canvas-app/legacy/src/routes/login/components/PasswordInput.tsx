import { forwardRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface PasswordInputProps extends Omit<InputProps, 'type'> {
  inputClassName?: string;
  inputName?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(({ className, inputClassName, inputName, autoComplete = 'new-password', ...props }, ref) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className={cn('relative', className)}>
      <Input {...props} ref={ref} name={inputName || props.name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} className={cn('pr-10', inputClassName)} />
      <button
        type='button'
        className='absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground'
        onClick={() => setVisible(prev => !prev)}
        tabIndex={-1}
        aria-label={visible ? '隐藏密码' : '显示密码'}
      >
        {visible ? <Eye className='h-4 w-4' /> : <EyeOff className='h-4 w-4' />}
      </button>
    </div>
  );
});

PasswordInput.displayName = 'PasswordInput';
