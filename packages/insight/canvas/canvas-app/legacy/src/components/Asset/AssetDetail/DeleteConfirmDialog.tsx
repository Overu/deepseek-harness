import React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface DeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  onConfirm: () => void;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({ open, onOpenChange, submitting, onConfirm }) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className='bg-[#0A0A0A] border border-white/10 text-white'>
      <AlertDialogHeader>
        <AlertDialogTitle className='flex items-center gap-2'>确认删除该资产？</AlertDialogTitle>
        <AlertDialogDescription className='text-white/60'>删除后无法恢复</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
        <AlertDialogAction asChild>
          <Button
            variant='destructive'
            disabled={submitting}
            onClick={e => {
              e.preventDefault();
              onConfirm();
            }}
            className='gap-2'
          >
            {submitting ? '删除中...' : '确认'}
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
