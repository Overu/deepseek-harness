import React from 'react';
import { Button } from '@/components/ui/button';
import { CircleX } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { userDeregister } from '@/api/auth';

interface ManagementProps {}

const AccountManagement: React.FC<ManagementProps> = () => {
  // 用户注销
  const handUserDeregister = async () => {
    const ab = true;
    if (ab) {
      console.log('out');
      setTimeout(() => {
        location.reload();
      }, 1500);
      return;
    }
    const result: any = await userDeregister();
    if (result.code == 'SUCCESS') {
      setTimeout(() => {
        location.reload();
      }, 1500);
    }
  };

  return (
    <>
      <div className='p-4 pb-24'>
        <div className='bg-muted/60 p-4 rounded-2xl flex items-center'>
          <CircleX size={24} className='text-red-400'></CircleX>
          <div className='flex flex-1 flex-col mx-4'>
            <div className='font-bold text-base'>注销账号</div>
            <div className='text-sm'>提交申请，删除所有数据，永久注销</div>
          </div>
          <div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                {/* 注销 */}
                <Button variant='destructive'>注销</Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>确认注销账号？</AlertDialogTitle>
                  <AlertDialogDescription>确定后，将删除所有数据，永久注销</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      handUserDeregister();
                    }}
                  >
                    确认注销
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </div>
    </>
  );
};

export default AccountManagement;
