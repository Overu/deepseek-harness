import { useEffect, useState, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import FieldLayout from './FieldLayout';

interface InputLimitProps {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
  onChange: (value: string) => void;
}

export const InputLimit = ({ id, label, value = '', placeholder = '请输入', maxLength, required = false, onChange }: InputLimitProps) => {
  const [localValue, setLocalValue] = useState(value);
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setLocalValue(event.target.value);
    onChange(event.target.value);
  };

  return (
    <FieldLayout id={id} label={label} required={required}>
      <div className='relative'>
        <Input
          id={id}
          value={localValue}
          placeholder={placeholder}
          className='border-0 bg-white/10 pr-16'
          onChange={handleChange}
          maxLength={maxLength}
          onFocus={() => {
            isFocused.current = true;
          }}
          onBlur={() => {
            isFocused.current = false;
            setLocalValue(value);
          }}
        />
        <span className='pointer-events-none absolute bottom-2 right-3 text-xs text-white/35'>
          {localValue.length} / {maxLength}
        </span>
      </div>
    </FieldLayout>
  );
};

interface TextareaLimitProps {
  id: string;
  label: string;
  value?: string;
  placeholder?: string;
  maxLength: number;
  required?: boolean;
  rows?: number;
  onChange: (value: string) => void;
}

export const TextareaLimit = ({ id, label, value = '', placeholder = '请输入', maxLength, required = false, rows = 6, onChange }: TextareaLimitProps) => {
  const [localValue, setLocalValue] = useState(value);
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current) {
      setLocalValue(value);
    }
  }, [value]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setLocalValue(event.target.value);
    onChange(event.target.value);
  };

  return (
    <FieldLayout id={id} label={label} required={required}>
      <div className='relative'>
        <Textarea
          id={id}
          value={localValue}
          rows={rows}
          placeholder={placeholder}
          preventWheelZoom
          className='nowheel resize-none border-0 bg-white/10 pb-7'
          onKeyDown={event => event.stopPropagation()}
          onChange={handleChange}
          maxLength={maxLength}
          onFocus={() => {
            isFocused.current = true;
          }}
          onBlur={() => {
            isFocused.current = false;
            setLocalValue(value);
          }}
        />
        <span className='pointer-events-none absolute bottom-2 right-3 text-xs text-white/35'>
          {localValue.length} / {maxLength}
        </span>
      </div>
    </FieldLayout>
  );
};
