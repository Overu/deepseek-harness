export interface CameraMovementParam {
  enable: boolean;
  name?: string;
  text?: string;
}

export interface CameraMovementItem {
  id: number;
  type: number;
  name: string;
  coverUrl: string;
  fileUrl: string;
  text: string;
  createTime?: string;
  isInCollection?: number;
}
