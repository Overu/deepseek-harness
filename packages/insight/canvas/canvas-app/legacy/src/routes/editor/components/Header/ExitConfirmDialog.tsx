import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

interface ExitConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmSave: () => Promise<boolean>;
  onDirectExit: () => void;
}

export const ExitConfirmDialog: React.FC<ExitConfirmDialogProps> = ({ open, onOpenChange, onConfirmSave, onDirectExit }) => {
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await onConfirmSave();
    } catch (error) {
      console.error('Save failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={val => !loading && onOpenChange(val)}>
      <DialogContent className='sm:max-w-[425px] select-none'>
        <DialogHeader>
          <DialogTitle className='text-base'>退出编辑器</DialogTitle>
        </DialogHeader>
        <div className='py-4'>
          <div className='text-sm'>发现未保存的更改，需要保存后再退出么？</div>
        </div>
        <DialogFooter className='gap-2 sm:gap-0 mt-2'>
          <div className='flex w-full justify-end items-center'>
            <div className='flex gap-2'>
              <Button variant='outline' onClick={onDirectExit} disabled={loading} className='text-white/60 hover:text-white'>
                直接退出
              </Button>
              <Button className='btn ins-btn-primary' onClick={handleSave} disabled={loading}>
                {loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
                保存并退出
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
