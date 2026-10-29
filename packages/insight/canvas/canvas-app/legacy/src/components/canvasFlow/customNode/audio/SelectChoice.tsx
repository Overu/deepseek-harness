import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import FieldLayout from './FieldLayout';
import type { Choices } from './types';

export interface SelectOptionItem {
  value: string | number;
  label: string;
}

export interface SelectChoiceProps {
  id: string;
  label: string;
  value: string;
  options: SelectOptionItem[];
  onChange: (value: string | number) => void;
  placeholder?: string;
}

export const SelectChoice = ({ id, label, value, options, onChange, placeholder = '请选择' }: SelectChoiceProps) => {
  return (
    <FieldLayout id={id} label={label}>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className='border-0 bg-white/10'>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map(choice => (
            <SelectItem key={String(choice.value)} value={String(choice.value)}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldLayout>
  );
};

interface SelectChoiceWithOptionProps {
  option: Choices;
  value: string;
  onChange: (value: string | number) => void;
}

export const SelectChoiceWithOption = ({ option, value, onChange }: SelectChoiceWithOptionProps) => {
  return <SelectChoice id={`audio-${option.field}`} label={option.label} value={value} options={option.choices} onChange={onChange} />;
};

export default SelectChoice;
