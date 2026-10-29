import * as z from 'zod';

export const phoneRegex = /^1[3-9]\d{9}$/;
export const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d\S]{8,20}$/;

export const isValidPhone = (value: string) => phoneRegex.test(value);
export const isValidPasswordLength = (value: string) => value.length >= 8 && value.length <= 20;
export const hasPasswordLetterAndNumber = (value: string) => /[A-Za-z]/.test(value) && /\d/.test(value);
export const isValidPassword = (value: string) => isValidPasswordLength(value) && hasPasswordLetterAndNumber(value);

export const phoneSchema = z.string().min(1, { message: '请输入手机号' }).regex(phoneRegex, { message: '请输入正确的手机号' });

export const passwordSchema = z.string().refine(isValidPassword, {
  message: '密码需为8-20位，且包含字母和数字',
});

export const agreementSchema = z.boolean().refine(val => val === true, {
  message: '请您阅读并勾选同意掂商/影流平台相关用户服务协议和隐私政策',
});
