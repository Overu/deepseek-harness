export type CoverCropSource =
  | {
      type: 'image';
      url: string;
      name?: string;
    }
  | {
      type: 'video';
      url: string;
      name?: string;
      initialTime?: number;
    };

export interface CoverCropRect {
  aspect: number;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

export interface CoverCropResult {
  coverUrl: string;
  sourceTime?: number;
  crop: CoverCropRect;
}

export interface CoverCropDialogProps {
  open: boolean;
  source: CoverCropSource | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (result: CoverCropResult) => void;
}
