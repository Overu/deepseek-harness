import { isMusicCover, isMusicGen, isTTS } from './types';
import type { MusicCoverAudioNodeParams, MusicGenAudioNodeParams, SeniorParamerter, TTSAudioNodeParams } from './types';
import { SliderNumberWithOption } from './SliderNumber';
import { SelectChoiceWithOption } from './SelectChoice';
import { useMemo } from 'react';
import { createAgentEditorDebounce } from '../../../../../../src/agent-editor-debounce';
import { InputLimit, TextareaLimit } from './InputLimit';

interface SeniorParamsProps {
  nodeId: string;
  seniorParamsOption: SeniorParamerter[];
  onSelectChange: (key: string, value: any) => void;
}

interface TtsSeniorParamsProps extends SeniorParamsProps {
  params: TTSAudioNodeParams;
}
interface CoverSeniorParamsProps extends SeniorParamsProps {
  params: MusicCoverAudioNodeParams;
  instrumental: boolean;
}
interface GenSeniorParamsProps extends SeniorParamsProps {
  params: MusicGenAudioNodeParams;
  instrumental: boolean;
}

export const SeniorField = ({ value, option, onSelectChange }: { value: unknown; option: SeniorParamerter; onSelectChange: (key: string, value: any) => void }) => {
  if (option.type === 'number' && typeof value === 'number') {
    return (
      <SliderNumberWithOption key={option.field} option={option} value={value ?? option.default} onChange={next => onSelectChange('seniorParams', { [option.field]: next })} />
    );
  }
  if (option.type === 'choices' && option.choices.length && typeof value === 'string') {
    return (
      <SelectChoiceWithOption key={option.field} option={option} value={value ?? option.default} onChange={next => onSelectChange('seniorParams', { [option.field]: next })} />
    );
  }
  return null;
};

export const TtsSeniorParams = ({ params, seniorParamsOption, onSelectChange }: TtsSeniorParamsProps) => {
  if (!isTTS(params)) {
    return null;
  }
  return (
    <div className='space-y-5 border-t border-white/25 px-4 py-5'>
      {seniorParamsOption.map(options => (
        <SeniorField key={options.field} value={params.seniorParams[options.field as keyof TTSAudioNodeParams['seniorParams']]} option={options} onSelectChange={onSelectChange} />
      ))}
    </div>
  );
};

export const CoverSeniorParams = ({ nodeId, params, instrumental, seniorParamsOption, onSelectChange }: CoverSeniorParamsProps) => {
  const persistTitle = useMemo(() => createAgentEditorDebounce(`${nodeId}:title`, (value: string) => onSelectChange('seniorParams', { title: value }), 500), [nodeId, onSelectChange]);
  const persistLyrics = useMemo(() => createAgentEditorDebounce(`${nodeId}:lyrics`, (value: string) => onSelectChange('seniorParams', { lyrics: value }), 500), [nodeId, onSelectChange]);
  if (!isMusicCover(params)) {
    return null;
  }

  return (
    <div className='space-y-5 border-t border-white/25 px-4 py-5'>
      <InputLimit id='music-title' label='歌曲标题' value={params.seniorParams.title} maxLength={100} required onChange={persistTitle} />
      {!instrumental && <TextareaLimit id='music-lyrics' label='歌词' value={params.seniorParams.lyrics} maxLength={500} required onChange={persistLyrics} />}
      {seniorParamsOption
        .filter(options => !(instrumental && options.field === 'vocalGender'))
        .map(options => (
          <SeniorField
            key={options.field}
            value={params.seniorParams[options.field as keyof MusicCoverAudioNodeParams['seniorParams']]}
            option={options}
            onSelectChange={onSelectChange}
          />
        ))}
    </div>
  );
};

// 先分成两个组件，看后续需求是否有变化
export const GenSeniorParams = ({ nodeId, params, seniorParamsOption, instrumental, onSelectChange }: GenSeniorParamsProps) => {
  const persistTitle = useMemo(() => createAgentEditorDebounce(`${nodeId}:title`, (value: string) => onSelectChange('seniorParams', { title: value }), 500), [nodeId, onSelectChange]);
  const persistLyrics = useMemo(() => createAgentEditorDebounce(`${nodeId}:lyrics`, (value: string) => onSelectChange('seniorParams', { lyrics: value }), 500), [nodeId, onSelectChange]);
  if (!isMusicGen(params)) {
    return null;
  }

  return (
    <div className='space-y-5 border-t border-white/25 px-4 py-5'>
      <InputLimit id='music-title' label='歌曲标题' value={params.seniorParams.title} maxLength={100} required onChange={persistTitle} />
      {!instrumental && <TextareaLimit id='music-lyrics' label='歌词' value={params.seniorParams.lyrics} maxLength={500} required onChange={persistLyrics} />}
      {seniorParamsOption
        .filter(options => !(instrumental && options.field === 'vocalGender'))
        .map(options => (
          <SeniorField
            key={options.field}
            value={params.seniorParams[options.field as keyof MusicGenAudioNodeParams['seniorParams']]}
            option={options}
            onSelectChange={onSelectChange}
          />
        ))}
    </div>
  );
};
