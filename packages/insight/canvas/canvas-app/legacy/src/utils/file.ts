// 将文件类型转换为HTML input accept属性格式
const convertToHtmlAccept = (accept: string): string => {
  if (accept === '*') return '';

  const acceptTypes = accept.split(',').map(type => type.trim());
  const htmlAcceptTypes: string[] = [];

  acceptTypes.forEach(type => {
    if (type === 'image') {
      htmlAcceptTypes.push('image/*');
    } else if (type === 'video') {
      htmlAcceptTypes.push('video/*');
    } else if (type === 'audio') {
      htmlAcceptTypes.push('audio/*');
    } else if (type.startsWith('.')) {
      // 文件扩展名格式直接保留
      htmlAcceptTypes.push(type);
    } else if (type.includes('/')) {
      // MIME类型格式直接保留
      htmlAcceptTypes.push(type);
    }
  });

  return htmlAcceptTypes.join(',');
};

// 根据传入文件以及允许类型判断是否符合要求
const isValidFileType = (file: any, accept: string): boolean => {
  const fileName = file.name.toLowerCase();
  const fileType = file.type;

  if (accept === '*') return true;

  // 统一处理所有 accept 类型
  const acceptTypes = accept.split(',').map(type => type.trim());

  return acceptTypes.some(type => {
    // 处理通配符类型
    if (type.endsWith('/*')) {
      return fileType.startsWith(type.slice(0, -1));
    }
    // 处理关键词类型
    if (type === 'image') {
      return fileType.startsWith('image/');
    }
    if (type === 'video') {
      return fileType.startsWith('video/');
    }
    if (type === 'audio') {
      return fileType.startsWith('audio/');
    }
    // 处理具体的 MIME 类型或文件扩展名
    return fileType === type || fileName.endsWith(type.toLowerCase());
  });
};

// 将文件类型转化为对应格式文本
const getAcceptDisplayText = (accept: string): string => {
  switch (accept) {
    case 'image':
      return '图片格式（png、jpg、jpeg、webp等）';
    case 'video':
      return '视频格式（mp4、mkv、mov等）';
    case 'audio':
      return '音频格式（mp3、wav、aac、m4a等）';
    default:
      return '';
  }
};

export default {
  convertToHtmlAccept, // 将文件类型转换为HTML input accept属性格式
  isValidFileType, // 根据传入文件以及允许类型判断是否符合要求
  getAcceptDisplayText, // 将文件类型转化为对应格式文本
};
