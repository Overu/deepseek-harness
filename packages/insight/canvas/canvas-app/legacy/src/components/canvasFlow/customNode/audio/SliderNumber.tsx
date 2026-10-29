import { Slider } from '@/components/ui/slider';
import FieldLayout from './FieldLayout';
import type { Slider as SliderOption } from './types';

export interface SliderNumberProps {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}

export const SliderNumber = ({ id, label, value, min = 0, max = 100, step = 1, onChange }: SliderNumberProps) => {
  return (
    <FieldLayout id={id} label={label} extra={<span className='text-white/70'>{value}</span>}>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={next => onChange(next[0])} />
    </FieldLayout>
  );
};

interface SliderNumberWithOptionProps {
  option: SliderOption;
  value: number;
  onChange: (value: number) => void;
}

export const SliderNumberWithOption = ({ option, value, onChange }: SliderNumberWithOptionProps) => {
  return <SliderNumber id={`audio-${option.field}`} label={option.label} value={value} min={option.min} max={option.max} step={option.step} onChange={onChange} />;
};

export default SliderNumber;
