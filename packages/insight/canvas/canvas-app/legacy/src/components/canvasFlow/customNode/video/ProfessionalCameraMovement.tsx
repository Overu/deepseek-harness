import React, { useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Check from '../../components/promptControl/Check';
import { CameraMovementLibraryDialog } from './CameraMovementLibraryDialog';
import type { CameraMovementParam } from './cameraMovementTypes';

interface ProfessionalCameraMovementProps {
  value?: CameraMovementParam | null;
  onChange: (value: CameraMovementParam) => void;
}

const ProfessionalCameraMovement: React.FC<ProfessionalCameraMovementProps> = ({ value, onChange }) => {
  const [isEnabled, setIsEnabled] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setIsEnabled(Boolean(value?.enable));
  }, [value?.enable]);

  const handleToggleEnable = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newEnabled = !isEnabled;
    setIsEnabled(newEnabled);
    onChange({
      enable: newEnabled,
      name: value?.name,
      text: value?.text,
    });
  };

  const handleSelect = (payload: { name: string; text: string }) => {
    onChange({
      enable: true,
      name: payload.name,
      text: payload.text,
    });
    setIsEnabled(true);
  };

  return (
    <>
      <div className='relative inline-flex flex-col items-center'>
        <TooltipProvider>
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Check checked={isEnabled} label='专业运镜' onClick={() => setDialogOpen(true)} onSwitchClick={handleToggleEnable} />
            </TooltipTrigger>
            <TooltipContent side='top' className='bg-black border-white/10 text-white px-4 py-2 shadow-2xl mb-2 rounded-xl'>
              <div className='flex items-center text-[13px] whitespace-nowrap tracking-wide'>
                <span className='text-white/65'>运镜类型</span>
                <span className='mx-2 text-white/95'>{value?.name || '-'}</span>
                <span className={`ml-4 ${isEnabled ? 'text-[#4155F0]' : 'text-gray-500'}`}>{isEnabled ? '已开启' : '未开启'}</span>
              </div>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {dialogOpen ? <CameraMovementLibraryDialog open={dialogOpen} onOpenChange={setDialogOpen} currentText={value?.text} onSelect={handleSelect} /> : null}
    </>
  );
};

export default ProfessionalCameraMovement;
